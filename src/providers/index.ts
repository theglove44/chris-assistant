import { chatService } from "../agent/chat-service.js";
import type { ImageAttachment } from "./types.js";

export type { ImageAttachment } from "./types.js";
export { invalidatePromptCache } from "./shared.js";

export async function chat(
  chatId: number,
  userMessage: string,
  onChunk?: (accumulated: string) => void,
  images?: ImageAttachment[],
  allowedTools?: string[],
): Promise<string> {
  return chatService.sendMessage({ chatId, userMessage, onChunk, images, allowedTools });
}

export function clearActiveProviderSession(chatId: number): void {
  chatService.clearSession(chatId);
}

export function abortActiveProviderQuery(chatId: number): boolean {
  return chatService.abort(chatId);
}

export function getActiveProviderSessionInfo(chatId: number): string | null {
  return chatService.getSessionInfo(chatId);
}
