import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BotMessageGuard } from "../src/channels/telegram/bot-message-guard.js";

describe("BotMessageGuard", () => {
  let guard: BotMessageGuard;

  beforeEach(() => {
    guard = new BotMessageGuard();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("deduplication", () => {
    it("allows a new message", () => {
      const result = guard.check({ messageId: 1, botId: 100, depth: 0 });
      expect(result.allowed).toBe(true);
    });

    it("blocks a duplicate message_id", () => {
      guard.check({ messageId: 1, botId: 100, depth: 0 });
      const result = guard.check({ messageId: 1, botId: 100, depth: 0 });
      expect(result.allowed).toBe(false);
      expect(result.allowed === false && result.reason).toBe("duplicate");
    });

    it("allows same message_id after dedup window expires", () => {
      guard.check({ messageId: 1, botId: 100, depth: 0 });
      vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes
      const result = guard.check({ messageId: 1, botId: 100, depth: 0 });
      expect(result.allowed).toBe(true);
    });

    it("evicts stale entries so memory doesn't grow unbounded", () => {
      // Add a message and advance past the dedup window
      guard.check({ messageId: 1, botId: 100, depth: 0 });
      expect(guard._seenCount).toBe(1);
      vi.advanceTimersByTime(6 * 60 * 1000);
      // Trigger eviction by checking a new message
      guard.check({ messageId: 2, botId: 100, depth: 0 });
      expect(guard._seenCount).toBe(1); // only the fresh message
    });
  });

  describe("depth limiting", () => {
    it("allows messages at depth 0", () => {
      const result = guard.check({ messageId: 1, botId: 100, depth: 0 });
      expect(result.allowed).toBe(true);
    });

    it("allows messages at exactly MAX_DEPTH (3)", () => {
      const result = guard.check({ messageId: 1, botId: 100, depth: 3 });
      expect(result.allowed).toBe(true);
    });

    it("blocks messages exceeding MAX_DEPTH", () => {
      const result = guard.check({ messageId: 1, botId: 100, depth: 4 });
      expect(result.allowed).toBe(false);
      expect(result.allowed === false && result.reason).toBe("depth_exceeded");
    });

    it("depth check runs before tracking the message_id", () => {
      // A blocked-by-depth message should not be tracked, so same id can be tried again
      guard.check({ messageId: 1, botId: 100, depth: 4 }); // blocked
      const result = guard.check({ messageId: 1, botId: 100, depth: 0 }); // should be allowed
      expect(result.allowed).toBe(true);
    });
  });

  describe("rate limiting", () => {
    it("allows up to MAX_PER_MINUTE messages from one bot", () => {
      for (let i = 0; i < 10; i++) {
        const result = guard.check({ messageId: i + 1, botId: 200, depth: 0 });
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks the 11th message from the same bot within a minute", () => {
      for (let i = 0; i < 10; i++) {
        guard.check({ messageId: i + 1, botId: 200, depth: 0 });
      }
      const result = guard.check({ messageId: 11, botId: 200, depth: 0 });
      expect(result.allowed).toBe(false);
      expect(result.allowed === false && result.reason).toBe("rate_limited");
    });

    it("resets the rate limit after one minute", () => {
      for (let i = 0; i < 10; i++) {
        guard.check({ messageId: i + 1, botId: 200, depth: 0 });
      }
      vi.advanceTimersByTime(61_000); // just over 1 minute
      const result = guard.check({ messageId: 100, botId: 200, depth: 0 });
      expect(result.allowed).toBe(true);
    });

    it("does not count blocked messages toward rate limit", () => {
      // Fill up with 10 valid messages from bot 200
      for (let i = 0; i < 10; i++) {
        guard.check({ messageId: i + 1, botId: 200, depth: 0 });
      }
      // A different bot should still be allowed
      const result = guard.check({ messageId: 99, botId: 201, depth: 0 });
      expect(result.allowed).toBe(true);
    });
  });

  describe("independent bot buckets", () => {
    it("rate limits are per-bot, not global", () => {
      // Exhaust bot 300's limit
      for (let i = 0; i < 10; i++) {
        guard.check({ messageId: i + 1, botId: 300, depth: 0 });
      }
      // Bot 301 should be unaffected
      const result = guard.check({ messageId: 50, botId: 301, depth: 0 });
      expect(result.allowed).toBe(true);
    });
  });
});
