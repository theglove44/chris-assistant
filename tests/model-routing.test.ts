import { describe, expect, it } from "vitest";
import {
  isClaudeModel,
  isCodexAgentModel,
  isMiniMaxModel,
  isOpenAiModel,
  providerForModel,
  strictProviderForModel,
} from "../src/providers/model-routing.js";

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

describe("isClaudeModel", () => {
  it("recognises real Claude model IDs (lowercase claude- prefix)", () => {
    expect(isClaudeModel("claude-opus-4-6")).toBe(true);
    expect(isClaudeModel("claude-sonnet-4-6")).toBe(true);
    expect(isClaudeModel("claude-sonnet-4-5-20250929")).toBe(true);
    expect(isClaudeModel("claude-haiku-4-5-20251001")).toBe(true);
  });

  it("is case-insensitive for the claude- prefix", () => {
    // The check is model.toLowerCase().startsWith("claude-"), so Claude- works too
    expect(isClaudeModel("Claude-opus-4-6")).toBe(true);
    expect(isClaudeModel("CLAUDE-sonnet-4-6")).toBe(true);
  });

  it("rejects non-Claude models", () => {
    expect(isClaudeModel("gpt-4o")).toBe(false);
    expect(isClaudeModel("o3")).toBe(false);
    expect(isClaudeModel("MiniMax-M2.5")).toBe(false);
    expect(isClaudeModel("codex-agent-v2")).toBe(false);
  });

  it("rejects bare 'claude' with no dash", () => {
    // The prefix must be "claude-" to qualify
    expect(isClaudeModel("claude")).toBe(false);
    expect(isClaudeModel("claudesonnet")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

describe("isOpenAiModel", () => {
  it("recognises gpt- models", () => {
    expect(isOpenAiModel("gpt-4o")).toBe(true);
    expect(isOpenAiModel("gpt-4o-mini")).toBe(true);
    expect(isOpenAiModel("gpt-4.1")).toBe(true);
    expect(isOpenAiModel("gpt-4.1-mini")).toBe(true);
    expect(isOpenAiModel("gpt-4.1-nano")).toBe(true);
    expect(isOpenAiModel("gpt-5.2")).toBe(true);
    expect(isOpenAiModel("gpt-5.2-chat-latest")).toBe(true);
    expect(isOpenAiModel("gpt-5.2-pro")).toBe(true);
  });

  it("recognises o3* models", () => {
    expect(isOpenAiModel("o3")).toBe(true);
    expect(isOpenAiModel("o3-mini")).toBe(true);
    expect(isOpenAiModel("o3-pro")).toBe(true);
    expect(isOpenAiModel("o3-deep-research")).toBe(true);
  });

  it("recognises o4- models", () => {
    expect(isOpenAiModel("o4-mini")).toBe(true);
    expect(isOpenAiModel("o4-mini-deep-research")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isOpenAiModel("GPT-4o")).toBe(true);
    expect(isOpenAiModel("O3-mini")).toBe(true);
    expect(isOpenAiModel("O4-mini")).toBe(true);
  });

  it("rejects non-OpenAI models", () => {
    expect(isOpenAiModel("claude-sonnet-4-6")).toBe(false);
    expect(isOpenAiModel("MiniMax-M2.5")).toBe(false);
    expect(isOpenAiModel("codex-agent-v2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MiniMax
// ---------------------------------------------------------------------------

describe("isMiniMaxModel", () => {
  it("recognises real MiniMax model IDs", () => {
    expect(isMiniMaxModel("MiniMax-M2.5")).toBe(true);
    expect(isMiniMaxModel("MiniMax-M2.5-highspeed")).toBe(true);
  });

  it("is CASE-SENSITIVE — must start with capital MiniMax", () => {
    // The check is model.startsWith("MiniMax") — no .toLowerCase()
    expect(isMiniMaxModel("minimax-M2.5")).toBe(false);
    expect(isMiniMaxModel("MINIMAX-M2.5")).toBe(false);
    expect(isMiniMaxModel("miniMax-M2.5")).toBe(false);
  });

  it("rejects non-MiniMax models", () => {
    expect(isMiniMaxModel("gpt-4o")).toBe(false);
    expect(isMiniMaxModel("claude-opus-4-6")).toBe(false);
    expect(isMiniMaxModel("codex-agent-v2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Codex Agent
// ---------------------------------------------------------------------------

describe("isCodexAgentModel", () => {
  it("recognises codex-agent models", () => {
    expect(isCodexAgentModel("codex-agent-v2")).toBe(true);
    expect(isCodexAgentModel("codex-agent-latest")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isCodexAgentModel("CODEX-AGENT-v2")).toBe(true);
    expect(isCodexAgentModel("Codex-Agent-latest")).toBe(true);
  });

  it("rejects non-Codex models", () => {
    expect(isCodexAgentModel("gpt-4o")).toBe(false);
    expect(isCodexAgentModel("claude-sonnet-4-6")).toBe(false);
    expect(isCodexAgentModel("MiniMax-M2.5")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// providerForModel — hot-path helper (falls back to claude for unknowns)
// ---------------------------------------------------------------------------

describe("providerForModel", () => {
  it("maps codex-agent models", () => {
    expect(providerForModel("codex-agent-v2")).toBe("codex-agent");
  });

  it("maps OpenAI models", () => {
    expect(providerForModel("gpt-5.2")).toBe("openai");
    expect(providerForModel("o3-mini")).toBe("openai");
    expect(providerForModel("o4-mini")).toBe("openai");
  });

  it("maps MiniMax models", () => {
    expect(providerForModel("MiniMax-M2.5")).toBe("minimax");
  });

  it("maps claude- models", () => {
    expect(providerForModel("claude-sonnet-4-6")).toBe("claude");
    expect(providerForModel("claude-opus-4-6")).toBe("claude");
  });

  it("falls through to claude for truly unrecognised strings (legacy hot-path behaviour)", () => {
    // The hot-path intentionally does NOT throw — use strictProviderForModel for that
    expect(providerForModel("totally-unknown-model")).toBe("claude");
  });
});

// ---------------------------------------------------------------------------
// strictProviderForModel — startup validation
// ---------------------------------------------------------------------------

describe("strictProviderForModel", () => {
  it("accepts codex-agent models", () => {
    expect(strictProviderForModel("codex-agent-v2")).toBe("codex-agent");
  });

  it("accepts OpenAI models", () => {
    expect(strictProviderForModel("gpt-4o")).toBe("openai");
    expect(strictProviderForModel("gpt-5.2")).toBe("openai");
    expect(strictProviderForModel("o3")).toBe("openai");
    expect(strictProviderForModel("o4-mini")).toBe("openai");
  });

  it("accepts MiniMax models", () => {
    expect(strictProviderForModel("MiniMax-M2.5")).toBe("minimax");
    expect(strictProviderForModel("MiniMax-M2.5-highspeed")).toBe("minimax");
  });

  it("accepts Claude models", () => {
    expect(strictProviderForModel("claude-sonnet-4-6")).toBe("claude");
    expect(strictProviderForModel("claude-opus-4-6")).toBe("claude");
    expect(strictProviderForModel("claude-haiku-4-5-20251001")).toBe("claude");
  });

  // --- Typo / case-sensitivity negative cases ---

  it("does NOT throw for a GPT model with wrong capitalisation — gpt- check is case-insensitive", () => {
    // "Gpt-4o" lowercases to "gpt-4o" which matches gpt- prefix, so it is accepted as openai
    expect(strictProviderForModel("Gpt-4o")).toBe("openai");
  });

  it("throws for a MiniMax typo with wrong capitalisation", () => {
    // minimax- (all lowercase) is not matched by startsWith("MiniMax")
    expect(() => strictProviderForModel("minimax-M2.5")).toThrow(/Unknown model "minimax-M2.5"/);
  });

  it("throws for a claude model missing the dash", () => {
    // "claude" alone has no dash — not matched by claude- prefix check
    expect(() => strictProviderForModel("claude")).toThrow(/Unknown model "claude"/);
  });

  it("throws for a completely unknown string", () => {
    expect(() => strictProviderForModel("foo")).toThrow(/Unknown model "foo"/);
  });

  it("throws for an empty string", () => {
    expect(() => strictProviderForModel("")).toThrow(/Unknown model ""/);
  });

  it("error message lists supported prefixes", () => {
    let message = "";
    try {
      strictProviderForModel("bad-model-xyz");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/gpt-/);
    expect(message).toMatch(/claude-/);
    expect(message).toMatch(/MiniMax-/);
    expect(message).toMatch(/codex-agent-/);
  });
});
