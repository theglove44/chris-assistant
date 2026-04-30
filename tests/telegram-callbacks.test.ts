import { describe, expect, it } from "vitest";
import {
  encodeCallback,
  parseCallbackData,
} from "../src/channels/telegram/callback-data.js";

describe("parseCallbackData", () => {
  it("returns null for undefined", () => {
    expect(parseCallbackData(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCallbackData("")).toBeNull();
  });

  it("returns null for payloads without the namespace", () => {
    expect(parseCallbackData("purge:yes")).toBeNull();
    expect(parseCallbackData("foo:bar")).toBeNull();
  });

  it("returns null for unknown actions inside the namespace", () => {
    expect(parseCallbackData("ca:nope")).toBeNull();
    expect(parseCallbackData("ca:purge:maybe")).toBeNull();
  });

  it("parses each known action", () => {
    expect(parseCallbackData("ca:purge:yes")).toBe("purge:yes");
    expect(parseCallbackData("ca:purge:no")).toBe("purge:no");
    expect(parseCallbackData("ca:restart:yes")).toBe("restart:yes");
    expect(parseCallbackData("ca:restart:no")).toBe("restart:no");
  });

  it("round-trips through encodeCallback", () => {
    const actions = ["purge:yes", "purge:no", "restart:yes", "restart:no"] as const;
    for (const action of actions) {
      expect(parseCallbackData(encodeCallback(action))).toBe(action);
    }
  });

  it("keeps every encoded payload under Telegram's 64-byte cap", () => {
    const actions = ["purge:yes", "purge:no", "restart:yes", "restart:no"] as const;
    for (const action of actions) {
      expect(Buffer.byteLength(encodeCallback(action), "utf-8")).toBeLessThanOrEqual(64);
    }
  });
});
