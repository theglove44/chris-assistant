import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  dispatchToolCall: vi.fn(async () => "tool result"),
  recordUsage: vi.fn(),
  invalidatePromptCache: vi.fn(),
  config: {
    maxToolTurns: 5,
    reasoningEffort: "max" as const,
    deepseek: {
      apiKey: "mock-deepseek-key",
      thinking: "enabled" as const,
    },
  },
}));

vi.mock("../src/config.js", () => ({ config: fixtures.config }));
vi.mock("../src/conversation.js", () => ({ formatHistoryForPrompt: vi.fn(async () => "Earlier context") }));
vi.mock("../src/providers/shared.js", () => ({
  getSystemPrompt: vi.fn(async () => "Chris system prompt"),
  invalidatePromptCache: fixtures.invalidatePromptCache,
}));
vi.mock("../src/tools/index.js", () => ({
  getOpenAiToolDefinitions: vi.fn(() => [{
    type: "function",
    function: { name: "remember", description: "Remember text", parameters: { type: "object" } },
  }]),
  dispatchToolCall: fixtures.dispatchToolCall,
}));
vi.mock("../src/usage-tracker.js", () => ({ recordUsage: fixtures.recordUsage }));

import {
  abortDeepSeekQuery,
  createDeepSeekProvider,
  DeepSeekApiError,
  isRetryableDeepSeekError,
} from "../src/providers/deepseek.js";

function sseResponse(events: unknown[], status = 200, headers?: HeadersInit): Response {
  const body = events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status, headers: { "content-type": "text/event-stream", ...headers } });
}

describe("DeepSeek provider contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fixtures.dispatchToolCall.mockClear();
    fixtures.recordUsage.mockClear();
    fixtures.invalidatePromptCache.mockClear();
    fixtures.config.deepseek.apiKey = "mock-deepseek-key";
    fixtures.config.deepseek.thinking = "enabled";
    fixtures.config.reasoningEffort = "max";
  });

  it("streams text, sends thinking configuration, shared tools, and records usage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(sseResponse([
      { choices: [{ delta: { reasoning_content: "private reasoning" } }], usage: null },
      { choices: [{ delta: { content: "Hello" } }], usage: null },
      { choices: [{ delta: { content: " Chris" } }], usage: null },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } },
      "[DONE]",
    ]));

    const chunks: string[] = [];
    const result = await createDeepSeekProvider("deepseek-v4-pro").chat(42, "Hi", (text) => chunks.push(text));

    expect(result).toBe("Hello Chris");
    expect(chunks).toEqual(["Hello", "Hello Chris"]);
    const request = fetchMock.mock.calls[0][1]!;
    expect(request.headers).toEqual(expect.objectContaining({ Authorization: "Bearer mock-deepseek-key" }));
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({
      model: "deepseek-v4-pro",
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });
    expect(body).toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.messages[1].content).toContain("Earlier context");
    expect(fixtures.recordUsage).toHaveBeenCalledWith({
      inputTokens: 12,
      outputTokens: 7,
      model: "deepseek-v4-pro",
      provider: "deepseek",
    });
  });

  it("preserves and replays reasoning_content through a streamed tool-call loop", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sseResponse([
        { choices: [{ delta: { reasoning_content: "need a tool" } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "remember", arguments: "{\"text\":" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"fact\"}" } }] } }] },
        "[DONE]",
      ]))
      .mockResolvedValueOnce(sseResponse([
        { choices: [{ delta: { content: "Done" } }] },
        "[DONE]",
      ]));

    const result = await createDeepSeekProvider("deepseek-v4-flash").chat(42, "Remember this");

    expect(result).toBe("Done");
    expect(fixtures.dispatchToolCall).toHaveBeenCalledWith("remember", "{\"text\":\"fact\"}", "deepseek");
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(secondBody.messages).toContainEqual({
      role: "assistant",
      content: "",
      reasoning_content: "need a tool",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "remember", arguments: "{\"text\":\"fact\"}" },
      }],
    });
    expect(secondBody.messages).toContainEqual({ role: "tool", content: "tool result", tool_call_id: "call-1" });
  });

  it("classifies retryable failures and retries a 429 without exposing credentials", async () => {
    expect(isRetryableDeepSeekError(new DeepSeekApiError(429, "rate limited"))).toBe(true);
    expect(isRetryableDeepSeekError(new DeepSeekApiError(503, "busy"))).toBe(true);
    expect(isRetryableDeepSeekError(new DeepSeekApiError(401, "bad key"))).toBe(false);

    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(sseResponse([{ choices: [{ delta: { content: "Recovered" } }] }, "[DONE]"]));

    await expect(createDeepSeekProvider("deepseek-v4-flash").chat(42, "Hi")).resolves.toBe("Recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels an active streaming request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    const pending = createDeepSeekProvider("deepseek-v4-pro").chat(99, "Long task");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(abortDeepSeekQuery(99)).toBe(true);
    await expect(pending).resolves.toBe("Stopped.");
  });
});
