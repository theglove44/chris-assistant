/**
 * Centralized model → provider detection.
 *
 * All provider-detection logic lives here so runtime, CLI, and Telegram
 * stay in sync when new providers or model prefixes are added.
 */

export type ProviderName = "openai" | "minimax" | "claude" | "codex-agent";

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
  return !isCodexAgentModel(model) && !isOpenAiModel(model) && !isMiniMaxModel(model);
}

export function providerForModel(model: string): ProviderName {
  if (isCodexAgentModel(model)) return "codex-agent";
  if (isOpenAiModel(model)) return "openai";
  if (isMiniMaxModel(model)) return "minimax";
  return "claude";
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
