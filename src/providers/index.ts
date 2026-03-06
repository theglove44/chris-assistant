import { config } from "../config.js";
import { clearSession, getSessionId } from "../claude-sessions.js";
import { createClaudeProvider, abortClaudeQuery } from "./claude.js";
import { createMiniMaxProvider } from "./minimax.js";
import { isOpenAiModel, isMiniMaxModel, isClaudeModel } from "./model-routing.js";
import { createOpenAiProvider } from "./openai.js";
import type { Provider, ImageAttachment } from "./types.js";

export type { ImageAttachment } from "./types.js";
export { invalidatePromptCache } from "./shared.js";

function resolveProvider(): Provider {
  const model = config.model;
  console.log("[provider] Using model: %s", model);

  if (isOpenAiModel(model)) {
    return createOpenAiProvider(model);
  }

  if (isMiniMaxModel(model)) {
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
  images?: ImageAttachment[],
  allowedTools?: string[],
): Promise<string> {
  // When images are attached, always route to the designated image model
  // (OpenAI) regardless of the active provider — MiniMax and Claude can't
  // reliably handle vision via this integration.
  if (images && images.length > 0) {
    const imageModel = config.imageModel;
    console.log("[provider] %d image(s) detected — routing to image model: %s", images.length, imageModel);
    return createOpenAiProvider(imageModel).chat(chatId, userMessage, onChunk, images, allowedTools);
  }
  return getProvider().chat(chatId, userMessage, onChunk, images, allowedTools);
}

/**
 * Clear the active provider's session state for a chat.
 * Currently only Claude has persistent sessions.
 */
export function clearActiveProviderSession(chatId: number): void {
  if (isClaudeModel(config.model)) {
    clearSession(chatId);
  }
}

/**
 * Abort the active provider's in-progress query for a chat.
 * Returns true if something was actually aborted.
 */
export function abortActiveProviderQuery(chatId: number): boolean {
  if (isClaudeModel(config.model)) {
    return abortClaudeQuery(chatId);
  }
  return false;
}

/**
 * Get session info string for the active provider, or null if not applicable.
 */
export function getActiveProviderSessionInfo(chatId: number): string | null {
  if (!isClaudeModel(config.model)) return null;
  const sessionId = getSessionId(chatId);
  if (!sessionId) return null;
  return `Claude session: ${sessionId.slice(0, 12)}...`;
}
