/**
 * Centralized limits and cache/frequency thresholds.
 * All values can be overridden via environment variables.
 */

function envInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

export const LIMITS = {
  /** Maximum output length for tool results (characters) */
  maxToolOutput: envInt("MAX_TOOL_OUTPUT", 50_000),

  /** Prompt cache TTL in milliseconds */
  promptCacheMs: envInt("PROMPT_CACHE_MS", 5 * 60 * 1000),

  /** Loop detection threshold: consecutive identical tool calls */
  loopThreshold: envInt("LOOP_THRESHOLD", 3),

  /** Default tool invocation frequency limit per conversation */
  toolFrequencyLimit: envInt("TOOL_FREQUENCY_LIMIT", 20),

  /** PM2 process list cache TTL in milliseconds */
  pm2CacheTtlMs: envInt("PM2_CACHE_TTL_MS", 30_000),

  /** Conversation history window: number of recent messages to include */
  historyWindow: envInt("HISTORY_WINDOW", 20),
} as const;
