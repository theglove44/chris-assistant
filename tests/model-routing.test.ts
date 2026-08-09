import { describe, expect, it } from "vitest";
import {
  MODEL_REGISTRY,
  isCodexAgentModel,
  isDeepSeekModel,
  isGrokAgentModel,
  isOpenAiModel,
  providerCapabilitiesForModel,
  providerForModel,
  resolveModelAlias,
  resolveReasoningEffort,
  strictProviderForModel,
} from "../src/providers/model-routing.js";

describe("authoritative model registry", () => {
  it.each([
    ["gpt-5.6-terra", "openai"],
    ["codex-agent-gpt-5.6-sol", "codex-agent"],
    ["grok-agent-grok-4.5", "grok-agent"],
    ["deepseek-v4-flash", "deepseek"],
  ] as const)("routes %s to %s", (model, provider) => {
    expect(providerForModel(model)).toBe(provider);
  });

  it("uses case-insensitive prefix helpers without treating unknown IDs as a provider", () => {
    expect(isOpenAiModel("GPT-5.6-SOL")).toBe(true);
    expect(isCodexAgentModel("CODEX-AGENT-GPT-5.6-SOL")).toBe(true);
    expect(isGrokAgentModel("GROK-AGENT-GROK-4.5")).toBe(true);
    expect(isDeepSeekModel("DEEPSEEK-V4-PRO")).toBe(true);
    expect(isOpenAiModel("unknown")).toBe(false);
  });

  it("rejects unknown and removed providers explicitly", () => {
    expect(() => strictProviderForModel("totally-unknown-model")).toThrow(/Unknown model/);
    expect(() => strictProviderForModel(["clau", "de-sonnet-4-6"].join(""))).toThrow(/Unknown model/);
  });

  it("resolves aliases from the same registry", () => {
    expect(resolveModelAlias("terra")).toBe("gpt-5.6-terra");
    expect(resolveModelAlias("sol")).toBe("gpt-5.6-sol");
    expect(resolveModelAlias("codex-agent")).toBe("codex-agent-gpt-5.6");
    expect(resolveModelAlias("grok")).toBe("grok-agent-grok-4.5");
    expect(resolveModelAlias("deepseek-pro")).toBe("deepseek-v4-pro");
    expect(MODEL_REGISTRY.map((entry) => entry.provider)).not.toContain(["clau", "de"].join(""));
  });
});

describe("provider capability contract", () => {
  it.each([
    ["gpt-5.6-terra", "personal-assistant", true, true, true, false, true],
    ["codex-agent-gpt-5.6-terra", "coding-agent", true, false, false, true, false],
    ["grok-agent-grok-4.5", "coding-agent", false, false, false, true, false],
    ["deepseek-v4-pro", "personal-assistant", true, true, false, false, true],
  ] as const)("describes %s", (model, mode, memoryRead, memoryWrite, vision, nativeCodingTools, schedulerSuitable) => {
    expect(providerCapabilitiesForModel(model)).toMatchObject({
      mode, memoryRead, memoryWrite, vision, nativeCodingTools, schedulerSuitable,
    });
  });
});

describe("reasoning effort validation", () => {
  it("reports model defaults and validates provider-specific values", () => {
    expect(resolveReasoningEffort("gpt-5.6-terra", null)?.effective).toBe("medium");
    expect(resolveReasoningEffort("deepseek-v4-flash", null)?.effective).toBe("high");
    expect(resolveReasoningEffort("grok-agent-grok-4.5", null)?.effective).toBeNull();
    expect(resolveReasoningEffort("grok-agent-grok-4.5", "max")?.effective).toBe("max");
    expect(() => resolveReasoningEffort("deepseek-v4-pro", "medium")).toThrow(/not supported/);
    expect(() => resolveReasoningEffort("grok-agent-grok-4.5", "ultra")).toThrow(/not supported/);
  });
});
