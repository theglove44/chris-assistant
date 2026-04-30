import { GrammyError } from "grammy";
import { config } from "../../config.js";
import { onSkillIndexChange } from "../../skills/loader.js";
import { bot } from "./bot.js";
import { TELEGRAM_COMMAND_MENU, registerTelegramCommands } from "./commands.js";
import { registerTelegramMessageHandlers } from "./handlers.js";
import {
  loadSkillCommandPlan,
  registerSkillCommandRouter,
  setActiveSkillRoutes,
} from "./skill-commands-runtime.js";
import { startWebhook, type WebhookRuntime } from "./webhook.js";
import { registerTelegramCallbackHandlers } from "./callbacks.js";

// Transport selection (env vars):
//   TELEGRAM_TRANSPORT       = "polling" (default) | "webhook"
//   TELEGRAM_WEBHOOK_URL     = https://… public URL Telegram will POST to (webhook only)
//   TELEGRAM_WEBHOOK_SECRET  = shared secret; required when transport=webhook
//   TELEGRAM_WEBHOOK_PORT    = local listen port (default 8443)
// Telegram only accepts HTTPS webhook URLs, so the user must front the local
// port with TLS termination (Cloudflare tunnel, ngrok, reverse proxy). This
// module listens plain HTTP on the loopback port the tunnel forwards to.

registerTelegramCommands(bot);
registerSkillCommandRouter(bot);
registerTelegramMessageHandlers(bot);
registerTelegramCallbackHandlers(bot);

// Refresh the autocomplete menu whenever skills are created/updated/deleted.
// First call happens later via the telegram-command-menu service; this only
// debounces follow-up changes during runtime.
onSkillIndexChange(() => {
  setTelegramCommandMenu().catch((err) =>
    console.warn("[telegram] skill-change menu refresh failed:", err?.message ?? err),
  );
});

export { bot };

export async function setTelegramCommandMenu(): Promise<void> {
  // Skill list is dynamic, so refresh it each call. Falls back to static-only
  // if the GitHub-backed skill index is unreachable — autocomplete still works.
  let entries: { command: string; description: string }[] = [...TELEGRAM_COMMAND_MENU];
  try {
    const plan = await loadSkillCommandPlan(TELEGRAM_COMMAND_MENU);
    entries = plan.entries;
    setActiveSkillRoutes(plan.skillIdByCommand);
    if (plan.skipped.length > 0) {
      for (const s of plan.skipped) {
        console.warn(`[telegram] skill command skipped: ${s.id} (${s.name}) — ${s.reason}`);
      }
    }
    const skillCount = plan.skillIdByCommand.size;
    if (skillCount > 0) {
      console.log(`[telegram] registered ${skillCount} skill command(s) with autocomplete`);
    }
  } catch (err: any) {
    console.warn("[telegram] failed to load skill command plan:", err?.message ?? err);
    setActiveSkillRoutes(new Map());
  }
  await bot.api.setMyCommands(entries);
}

// Retry on 409 instead of crashing — another poller occasionally steals the
// slot, Telegram's 30s long-poll needs to expire before we can reclaim it.
const POLL_CONFLICT_BACKOFF_MS = 35_000;

let activeWebhook: WebhookRuntime | null = null;

export function startTelegram(onStart: (botInfo: any) => void): void {
  // Downstream services (health monitor, timers, alert on startup) are not
  // all idempotent, so only fire onStart for the first successful start.
  let onStartFired = false;
  const fireOnStartOnce = (info: Parameters<typeof onStart>[0]): void => {
    if (onStartFired) return;
    onStartFired = true;
    onStart(info);
  };

  const onFatal = (err: any): void => {
    console.error("[telegram] fatal start error:", err?.message ?? err);
    process.exit(1);
  };

  if (config.telegram.transport === "webhook") {
    startWebhookTransport(fireOnStartOnce).catch(onFatal);
    return;
  }

  const run = async (): Promise<void> => {
    try {
      await bot.start({ onStart: fireOnStartOnce });
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 409) {
        console.warn(
          `[telegram] getUpdates 409 — another poller is active; retrying in ${POLL_CONFLICT_BACKOFF_MS / 1000}s`,
        );
        setTimeout(() => { run().catch(onFatal); }, POLL_CONFLICT_BACKOFF_MS);
        return;
      }
      throw err;
    }
  };

  run().catch(onFatal);
}

async function startWebhookTransport(fireOnStartOnce: (info: any) => void): Promise<void> {
  // Validated at config load, but narrow types here for the local closure.
  const url = config.telegram.webhookUrl;
  const secret = config.telegram.webhookSecret;
  if (!url || !secret) {
    throw new Error("telegram webhook transport selected but URL/secret are missing");
  }

  activeWebhook = await startWebhook({
    url,
    secret,
    port: config.telegram.webhookPort,
  });

  const me = await bot.api.getMe();
  console.log(`[telegram] webhook listening on :${config.telegram.webhookPort}, registered ${url}`);
  fireOnStartOnce(me);
}

export async function stopTelegram(): Promise<void> {
  if (config.telegram.transport === "webhook") {
    if (activeWebhook) {
      try {
        await bot.api.deleteWebhook();
      } catch (err: any) {
        console.warn("[telegram] deleteWebhook failed:", err?.message ?? err);
      }
      await activeWebhook.close();
      activeWebhook = null;
    }
    return;
  }
  bot.stop();
}
