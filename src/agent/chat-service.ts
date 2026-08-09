import { config } from "../config.js";
import { clearThread, getThreadId } from "../codex-sessions.js";
import { clearGrokSession, getGrokSessionId } from "../grok-sessions.js";
import { createCodexAgentProvider, abortCodexQuery } from "../providers/codex-agent.js";
import { createDeepSeekProvider, abortDeepSeekQuery } from "../providers/deepseek.js";
import { createGrokAgentProvider, abortGrokQuery } from "../providers/grok-agent.js";
import { providerForModel } from "../providers/model-routing.js";
import { abortOpenAiQuery, createOpenAiProvider } from "../providers/openai.js";
import { resetLoopDetection } from "../tools/index.js";
import type { Provider, ImageAttachment } from "../providers/types.js";
import { withEventContext } from "../domain/events/context.js";

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
    switch (providerForModel(model)) {
      case "codex-agent": return createCodexAgentProvider(model);
      case "grok-agent": return createGrokAgentProvider(model);
      case "deepseek": return createDeepSeekProvider(model);
      case "openai": return createOpenAiProvider(model);
    }
  }

  private getProvider(): Provider {
    if (!this.activeProvider) this.activeProvider = this.resolveProvider();
    return this.activeProvider;
  }

  async sendMessage({ chatId, userMessage, onChunk, images, allowedTools, maxTurns }: ChatRequest): Promise<string> {
    resetLoopDetection();
    return withEventContext(chatId, async () => {
      if (images && images.length > 0) {
        const imageModel = config.imageModel;
        console.log("[provider] %d image(s) detected — routing to image model: %s", images.length, imageModel);
        const response = await createOpenAiProvider(imageModel, null).chat(chatId, userMessage, onChunk, images, allowedTools);
        this.clearSession(chatId);
        return response;
      }
      return this.getProvider().chat(chatId, userMessage, onChunk, images, allowedTools, maxTurns);
    });
  }

  clearSession(chatId: number): void {
    switch (providerForModel(config.model)) {
      case "codex-agent": clearThread(chatId); break;
      case "grok-agent": clearGrokSession(chatId); break;
      default: break;
    }
  }

  abort(chatId: number): boolean {
    switch (providerForModel(config.model)) {
      case "codex-agent": return abortCodexQuery(chatId);
      case "grok-agent": return abortGrokQuery(chatId);
      case "deepseek": return abortDeepSeekQuery(chatId);
      case "openai": return abortOpenAiQuery(chatId);
    }
  }

  getSessionInfo(chatId: number): string | null {
    switch (providerForModel(config.model)) {
      case "codex-agent": {
        const id = getThreadId(chatId);
        return id ? `Codex thread: ${id.slice(0, 12)}...` : null;
      }
      case "grok-agent": {
        const id = getGrokSessionId(chatId);
        return id ? `Grok session: ${id.slice(0, 12)}...` : null;
      }
      default: return null;
    }
  }
}

export const chatService = new ChatService();
