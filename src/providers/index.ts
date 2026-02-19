import { config } from "../config.js";
import { createClaudeProvider } from "./claude.js";
import { createMiniMaxProvider } from "./minimax.js";
import { createOpenAiProvider } from "./openai.js";
import type { Provider, ImageAttachment } from "./types.js";

export type { ImageAttachment } from "./types.js";
export { invalidatePromptCache } from "./shared.js";

function isOpenAiModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-");
}

function resolveProvider(): Provider {
  const model = config.model;
  console.log("[provider] Using model: %s", model);

  if (isOpenAiModel(model)) {
    return createOpenAiProvider(model);
  }

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

export async function chat(
  chatId: number,
  userMessage: string,
  onChunk?: (accumulated: string) => void,
  image?: ImageAttachment,
): Promise<string> {
  return getProvider().chat(chatId, userMessage, onChunk, image);
}
