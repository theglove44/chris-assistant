/**
 * Unit tests for the withRetry helper.
 *
 * Covers:
 *  - Success on first attempt (no retries needed)
 *  - Success on a later attempt (retry succeeds)
 *  - Exhaustion: all attempts fail → throws last error
 *  - Return value is propagated correctly
 *  - fn is called exactly maxAttempts times on exhaustion
 *
 * We use baseDelayMs: 0 to keep tests fast (sleep(0) yields but doesn't block).
 */

import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/domain/memory/retry.js";

describe("withRetry", () => {
  it("returns the result immediately when fn succeeds on the first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(fn, { label: "test-op", baseDelayMs: 0 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and returns the result when fn succeeds on the second attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, { label: "test-op", maxAttempts: 3, baseDelayMs: 0 });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after exhausting all attempts", async () => {
    const error = new Error("persistent failure");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { label: "test-op", maxAttempts: 3, baseDelayMs: 0 })).rejects.toThrow(
      "persistent failure",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls fn exactly maxAttempts times before giving up", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(
      withRetry(fn, { label: "test-op", maxAttempts: 5, baseDelayMs: 0 }),
    ).rejects.toThrow("always fails");

    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("propagates the return value (not just truthy values)", async () => {
    const fn = vi.fn().mockResolvedValue({ count: 42, items: ["a", "b"] });

    const result = await withRetry(fn, { label: "test-op", baseDelayMs: 0 });

    expect(result).toEqual({ count: 42, items: ["a", "b"] });
  });
});
