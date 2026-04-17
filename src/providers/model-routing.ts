/**
 * Centralized model → provider detection.
 *
 * All provider-detection logic lives here so runtime, CLI, and Telegram
 * stay in sync when new providers or model prefixes are added.
 *
 * Case-sensitivity notes:
 * - codex-agent: case-insensitive (lowercased before check)
 * - gpt-*, o3*, o4-*: case-insensitive (lowercased before check)
 * - MiniMax-*: CASE-SENSITIVE — must start with capital "MiniMax"
 * - claude-*: anything not matched by the above; claude- prefix is NOT checked
 */

export type ProviderName = "openai" | "minimax" | "claude" | "codex-agent";

/** Prefixes accepted by each provider, shown in error messages. */
export const SUPPORTED_PREFIXES: Record<ProviderName, string[]> = {
  "codex-agent": ["codex-agent-"],
  openai: ["gpt-", "o3", "o4-"],
  minimax: ["MiniMax-"],
  claude: ["claude-"],
};

export function isCodexAgentModel(model: string): boolean {
  return model.toLowerCase().startsWith("codex-agent");
}

export function isOpenAiModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-");
}

export function isMiniMaxModel(model: string): boolean {
  return model.startsWith("MiniMax");
}

export function isClaudeModel(model: string): boolean {
  return model.toLowerCase().startsWith("claude-");
}

export function providerForModel(model: string): ProviderName {
  if (isCodexAgentModel(model)) return "codex-agent";
  if (isOpenAiModel(model)) return "openai";
  if (isMiniMaxModel(model)) return "minimax";
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
 *   - MiniMax-* (case-sensitive — capital M and M)
 *   - claude-* (case-insensitive)
 *
 * Anything else throws so the operator gets a clear message at startup.
 */
export function strictProviderForModel(model: string): ProviderName {
  if (isCodexAgentModel(model)) return "codex-agent";
  if (isOpenAiModel(model)) return "openai";
  if (isMiniMaxModel(model)) return "minimax";
  if (isClaudeModel(model)) return "claude";

  const allPrefixes = Object.values(SUPPORTED_PREFIXES).flat().join(", ");
  throw new Error(
    `Unknown model "${model}". Supported prefixes: ${allPrefixes}. ` +
      `Check AI_MODEL in your environment — MiniMax prefix is case-sensitive (MiniMax-).`,
  );
}

const DISPLAY_NAMES: Record<ProviderName, string> = {
  openai: "OpenAI",
  minimax: "MiniMax",
  claude: "Claude",
  "codex-agent": "OpenAI Codex Agent",
};

export function providerDisplayName(model: string): string {
  return DISPLAY_NAMES[providerForModel(model)];
}
