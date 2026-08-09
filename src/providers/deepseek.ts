import { config } from "../config.js";
import { formatHistoryForPrompt } from "../conversation.js";
import { getOpenAiToolDefinitions, dispatchToolCall } from "../tools/index.js";
import { recordUsage } from "../usage-tracker.js";
import { getSystemPrompt, invalidatePromptCache } from "./shared.js";
import type { ImageAttachment, Provider } from "./types.js";
import { resolveReasoningEffort } from "./model-routing.js";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1_000, 2_000];

type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type DeepSeekMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string;
      reasoning_content?: string;
      tool_calls?: DeepSeekToolCall[];
    }
  | { role: "tool"; content: string; tool_call_id: string };

interface StreamResult {
  text: string;
  reasoningContent: string;
  toolCalls: DeepSeekToolCall[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class DeepSeekApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "DeepSeekApiError";
  }
}

const activeControllers = new Map<number, AbortController>();

export function abortDeepSeekQuery(chatId?: number): boolean {
  if (chatId !== undefined) {
    const controller = activeControllers.get(chatId);
    if (!controller) return false;
    controller.abort();
    activeControllers.delete(chatId);
    return true;
  }

  if (activeControllers.size === 0) return false;
  for (const controller of activeControllers.values()) controller.abort();
  activeControllers.clear();
  return true;
}

export function isRetryableDeepSeekError(error: unknown): boolean {
  if (error instanceof DeepSeekApiError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
  }

  if (error instanceof TypeError || error instanceof SyntaxError) return true;
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN";
  }
  return false;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

async function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

async function parseDeepSeekStream(
  response: Response,
  onChunk?: (accumulated: string) => void,
): Promise<StreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("DeepSeek API returned no response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoningContent = "";
  const toolCalls = new Map<number, DeepSeekToolCall>();
  let usage: StreamResult["usage"];

  const processLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    const chunk = JSON.parse(payload);
    if (chunk.usage) {
      usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? 0,
      };
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.reasoning_content === "string") reasoningContent += delta.reasoning_content;
    if (typeof delta.content === "string") {
      text += delta.content;
      onChunk?.(text);
    }

    for (const partial of delta.tool_calls ?? []) {
      const index = partial.index ?? 0;
      const current = toolCalls.get(index) ?? {
        id: "",
        type: "function" as const,
        function: { name: "", arguments: "" },
      };
      if (partial.id) current.id = partial.id;
      if (partial.function?.name) current.function.name += partial.function.name;
      if (partial.function?.arguments) current.function.arguments += partial.function.arguments;
      toolCalls.set(index, current);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line.trimEnd());
  }
  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer.trimEnd());

  return { text, reasoningContent, toolCalls: Array.from(toolCalls.values()), usage };
}

async function deepSeekRequest(
  model: string,
  messages: DeepSeekMessage[],
  tools: ReturnType<typeof getOpenAiToolDefinitions>,
  signal: AbortSignal,
): Promise<Response> {
  const apiKey = config.deepseek.apiKey;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: config.deepseek.thinking },
  };
  if (config.deepseek.thinking === "enabled") {
    body.reasoning_effort = resolveReasoningEffort(model, config.reasoningEffort)?.effective;
  }
  if (tools.length > 0) body.tools = tools;

  const response = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new DeepSeekApiError(
      response.status,
      `DeepSeek API request failed with status ${response.status}`,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }
  return response;
}

async function requestWithRetry(
  model: string,
  messages: DeepSeekMessage[],
  tools: ReturnType<typeof getOpenAiToolDefinitions>,
  signal: AbortSignal,
  onChunk?: (accumulated: string) => void,
): Promise<StreamResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await parseDeepSeekStream(
        await deepSeekRequest(model, messages, tools, signal),
        onChunk,
      );
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (!isRetryableDeepSeekError(error) || attempt >= MAX_RETRIES) throw error;
      const delay = error instanceof DeepSeekApiError && error.retryAfterMs !== undefined
        ? error.retryAfterMs
        : RETRY_DELAYS_MS[attempt];
      console.warn("[deepseek] Retryable API error (attempt %d/%d), retrying in %dms", attempt + 1, MAX_RETRIES, delay);
      await waitForRetry(delay, signal);
    }
  }
}

function userFacingError(error: unknown, model: string): string {
  if (error instanceof Error && error.message.includes("DEEPSEEK_API_KEY")) {
    return "DeepSeek isn't configured. Set DEEPSEEK_API_KEY and restart Chris Assistant.";
  }
  if (error instanceof DeepSeekApiError) {
    if (error.status === 401 || error.status === 403) return "DeepSeek authentication failed. Check DEEPSEEK_API_KEY.";
    if (error.status === 402) return "The DeepSeek account has insufficient balance.";
    if (error.status === 429 || error.status >= 500) return "DeepSeek is busy or rate-limited. Try again shortly.";
    if (error.status === 400 || error.status === 422) return `DeepSeek rejected the ${model} request. Check the configured model and thinking settings.`;
  }
  return "Sorry, I hit an error processing that with DeepSeek. Try again in a moment.";
}

export function createDeepSeekProvider(model: string): Provider {
  return {
    name: "deepseek",
    async chat(chatId, userMessage, onChunk, _images?: ImageAttachment[], allowedTools?: string[], maxTurns?: number) {
      const controller = new AbortController();
      activeControllers.get(chatId)?.abort();
      activeControllers.set(chatId, controller);

      try {
        const systemPrompt = await getSystemPrompt(userMessage);
        const history = chatId === 0 ? "" : await formatHistoryForPrompt(chatId);
        const fullUserMessage = history ? `${history}\n\n${userMessage}` : userMessage;
        const messages: DeepSeekMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullUserMessage },
        ];
        const tools = getOpenAiToolDefinitions(true, allowedTools);
        const turnLimit = maxTurns ?? config.maxToolTurns;

        for (let turn = 0; turn < turnLimit; turn++) {
          const result = await requestWithRetry(model, messages, tools, controller.signal, onChunk);

          if (result.usage) {
            recordUsage({
              inputTokens: result.usage.prompt_tokens,
              outputTokens: result.usage.completion_tokens,
              model,
              provider: "deepseek",
            });
          }

          if (result.toolCalls.length === 0) {
            invalidatePromptCache();
            return result.text;
          }

          messages.push({
            role: "assistant",
            content: result.text,
            reasoning_content: result.reasoningContent,
            tool_calls: result.toolCalls,
          });
          for (const toolCall of result.toolCalls) {
            const output = await dispatchToolCall(
              toolCall.function.name,
              toolCall.function.arguments,
              "deepseek",
            );
            if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
            messages.push({ role: "tool", content: output, tool_call_id: toolCall.id });
          }
        }

        invalidatePromptCache();
        return "I reached the tool-call limit. Please ask me to continue.";
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          invalidatePromptCache();
          return "Stopped.";
        }
        const status = error instanceof DeepSeekApiError ? `status ${error.status}` : "request failed";
        console.error("[deepseek] %s", status);
        invalidatePromptCache();
        return userFacingError(error, model);
      } finally {
        if (activeControllers.get(chatId) === controller) activeControllers.delete(chatId);
      }
    },
  };
}
