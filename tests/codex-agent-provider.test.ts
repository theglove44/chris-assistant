import { describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const startThread = vi.fn();
  const resumeThread = vi.fn();
  const setThreadId = vi.fn();

  function createThread(id: string) {
    return {
      id,
      runStreamed: vi.fn(async function runStreamed() {
        async function* events() {
          yield {
            type: "item.completed",
            item: { id: "msg-1", type: "agent_message", text: "done" },
          };
        }
        return { events: events() };
      }),
    };
  }

  return { startThread, resumeThread, setThreadId, createThread };
});

vi.mock("@openai/codex-sdk", () => ({
  Codex: vi.fn().mockImplementation(function CodexMock() {
    return {
      startThread: fixtures.startThread,
      resumeThread: fixtures.resumeThread,
    };
  }),
}));

vi.mock("../src/codex.js", () => ({
  resolveCodexBinary: vi.fn(() => "/usr/local/bin/codex"),
}));

vi.mock("../src/codex-sessions.js", () => ({
  getThreadId: vi.fn(() => null),
  setThreadId: fixtures.setThreadId,
}));

vi.mock("../src/tools/files.js", () => ({
  getWorkspaceRoot: vi.fn(() => "/Users/christaylor/Projects/chris-assistant"),
}));

vi.mock("../src/providers/shared.js", () => ({
  getCodexSystemPrompt: vi.fn(async () => "system prompt"),
  getRecalledMemoryPrompt: vi.fn(async () => ""),
  invalidatePromptCache: vi.fn(),
}));

import { createCodexAgentProvider } from "../src/providers/codex-agent.js";

describe("createCodexAgentProvider", () => {
  it("starts Codex threads with a workspace-scoped sandbox and strips the model prefix case-insensitively", async () => {
    fixtures.startThread.mockReturnValueOnce(fixtures.createThread("thread-1"));

    const provider = createCodexAgentProvider("CODEX-AGENT-gpt-5.4-mini");
    const chunks: string[] = [];
    const response = await provider.chat(123, "hello", (chunk) => chunks.push(chunk));

    expect(response).toBe("done");
    expect(chunks).toEqual(["done"]);
    expect(fixtures.startThread).toHaveBeenCalledWith({
      model: "gpt-5.4-mini",
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
      skipGitRepoCheck: true,
      workingDirectory: "/Users/christaylor/Projects/chris-assistant",
    });
    expect(fixtures.startThread.mock.calls[0][0]).not.toHaveProperty("additionalDirectories");
    expect(fixtures.setThreadId).toHaveBeenCalledWith(123, "thread-1");
  });
});
