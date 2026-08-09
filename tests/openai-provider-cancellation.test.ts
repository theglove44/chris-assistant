import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: { maxToolTurns: 2, reasoningEffort: "high" },
}));

vi.mock("../src/providers/shared.js", () => ({
  getSystemPrompt: vi.fn(async () => "system prompt"),
  invalidatePromptCache: vi.fn(),
}));

vi.mock("../src/conversation.js", () => ({
  formatHistoryForPrompt: vi.fn(async () => ""),
}));

vi.mock("../src/tools/index.js", () => ({
  getOpenAiToolDefinitions: vi.fn(() => []),
  dispatchToolCall: vi.fn(),
}));

vi.mock("../src/providers/openai-oauth.js", () => ({
  getValidAccessToken: vi.fn(async () => "redacted-token"),
  getAccountId: vi.fn(() => "account-id"),
}));

vi.mock("../src/providers/compaction.js", () => ({
  needsCompaction: vi.fn(() => false),
  compactCodexInput: vi.fn(),
}));

vi.mock("../src/usage-tracker.js", () => ({ recordUsage: vi.fn() }));

import { abortOpenAiQuery, createOpenAiProvider } from "../src/providers/openai.js";

describe("OpenAI Responses cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    abortOpenAiQuery();
  });

  it("sends the verified reasoning object and aborts the live fetch", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = createOpenAiProvider("gpt-5.6-sol").chat(42, "hello");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(requestBody.reasoning).toEqual({ effort: "high" });
    expect(requestBody).not.toHaveProperty("reasoning_effort");
    expect(abortOpenAiQuery(42)).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    await expect(resultPromise).resolves.toBe("Stopped.");
    expect(abortOpenAiQuery(42)).toBe(false);
  });

  it("does not expose an upstream response body in diagnostics", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret upstream detail", { status: 400 })));

    await expect(createOpenAiProvider("gpt-5.6-sol").chat(43, "hello")).resolves.toBe(
      "Sorry, I hit an error processing that. Try again in a moment.",
    );

    expect(consoleError).toHaveBeenCalledWith("[openai] %s", "request failed with status 400");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret upstream detail");
  });
});
