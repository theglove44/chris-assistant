import { describe, expect, it } from "vitest";
import {
  reasoningEffortReport,
  resolveReasoningEffort,
  underlyingOpenAiModel,
} from "../src/providers/model-routing.js";

describe("GPT-5.6 reasoning capabilities", () => {
  it("normalises Responses and Codex Agent model IDs and applies backend defaults", () => {
    expect(underlyingOpenAiModel("gpt-5.6")).toBe("gpt-5.6-sol");
    expect(underlyingOpenAiModel("CODEX-AGENT-gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(resolveReasoningEffort("gpt-5.6-sol", null)?.effective).toBe("low");
    expect(resolveReasoningEffort("codex-agent-gpt-5.6-luna", null)?.effective).toBe("medium");
  });

  it("validates model-specific efforts", () => {
    expect(resolveReasoningEffort("gpt-5.6-sol", "ultra")?.effective).toBe("ultra");
    expect(resolveReasoningEffort("gpt-5.6-luna", "max")?.effective).toBe("max");
    expect(() => resolveReasoningEffort("gpt-5.6-luna", "ultra")).toThrow(/not supported/);
    expect(() => resolveReasoningEffort("gpt-5.5", "high")).toThrow(/not configured/);
  });

  it("reports requested and effective effort separately", () => {
    expect(reasoningEffortReport("gpt-5.6-terra", null)).toBe(
      "Requested effort: default\nEffective effort: medium",
    );
    expect(reasoningEffortReport("gpt-5.6-terra", "high")).toBe(
      "Requested effort: high\nEffective effort: high",
    );
  });
});
