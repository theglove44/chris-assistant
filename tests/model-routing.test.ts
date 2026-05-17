import { describe, expect, it } from "vitest";
import {
  isClaudeModel,
  isCodexAgentModel,
  isOpenAiModel,
  providerCapabilitiesForModel,
  providerCapabilitySummary,
  providerForModel,
  providerDisplayName,
  strictProviderForModel,
} from "../src/providers/model-routing.js";

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

describe("isClaudeModel", () => {
  it("recognises real Claude model IDs (lowercase claude- prefix)", () => {
    expect(isClaudeModel("claude-opus-4-7")).toBe(true);
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
    expect(isOpenAiModel("gpt-5.5")).toBe(true);
    expect(isOpenAiModel("gpt-5.4")).toBe(true);
    expect(isOpenAiModel("gpt-5.4-mini")).toBe(true);
    expect(isOpenAiModel("gpt-5.3-codex")).toBe(true);
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
    expect(providerForModel("gpt-5.5")).toBe("openai");
    expect(providerForModel("gpt-5.2")).toBe("openai");
    expect(providerForModel("o3-mini")).toBe("openai");
    expect(providerForModel("o4-mini")).toBe("openai");
  });

  it("maps claude- models", () => {
    expect(providerForModel("claude-sonnet-4-6")).toBe("claude");
    expect(providerForModel("claude-opus-4-7")).toBe("claude");
  });

  it("falls through to claude for truly unrecognised strings (legacy hot-path behaviour)", () => {
    // The hot-path intentionally does NOT throw — use strictProviderForModel for that
    expect(providerForModel("totally-unknown-model")).toBe("claude");
  });
});

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

describe("providerDisplayName", () => {
  it("uses the Codex Agent display name for codex-agent models", () => {
    expect(providerDisplayName("codex-agent-gpt-5.3-codex")).toBe("OpenAI Codex Agent");
  });
});

describe("providerCapabilitiesForModel", () => {
  it("describes Claude as the default personal assistant path", () => {
    const capabilities = providerCapabilitiesForModel("claude-sonnet-4-6");
    expect(capabilities.mode).toBe("personal-assistant");
    expect(capabilities.memoryRead).toBe(true);
    expect(capabilities.memoryWrite).toBe(true);
    expect(capabilities.semanticRecall).toBe(true);
    expect(capabilities.journal).toBe(true);
    expect(capabilities.nativeCodingTools).toBe(true);
    expect(capabilities.schedulerSuitable).toBe(true);
  });

  it("describes OpenAI Responses as assistant-capable with vision but no native agent tools", () => {
    const capabilities = providerCapabilitiesForModel("gpt-5.5");
    expect(capabilities.mode).toBe("personal-assistant");
    expect(capabilities.memoryRead).toBe(true);
    expect(capabilities.memoryWrite).toBe(true);
    expect(capabilities.semanticRecall).toBe(true);
    expect(capabilities.journal).toBe(true);
    expect(capabilities.nativeCodingTools).toBe(false);
    expect(capabilities.vision).toBe(true);
    expect(capabilities.schedulerSuitable).toBe(true);
  });

  it("describes Codex Agent as coding-focused until custom tools are wired", () => {
    const capabilities = providerCapabilitiesForModel("codex-agent-gpt-5.3-codex");
    expect(capabilities.mode).toBe("coding-agent");
    expect(capabilities.memoryRead).toBe(true);
    expect(capabilities.memoryWrite).toBe(false);
    expect(capabilities.semanticRecall).toBe(true);
    expect(capabilities.journal).toBe(false);
    expect(capabilities.nativeCodingTools).toBe(true);
    expect(capabilities.vision).toBe(false);
    expect(capabilities.schedulerSuitable).toBe(false);
  });

});

describe("providerCapabilitySummary", () => {
  it("renders concise yes/no capability lines", () => {
    expect(providerCapabilitySummary("codex-agent-gpt-5.3-codex")).toContain("Memory write: no");
    expect(providerCapabilitySummary("codex-agent-gpt-5.3-codex")).toContain("Native coding tools: yes");
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
    expect(strictProviderForModel("gpt-5.5")).toBe("openai");
    expect(strictProviderForModel("gpt-5.4")).toBe("openai");
    expect(strictProviderForModel("gpt-5.3-codex")).toBe("openai");
    expect(strictProviderForModel("gpt-5.2")).toBe("openai");
    expect(strictProviderForModel("o3")).toBe("openai");
    expect(strictProviderForModel("o4-mini")).toBe("openai");
  });

  it("throws for MiniMax models", () => {
    expect(() => strictProviderForModel("MiniMax-M2.5")).toThrow(/Unknown model "MiniMax-M2.5"/);
    expect(() => strictProviderForModel("MiniMax-M2.5-highspeed")).toThrow(
      /Unknown model "MiniMax-M2.5-highspeed"/,
    );
    expect(() => strictProviderForModel("MiniMax-M2.7")).toThrow(/Unknown model "MiniMax-M2.7"/);
    expect(() => strictProviderForModel("MiniMax-M2.7-highspeed")).toThrow(
      /Unknown model "MiniMax-M2.7-highspeed"/,
    );
  });

  it("accepts Claude models", () => {
    expect(strictProviderForModel("claude-sonnet-4-6")).toBe("claude");
    expect(strictProviderForModel("claude-opus-4-7")).toBe("claude");
    expect(strictProviderForModel("claude-haiku-4-5-20251001")).toBe("claude");
  });

  // --- Typo / case-sensitivity negative cases ---

  it("does NOT throw for a GPT model with wrong capitalisation — gpt- check is case-insensitive", () => {
    // "Gpt-4o" lowercases to "gpt-4o" which matches gpt- prefix, so it is accepted as openai
    expect(strictProviderForModel("Gpt-4o")).toBe("openai");
  });

  it("throws for lowercase MiniMax strings", () => {
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
    expect(message).not.toMatch(/MiniMax/);
    expect(message).toMatch(/codex-agent-/);
  });
});
