/**
 * BotMessageGuard — loop prevention for bot-to-bot communication.
 *
 * Telegram Bot API 9.6 allows bots to receive messages from other bots in groups,
 * but warns that infinite loops are trivially easy to create. This guard enforces
 * three independent safeguards:
 *
 *   1. Deduplication  — ignore a message_id seen within the last 5 minutes
 *   2. Depth limiting — bail if a reply chain exceeds MAX_DEPTH hops
 *   3. Rate limiting  — allow at most MAX_PER_MINUTE messages from any one bot per minute
 */

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_DEPTH = 3;
const MAX_PER_MINUTE = 10;

export interface BotMessageContext {
  /** Telegram message_id — used for deduplication */
  messageId: number;
  /** Telegram user_id of the sending bot */
  botId: number;
  /**
   * How many bot-to-bot hops deep this message is.
   * Callers should track this by walking reply_to_message chains.
   * Pass 0 if depth is unknown / not tracked.
   */
  depth: number;
}

export type GuardResult =
  | { allowed: true }
  | { allowed: false; reason: "duplicate" | "depth_exceeded" | "rate_limited" };

export class BotMessageGuard {
  private readonly seenMessages = new Map<number, number>(); // messageId → timestamp
  private readonly botMinuteBuckets = new Map<number, { count: number; windowStart: number }>(); // botId → bucket

  check(ctx: BotMessageContext): GuardResult {
    this.evictExpired();

    // 1. Deduplication
    if (this.seenMessages.has(ctx.messageId)) {
      return { allowed: false, reason: "duplicate" };
    }

    // 2. Depth
    if (ctx.depth > MAX_DEPTH) {
      return { allowed: false, reason: "depth_exceeded" };
    }

    // 3. Rate limit
    const now = Date.now();
    const bucket = this.botMinuteBuckets.get(ctx.botId);
    if (bucket && now - bucket.windowStart < 60_000) {
      if (bucket.count >= MAX_PER_MINUTE) {
        return { allowed: false, reason: "rate_limited" };
      }
      bucket.count++;
    } else {
      this.botMinuteBuckets.set(ctx.botId, { count: 1, windowStart: now });
    }

    this.seenMessages.set(ctx.messageId, now);
    return { allowed: true };
  }

  private evictExpired(): void {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [id, ts] of this.seenMessages) {
      if (ts < cutoff) this.seenMessages.delete(id);
    }
  }

  /** Exposed for testing */
  get _seenCount(): number {
    return this.seenMessages.size;
  }
}
