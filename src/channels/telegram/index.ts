import { GrammyError } from "grammy";
import { bot } from "./bot.js";
import { TELEGRAM_COMMAND_MENU, registerTelegramCommands } from "./commands.js";
import { registerTelegramMessageHandlers } from "./handlers.js";

registerTelegramCommands(bot);
registerTelegramMessageHandlers(bot);

export { bot };

export async function setTelegramCommandMenu(): Promise<void> {
  await bot.api.setMyCommands([...TELEGRAM_COMMAND_MENU]);
}

// Retry on 409 instead of crashing — another poller occasionally steals the
// slot, Telegram's 30s long-poll needs to expire before we can reclaim it.
const POLL_CONFLICT_BACKOFF_MS = 35_000;

export function startTelegram(onStart: (botInfo: any) => void): void {
  // Downstream services (health monitor, timers, alert on startup) are not
  // all idempotent, so only fire onStart for the first successful poll.
  let onStartFired = false;
  const fireOnStartOnce = (info: Parameters<typeof onStart>[0]): void => {
    if (onStartFired) return;
    onStartFired = true;
    onStart(info);
  };

  const onFatal = (err: any): void => {
    console.error("[telegram] fatal polling error:", err?.message ?? err);
    process.exit(1);
  };

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

export function stopTelegram(): void {
  bot.stop();
}
