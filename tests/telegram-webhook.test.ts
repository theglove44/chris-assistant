import { describe, expect, it } from "vitest";
import { verifySecretHeader } from "../src/channels/telegram/webhook-verify.js";

describe("verifySecretHeader", () => {
  it("accepts a matching string header", () => {
    expect(verifySecretHeader("abc123", "abc123")).toBe(true);
  });

  it("rejects a mismatched header", () => {
    expect(verifySecretHeader("nope", "abc123")).toBe(false);
  });

  it("rejects missing or non-string headers", () => {
    expect(verifySecretHeader(undefined, "abc123")).toBe(false);
    expect(verifySecretHeader(["abc123"], "abc123")).toBe(false);
  });
});
