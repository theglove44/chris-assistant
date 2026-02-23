// Must set env vars before importing modules that depend on config.ts
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_ALLOWED_USER_ID = "12345";
process.env.GITHUB_TOKEN = "test-github-token";
process.env.GITHUB_MEMORY_REPO = "test/repo";

import { describe, it, expect, beforeEach } from "vitest";
import {
  dispatchToolCall,
  registerTool,
  resetLoopDetection,
} from "../src/tools/registry.js";

// Register a lightweight no-op tool for testing so we don't trigger real side effects
registerTool({
  name: "test_echo",
  category: "always",
  description: "Test tool that echoes its input",
  zodSchema: {},
  jsonSchemaParameters: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string", description: "Message to echo" },
    },
  },
  execute: async (args: { message: string }) => `echo: ${args.message}`,
});

beforeEach(() => {
  resetLoopDetection();
});

describe("loop detection", () => {
  it("allows the first call through normally", async () => {
    const result = await dispatchToolCall(
      "test_echo",
      JSON.stringify({ message: "hello" }),
      "test",
    );
    expect(result).toBe("echo: hello");
  });

  it("allows two identical calls through", async () => {
    const args = JSON.stringify({ message: "repeat" });
    await dispatchToolCall("test_echo", args, "test");
    const result = await dispatchToolCall("test_echo", args, "test");
    expect(result).toBe("echo: repeat");
  });

  it("blocks the third identical consecutive call", async () => {
    const args = JSON.stringify({ message: "stuck" });
    await dispatchToolCall("test_echo", args, "test");
    await dispatchToolCall("test_echo", args, "test");
    const result = await dispatchToolCall("test_echo", args, "test");
    expect(result).toContain("Loop detected");
    expect(result).toContain("test_echo");
  });

  it("does not trigger on calls with different arguments", async () => {
    await dispatchToolCall("test_echo", JSON.stringify({ message: "a" }), "test");
    await dispatchToolCall("test_echo", JSON.stringify({ message: "b" }), "test");
    const result = await dispatchToolCall(
      "test_echo",
      JSON.stringify({ message: "c" }),
      "test",
    );
    // Should succeed — different args each time
    expect(result).toBe("echo: c");
  });

  it("does not trigger when calls alternate between different args", async () => {
    const argsA = JSON.stringify({ message: "a" });
    const argsB = JSON.stringify({ message: "b" });
    await dispatchToolCall("test_echo", argsA, "test");
    await dispatchToolCall("test_echo", argsB, "test");
    const result = await dispatchToolCall("test_echo", argsA, "test");
    // a, b, a — not three identical in a row, should pass
    expect(result).toBe("echo: a");
  });

  it("resets after resetLoopDetection() is called", async () => {
    const args = JSON.stringify({ message: "stuck" });
    // Drive it to loop
    await dispatchToolCall("test_echo", args, "test");
    await dispatchToolCall("test_echo", args, "test");
    await dispatchToolCall("test_echo", args, "test"); // triggers loop, resets internally

    // After the loop fires, internal state is reset — next calls should work again
    const result = await dispatchToolCall("test_echo", args, "test");
    expect(result).toBe("echo: stuck");
  });

  it("returns error for unknown tool", async () => {
    const result = await dispatchToolCall("nonexistent_tool", "{}", "test");
    expect(result).toBe("Unknown tool: nonexistent_tool");
  });

  it("returns error for invalid JSON args", async () => {
    const result = await dispatchToolCall("test_echo", "not-json", "test");
    expect(result).toContain("Failed to parse tool arguments");
  });

  it("resetLoopDetection clears state so next calls start fresh", async () => {
    const args = JSON.stringify({ message: "fresh" });
    // Two identical calls
    await dispatchToolCall("test_echo", args, "test");
    await dispatchToolCall("test_echo", args, "test");

    // Reset before the third — should not trigger loop
    resetLoopDetection();

    const result = await dispatchToolCall("test_echo", args, "test");
    expect(result).toBe("echo: fresh");
  });
});
