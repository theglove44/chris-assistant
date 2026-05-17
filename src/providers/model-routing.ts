/**
 * Centralized model → provider detection.
 *
 * All provider-detection logic lives here so runtime, CLI, and Telegram
 * stay in sync when new providers or model prefixes are added.
 *
 * Case-sensitivity notes:
 * - codex-agent: case-insensitive (lowercased before check)
 * - gpt-*, o3*, o4-*: case-insensitive (lowercased before check)
 * - claude-*: anything not matched by the above; claude- prefix is NOT checked
 */

export type ProviderName = "openai" | "claude" | "codex-agent";

export interface ProviderCapabilities {
  mode: "personal-assistant" | "coding-agent" | "general-chat";
  summary: string;
  memoryRead: boolean;
  memoryWrite: boolean;
  semanticRecall: boolean;
  journal: boolean;
  nativeCodingTools: boolean;
  vision: boolean;
  schedulerSuitable: boolean;
}

/** Prefixes accepted by each provider, shown in error messages. */
export const SUPPORTED_PREFIXES: Record<ProviderName, string[]> = {
  "codex-agent": ["codex-agent-"],
  openai: ["gpt-", "o3", "o4-"],
  claude: ["claude-"],
};

export function isCodexAgentModel(model: string): boolean {
  return model.toLowerCase().startsWith("codex-agent");
}

export function isOpenAiModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-");
}

export function isClaudeModel(model: string): boolean {
  return model.toLowerCase().startsWith("claude-");
}

export function providerForModel(model: string): ProviderName {
  if (isCodexAgentModel(model)) return "codex-agent";
  if (isOpenAiModel(model)) return "openai";
  return "claude";
}

/**
 * Strict variant: returns the provider name or throws a descriptive error.
 *
 * Use this at startup / config-validation time. The hot-path helpers above
 * (`providerForModel`, `isXxxModel`) remain unchanged for runtime use.
 *
 * A model is accepted when it matches one of:
 *   - codex-agent* (case-insensitive)
 *   - gpt-*, o3*, o4-* (case-insensitive)
 *   - claude-* (case-insensitive)
 *
 * Anything else throws so the operator gets a clear message at startup.
 */
export function strictProviderForModel(model: string): ProviderName {
  if (isCodexAgentModel(model)) return "codex-agent";
  if (isOpenAiModel(model)) return "openai";
  if (isClaudeModel(model)) return "claude";

  const allPrefixes = Object.values(SUPPORTED_PREFIXES).flat().join(", ");
  throw new Error(`Unknown model "${model}". Supported prefixes: ${allPrefixes}.`);
}

const DISPLAY_NAMES: Record<ProviderName, string> = {
  openai: "OpenAI",
  claude: "Claude",
  "codex-agent": "OpenAI Codex Agent",
};

export const PROVIDER_CAPABILITIES: Record<ProviderName, ProviderCapabilities> = {
  claude: {
    mode: "personal-assistant",
    summary: "Default personal assistant path with memory, journal, recall, scheduler, and Claude Agent coding tools.",
    memoryRead: true,
    memoryWrite: true,
    semanticRecall: true,
    journal: true,
    nativeCodingTools: true,
    vision: false,
    schedulerSuitable: true,
  },
  openai: {
    mode: "personal-assistant",
    summary: "Personal assistant path using the shared tool registry and provider-wide memory recall.",
    memoryRead: true,
    memoryWrite: true,
    semanticRecall: true,
    journal: true,
    nativeCodingTools: false,
    vision: true,
    schedulerSuitable: true,
  },
  "codex-agent": {
    mode: "coding-agent",
    summary: "Coding-focused Codex CLI agent with native workspace tools; assistant memory context is injected, but custom memory/journal tools are not yet wired directly.",
    memoryRead: true,
    memoryWrite: false,
    semanticRecall: true,
    journal: false,
    nativeCodingTools: true,
    vision: false,
    schedulerSuitable: false,
  },
};

export function providerDisplayName(model: string): string {
  return DISPLAY_NAMES[providerForModel(model)];
}

export function providerCapabilitiesForModel(model: string): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[providerForModel(model)];
}

export function providerCapabilitySummary(model: string): string {
  const capabilities = providerCapabilitiesForModel(model);
  const yesNo = (value: boolean) => (value ? "yes" : "no");
  return [
    `Mode: ${capabilities.mode}`,
    `Memory read: ${yesNo(capabilities.memoryRead)}`,
    `Memory write: ${yesNo(capabilities.memoryWrite)}`,
    `Semantic recall: ${yesNo(capabilities.semanticRecall)}`,
    `Journal: ${yesNo(capabilities.journal)}`,
    `Native coding tools: ${yesNo(capabilities.nativeCodingTools)}`,
    `Vision: ${yesNo(capabilities.vision)}`,
    `Scheduler suitable: ${yesNo(capabilities.schedulerSuitable)}`,
  ].join("\n");
}
