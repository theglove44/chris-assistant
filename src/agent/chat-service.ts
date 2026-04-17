import { config } from "../config.js";
import { clearThread, getThreadId } from "../codex-sessions.js";
import { createClaudeProvider, abortClaudeQuery } from "../providers/claude.js";
import { createCodexAgentProvider, abortCodexQuery } from "../providers/codex-agent.js";
import { createMiniMaxProvider } from "../providers/minimax.js";
import { isOpenAiModel, isMiniMaxModel, isClaudeModel, isCodexAgentModel } from "../providers/model-routing.js";
import { createOpenAiProvider } from "../providers/openai.js";
import { resetLoopDetection } from "../tools/index.js";
import type { Provider, ImageAttachment } from "../providers/types.js";

export interface ChatRequest {
  chatId: number;
  userMessage: string;
  onChunk?: (accumulated: string) => void;
  images?: ImageAttachment[];
  allowedTools?: string[];
  maxTurns?: number;
}

export class ChatService {
  private activeProvider: Provider | null = null;

  private resolveProvider(): Provider {
    const model = config.model;
    console.log("[provider] Using model: %s", model);

    if (isCodexAgentModel(model)) {
      return createCodexAgentProvider(model);
    }

    if (isOpenAiModel(model)) {
      return createOpenAiProvider(model);
    }

    if (isMiniMaxModel(model)) {
      return createMiniMaxProvider(model);
    }

    return createClaudeProvider(model);
  }

  private getProvider(): Provider {
    if (!this.activeProvider) {
      this.activeProvider = this.resolveProvider();
    }
    return this.activeProvider;
  }

  async sendMessage({ chatId, userMessage, onChunk, images, allowedTools, maxTurns }: ChatRequest): Promise<string> {
    resetLoopDetection();

    if (images && images.length > 0) {
      const imageModel = config.imageModel;
      console.log("[provider] %d image(s) detected — routing to image model: %s", images.length, imageModel);
      const response = await createOpenAiProvider(imageModel).chat(chatId, userMessage, onChunk, images, allowedTools);
      this.clearSession(chatId);
      return response;
    }

    return this.getProvider().chat(chatId, userMessage, onChunk, images, allowedTools, maxTurns);
  }

  clearSession(chatId: number): void {
    if (isCodexAgentModel(config.model)) {
      clearThread(chatId);
    }
  }

  abort(chatId: number): boolean {
    if (isClaudeModel(config.model)) {
      return abortClaudeQuery(chatId);
    }

    if (isCodexAgentModel(config.model)) {
      return abortCodexQuery(chatId);
    }

    return false;
  }

  getSessionInfo(chatId: number): string | null {
    if (isCodexAgentModel(config.model)) {
      const threadId = getThreadId(chatId);
      if (!threadId) return null;
      return `Codex thread: ${threadId.slice(0, 12)}...`;
    }

    return null;
  }
}

export const chatService = new ChatService();
