import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({ config: { maxToolTurns: 200, reasoningEffort: null } }));
vi.mock("../src/grok.js", () => ({ resolveGrokBinary: vi.fn(() => "/Users/christaylor/.grok/bin/grok") }));
vi.mock("../src/grok-sessions.js", () => ({
  getGrokSessionId: vi.fn(() => null),
  setGrokSessionId: vi.fn(),
}));
vi.mock("../src/tools/files.js", () => ({ getWorkspaceRoot: vi.fn(() => "/workspace") }));
import {
  buildGrokArgs,
  parseGrokAgentModel,
  parseGrokStreamLine,
  redactGrokDiagnostic,
  runGrokHeadless,
} from "../src/providers/grok-agent.js";

function fakeChild() {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

describe("Grok stream parsing", () => {
  it("parses partial text, final messages, and session IDs without throwing on noise", () => {
    expect(parseGrokStreamLine("not-json")).toEqual({});
    expect(parseGrokStreamLine(JSON.stringify({
      type: "stream_event",
      session_id: "session-1",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "hel" } },
    }))).toEqual({ delta: "hel", messageText: undefined, sessionId: "session-1" });
    expect(parseGrokStreamLine(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    }))).toEqual({ delta: undefined, messageText: "hello", sessionId: undefined });
  });
});

describe("Grok process runner", () => {
  it("uses direct argv, an explicit cwd, bounded headless settings, stdin prompt delivery, and streamed output", async () => {
    const child = fakeChild();
    const spawnGrok = vi.fn(() => child);
    const chunks: string[] = [];
    let prompt = "";
    child.stdin.on("data", (chunk: Buffer) => { prompt += chunk.toString(); });

    const resultPromise = runGrokHeadless({
      binaryPath: "/Users/christaylor/.grok/bin/grok",
      cwd: "/workspace",
      prompt: "private prompt",
      model: "grok-4.5",
      maxTurns: 12,
      signal: new AbortController().signal,
      onText: (text) => chunks.push(text),
    }, spawnGrok as any);

    child.stdout.write(`${JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hel" } } })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } })}\n`);
    child.stdout.end();
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({ text: "hello", sessionId: "session-1" });
    expect(prompt).toBe("private prompt");
    const [command, args, options] = spawnGrok.mock.calls[0];
    expect(command).toBe("/Users/christaylor/.grok/bin/grok");
    expect(args).not.toContain("private prompt");
    expect(args).toEqual(expect.arrayContaining([
      "--prompt-file", "/dev/stdin",
      "--output-format", "streaming-messages-json",
      "--permission-mode", "dontAsk",
      "--sandbox", "workspace",
      "--max-turns", "12",
      "--no-memory",
      "--no-subagents",
      "--disable-web-search",
    ]));
    expect(options).toMatchObject({ cwd: "/workspace", shell: false, env: expect.any(Object) });
    expect(options.env).not.toHaveProperty("TELEGRAM_BOT_TOKEN");
    expect(chunks).toEqual(["hel", "hello"]);
  });

  it("terminates a cancelled child process", async () => {
    const child = fakeChild();
    const controller = new AbortController();
    child.kill.mockImplementation((signal: string) => {
      if (signal === "SIGTERM") queueMicrotask(() => child.emit("close", null));
      return true;
    });

    const resultPromise = runGrokHeadless({
      binaryPath: "/grok",
      cwd: "/workspace",
      prompt: "stop",
      model: "grok-4.5",
      maxTurns: 4,
      signal: controller.signal,
    }, (() => child) as any);
    controller.abort();

    await expect(resultPromise).rejects.toThrow("cancelled");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("Grok model and diagnostics", () => {
  it("passes only explicit, canonical effort values", () => {
    expect(parseGrokAgentModel("grok-agent-grok-4.5")).toEqual({ model: "grok-4.5" });
    expect(buildGrokArgs({
      prompt: "secret prompt",
      model: "grok-4.5",
      effort: "medium",
      sessionId: "session-1",
      maxTurns: 8,
    })).toEqual(expect.arrayContaining(["--reasoning-effort", "medium", "--resume", "session-1"]));
  });

  it("redacts credentials and the home directory from diagnostics", () => {
    const redacted = redactGrokDiagnostic("/Users/christaylor/file token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    expect(redacted).not.toContain("/Users/christaylor");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redacted).toBe("diagnostic output redacted");
  });
});
