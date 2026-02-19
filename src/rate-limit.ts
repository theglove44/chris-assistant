// Sliding window rate limiter
// MAX_MESSAGES per user within WINDOW_MS rolling window.

const MAX_MESSAGES = 10;
const WINDOW_MS = 60_000; // 1 minute

// Map<userId, sorted list of message timestamps (ms)>
const userTimestamps = new Map<number, number[]>();

/**
 * Check whether a user is within the rate limit.
 *
 * Prunes expired timestamps on every call so the map never grows
 * unboundedly for long-running sessions.
 *
 * Returns { allowed: true } if the message should be processed, or
 * { allowed: false, retryAfterMs: number } if the user is over the limit.
 */
export function checkRateLimit(
  userId: number,
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Retrieve and prune timestamps older than the current window.
  const timestamps = (userTimestamps.get(userId) ?? []).filter(
    (ts) => ts > windowStart,
  );

  if (timestamps.length >= MAX_MESSAGES) {
    // The oldest timestamp in the window is the earliest point after which
    // a slot will open up.
    const oldestInWindow = timestamps[0];
    const retryAfterMs = oldestInWindow + WINDOW_MS - now;
    console.log(
      "[rate-limit] User %d hit limit — %d messages in window, retry in %dms",
      userId,
      timestamps.length,
      retryAfterMs,
    );
    // Write pruned list back without adding the current request.
    userTimestamps.set(userId, timestamps);
    return { allowed: false, retryAfterMs };
  }

  // Record this message and persist the updated list.
  timestamps.push(now);
  userTimestamps.set(userId, timestamps);
  return { allowed: true };
}
