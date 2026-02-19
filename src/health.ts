import { Octokit } from "@octokit/rest";
import { config, repoOwner, repoName } from "./config.js";
import { loadTokens as loadMinimaxTokens } from "./providers/minimax-oauth.js";
import { loadTokens as loadOpenaiTokens } from "./providers/openai-oauth.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REALERT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Module-level state
let intervalId: ReturnType<typeof setInterval> | null = null;

interface AlertState {
  alerted: boolean;
  lastAlertTime: number;
}

const alertState = new Map<string, AlertState>();

// --- Provider name helper ---

function getProviderName(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-")) return "OpenAI";
  if (model.startsWith("MiniMax")) return "MiniMax";
  return "Claude";
}

// --- Telegram alert sender ---
// Uses fetch directly to avoid circular dependency with telegram.ts.

async function sendAlert(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.allowedUserId,
        text: message,
      }),
    });
  } catch (err: any) {
    console.error("[health] Failed to send alert:", err.message);
  }
}

// --- Health check definitions ---

interface CheckResult {
  ok: boolean;
  detail?: string;
}

interface HealthCheck {
  name: string;
  run: () => Promise<CheckResult>;
}

const octokit = new Octokit({ auth: config.github.token });

/** Margin in milliseconds to consider a token expired ahead of time */
const EXPIRY_MARGIN_MS = 60 * 1000; // 1 minute

const checks: HealthCheck[] = [
  {
    name: "github-memory",
    run: async (): Promise<CheckResult> => {
      try {
        await octokit.repos.get({ owner: repoOwner, repo: repoName });
        return { ok: true };
      } catch (err: any) {
        return {
          ok: false,
          detail: `GitHub memory repo unreachable: ${err.message ?? "unknown error"}`,
        };
      }
    },
  },
  {
    name: "minimax-tokens",
    run: async (): Promise<CheckResult> => {
      const tokens = loadMinimaxTokens();
      // No tokens means MiniMax is not set up — that's optional, so skip
      if (!tokens) return { ok: true };

      const expired = Date.now() >= tokens.expires - EXPIRY_MARGIN_MS;
      if (expired) {
        return {
          ok: false,
          detail: 'MiniMax tokens expired — run "chris minimax login" to re-authenticate',
        };
      }
      return { ok: true };
    },
  },
  {
    name: "openai-tokens",
    run: async (): Promise<CheckResult> => {
      const tokens = loadOpenaiTokens();
      // No tokens means OpenAI is not set up — that's optional, so skip
      if (!tokens) return { ok: true };

      // OpenAI auto-refreshes, so only flag if there's no refresh_token AND access is expired
      const hasRefreshToken = Boolean(tokens.refresh_token);
      const accessExpired = Date.now() >= tokens.expires - EXPIRY_MARGIN_MS;

      if (!hasRefreshToken && accessExpired) {
        return {
          ok: false,
          detail: 'OpenAI access token expired and no refresh token — run "chris openai login" to re-authenticate',
        };
      }
      return { ok: true };
    },
  },
];

// --- Alert state logic ---

async function processCheckResult(name: string, result: CheckResult): Promise<void> {
  const state = alertState.get(name);

  if (!result.ok) {
    const now = Date.now();
    const shouldAlert =
      !state?.alerted ||
      now - state.lastAlertTime > REALERT_INTERVAL_MS;

    if (shouldAlert) {
      const detail = result.detail ?? `Health check failed: ${name}`;
      console.log(`[health] Alerting on check "${name}": ${detail}`);
      await sendAlert(`Health check failed: ${name}\n${detail}`);
      alertState.set(name, { alerted: true, lastAlertTime: now });
    }
  } else {
    // Check passed — send recovery message if this was previously alerted
    if (state?.alerted) {
      console.log(`[health] Check "${name}" recovered`);
      await sendAlert(`Resolved: ${name}`);
      alertState.delete(name);
    }
  }
}

// --- Core runner ---

async function runHealthChecks(): Promise<void> {
  console.log("[health] Running health checks...");

  for (const check of checks) {
    let result: CheckResult;
    try {
      result = await check.run();
    } catch (err: any) {
      // Unexpected error in check runner itself — treat as failure
      result = {
        ok: false,
        detail: `Check threw unexpectedly: ${err.message ?? "unknown error"}`,
      };
    }

    await processCheckResult(check.name, result);
  }

  console.log("[health] Health checks complete");
}

// --- Public API ---

export async function startHealthMonitor(): Promise<void> {
  const model = config.model;
  const provider = getProviderName(model);

  console.log(`[health] Sending startup notification (model: ${model}, provider: ${provider})`);
  await sendAlert(`Bot online — running \`${model}\` via ${provider}`);

  // Run an initial check immediately on startup
  await runHealthChecks();

  intervalId = setInterval(() => {
    runHealthChecks().catch((err: any) => {
      console.error("[health] Unexpected error during health check cycle:", err.message);
    });
  }, CHECK_INTERVAL_MS);

  console.log(`[health] Health monitor started (interval: ${CHECK_INTERVAL_MS / 1000}s)`);
}

export function stopHealthMonitor(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[health] Health monitor stopped");
  }
}
