import { config } from "../config.js";
import { createClaudeProvider } from "./claude.js";
import { createMiniMaxProvider } from "./minimax.js";
import type { Provider } from "./types.js";

export { invalidatePromptCache } from "./shared.js";

function resolveProvider(): Provider {
  const model = config.model;
  console.log("[provider] Using model: %s", model);

  if (model.startsWith("MiniMax")) {
    return createMiniMaxProvider(model);
  }

  // Default: Claude
  return createClaudeProvider(model);
}

let activeProvider: Provider | null = null;

function getProvider(): Provider {
  if (!activeProvider) {
    activeProvider = resolveProvider();
  }
  return activeProvider;
}

export async function chat(chatId: number, userMessage: string): Promise<string> {
  return getProvider().chat(chatId, userMessage);
}
