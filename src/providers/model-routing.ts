/**
 * Centralized model → provider detection.
 *
 * All provider-detection logic lives here so runtime, CLI, and Telegram
 * stay in sync when new providers or model prefixes are added.
 */

export type ProviderName = "openai" | "minimax" | "claude";

export function isOpenAiModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-");
}

export function isMiniMaxModel(model: string): boolean {
  return model.startsWith("MiniMax");
}

export function isClaudeModel(model: string): boolean {
  return !isOpenAiModel(model) && !isMiniMaxModel(model);
}

export function providerForModel(model: string): ProviderName {
  if (isOpenAiModel(model)) return "openai";
  if (isMiniMaxModel(model)) return "minimax";
  return "claude";
}

const DISPLAY_NAMES: Record<ProviderName, string> = {
  openai: "OpenAI",
  minimax: "MiniMax",
  claude: "Claude",
};

export function providerDisplayName(model: string): string {
  return DISPLAY_NAMES[providerForModel(model)];
}
