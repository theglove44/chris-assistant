/**
 * Retry helper with exponential backoff and jitter for async operations.
 *
 * Performs up to `maxAttempts` tries, sleeping base^attempt seconds between them
 * with up to 25% random jitter. Throws the last error on exhaustion.
 *
 * Usage:
 *   await withRetry(() => writeMemoryFile(...), { label: "archive/2026-04-16.jsonl" });
 */

export interface RetryOptions {
  /** Human-readable label included in log messages (e.g. "archive/2026-04-16.jsonl"). */
  label: string;
  /** Total number of attempts. Defaults to 3. */
  maxAttempts?: number;
  /** Base delay in milliseconds for attempt 1→2. Doubles each retry. Defaults to 1000. */
  baseDelayMs?: number;
}

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute the backoff delay for a given attempt index (0-based).
 * Delay = baseDelayMs * 4^attempt + jitter(0..25%)
 *
 * Attempt 0 → 1s base, attempt 1 → 4s base, attempt 2 → 16s base.
 */
function backoffMs(attempt: number, baseDelayMs: number): number {
  const base = baseDelayMs * Math.pow(4, attempt);
  const jitter = Math.random() * 0.25 * base;
  return Math.round(base + jitter);
}

/**
 * Execute `fn`, retrying on failure with exponential backoff and jitter.
 * Returns the resolved value on success or throws on final exhaustion.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const { label } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const isLast = attempt === maxAttempts - 1;

      if (isLast) {
        // Let caller handle exhaustion logging/alerting
        break;
      }

      const delay = backoffMs(attempt, baseDelayMs);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        "[retry] %s — attempt %d/%d failed: %s. Retrying in %dms",
        label,
        attempt + 1,
        maxAttempts,
        errMsg,
        delay,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
