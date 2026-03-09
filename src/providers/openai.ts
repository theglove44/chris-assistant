import { config } from "../config.js";
import { getSystemPrompt, invalidatePromptCache } from "./shared.js";
import { formatHistoryForPrompt } from "../conversation.js";
import { getOpenAiToolDefinitions, dispatchToolCall } from "../tools/index.js";
import { getValidAccessToken, getAccountId } from "./openai-oauth.js";
import { needsCompaction, compactCodexInput } from "./compaction.js";
import { recordUsage } from "../usage-tracker.js";
import type { Provider, ImageAttachment } from "./types.js";

const CODEX_API_URL = "https://chatgpt.com/backend-api/codex/responses";

// ---------------------------------------------------------------------------
// Responses API types
// ---------------------------------------------------------------------------

type CodexInputItem =
  | { role: "user"; content: Array<{ type: "input_text"; text: string } | { type: "input_image"; detail: "auto"; image_url: string }> }
  | { type: "message"; role: "assistant"; content: Array<{ type: "output_text"; text: string }>; status: "completed" }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

// ---------------------------------------------------------------------------
// Tool definitions — Responses API format
// ---------------------------------------------------------------------------

function getCodexToolDefinitions(allowedTools?: string[]): Array<{ type: "function"; name: string; description: string; parameters: any }> {
  return getOpenAiToolDefinitions(true, allowedTools)
    .filter((t): t is typeof t & { type: "function"; function: { name: string; description?: string; parameters?: any } } =>
      t.type === "function" && "function" in t)
    .map((t) => ({
      type: "function" as const,
      name: t.function.name,
      description: t.function.description || "",
      parameters: t.function.parameters,
    }));
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

interface StreamResult {
  text: string;
  toolCalls: Array<{ call_id: string; name: string; arguments: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

async function parseCodexStream(
  response: Response,
  onChunk?: (accumulated: string) => void,
): Promise<StreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let textAccumulator = "";
  const toolCalls = new Map<number, { call_id: string; name: string; arguments: string }>();
  let capturedUsage: { input_tokens: number; output_tokens: number } | undefined;

  // Strip think tags from content
  const thinkClose = "<" + "/think>";
  const stripThinkTags = (text: string) =>
    text.replace(new RegExp("<think>[\\s\\S]*?" + thinkClose, "g"), "").replace(/<think>[\s\S]*$/g, "");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      let event: any;
      try {
        event = JSON.parse(jsonStr);
      } catch {
        continue;
      }

      const eventType = event.type;

      if (eventType === "response.output_text.delta") {
        textAccumulator += event.delta || "";
        const cleaned = stripThinkTags(textAccumulator);
        onChunk?.(cleaned);
      } else if (eventType === "response.output_item.added" && event.item?.type === "function_call") {
        const idx = event.output_index ?? toolCalls.size;
        toolCalls.set(idx, {
          call_id: event.item.call_id || "",
          name: event.item.name || "",
          arguments: "",
        });
      } else if (eventType === "response.function_call_arguments.delta") {
        const idx = event.output_index ?? 0;
        const tc = toolCalls.get(idx);
        if (tc) {
          tc.arguments += event.delta || "";
        }
      } else if (eventType === "response.output_item.done" && event.item?.type === "function_call") {
        // Tool call fully received — update with final data
        const idx = event.output_index ?? 0;
        const tc = toolCalls.get(idx);
        if (tc && event.item) {
          tc.call_id = event.item.call_id || tc.call_id;
          tc.name = event.item.name || tc.name;
          tc.arguments = event.item.arguments || tc.arguments;
        }
      } else if (eventType === "response.completed" && event.response?.usage) {
        const u = event.response.usage;
        capturedUsage = { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 };
      } else if (eventType === "response.failed") {
        const errorInfo = event.response?.error || event.error;
        if (errorInfo) {
          throw new Error(`Codex API error: ${errorInfo.message || errorInfo.code || JSON.stringify(errorInfo)}`);
        }
      }
    }
  }

  return {
    text: stripThinkTags(textAccumulator),
    toolCalls: Array.from(toolCalls.values()),
    usage: capturedUsage,
  };
}

// ---------------------------------------------------------------------------
// API request
// ---------------------------------------------------------------------------

async function codexRequest(
  model: string,
  instructions: string,
  input: CodexInputItem[],
  tools: ReturnType<typeof getCodexToolDefinitions>,
  accessToken: string,
  accountId: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "OpenAI-Beta": "responses=experimental",
  };
  if (accountId) {
    headers["chatgpt-account-id"] = accountId;
  }

  // Codex backend API requires stream: true and store: false
  const body: any = {
    model,
    instructions,
    input,
    stream: true,
    store: false,
  };

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(CODEX_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Codex API ${res.status}: ${text}`);
  }

  return res;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function createOpenAiProvider(model: string): Provider {
  return {
    name: "openai",
    async chat(chatId, userMessage, onChunk, images?: ImageAttachment[], allowedTools?: string[]) {
      const accessToken = await getValidAccessToken();
      const accountId = getAccountId();

      const systemPrompt = await getSystemPrompt();
      const conversationContext = await formatHistoryForPrompt(chatId);

      const fullUserMessage = conversationContext
        ? `${conversationContext}\n\n${userMessage}`
        : userMessage;

      // Build user content parts
      const userContentParts: Array<{ type: "input_text"; text: string } | { type: "input_image"; detail: "auto"; image_url: string }> = [
        { type: "input_text", text: fullUserMessage },
      ];
      if (images && images.length > 0) {
        for (const img of images) {
          userContentParts.push({
            type: "input_image",
            detail: "auto",
            image_url: `data:${img.mimeType};base64,${img.base64}`,
          });
        }
      }

      const tools = getCodexToolDefinitions(allowedTools);
      // Few-shot examples to teach the model the expected formatting style
      let input: CodexInputItem[] = [
        { role: "user", content: [{ type: "input_text", text: "should I use postgres or sqlite for this project" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "depends on the scale:\n\n📦 **PostgreSQL** — concurrent writes, multi-user, proper service deployment\n💡 **SQLite** — simpler, faster, zero config, great for solo projects\n\nfor a side project? sqlite all day. what's the project?" }], status: "completed" },
        { role: "user", content: [{ type: "input_text", text: "remind me what we talked about yesterday" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "yesterday was mostly the CLI work:\n\n🛠️ **pm2 commands** — got start/stop/status wired up\n📦 **memory management** — connected to GitHub repo\n✅ **full flow tested** — everything running clean\n\nyou were on a roll with it" }], status: "completed" },
        { role: "user", content: userContentParts },
      ];

      try {
        for (let turn = 0; turn < config.maxToolTurns; turn++) {
          // Check if context needs compaction before the API call
          if (needsCompaction(model, input)) {
            input = await compactCodexInput(model, systemPrompt, input, accessToken, accountId);
          }

          const response = await codexRequest(
            model, systemPrompt, input, tools, accessToken, accountId,
          );

          const result = await parseCodexStream(response, onChunk);

          // Record usage from this turn
          if (result.usage) {
            recordUsage({
              inputTokens: result.usage.input_tokens,
              outputTokens: result.usage.output_tokens,
              model,
              provider: "openai",
            });
          }

          // If we got tool calls, execute them and continue the loop
          if (result.toolCalls.length > 0) {
            // Add assistant's text + tool calls to input
            if (result.text) {
              input.push({
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: result.text }],
                status: "completed",
              });
            }

            for (const tc of result.toolCalls) {
              input.push({
                type: "function_call",
                call_id: tc.call_id,
                name: tc.name,
                arguments: tc.arguments,
              });

              const toolResult = await dispatchToolCall(tc.name, tc.arguments, "openai");
              input.push({
                type: "function_call_output",
                call_id: tc.call_id,
                output: toolResult,
              });
            }
            continue; // Next turn
          }

          // No tool calls — this is the final text response
          invalidatePromptCache();
          return result.text;
        }

        // Safety ceiling reached
        console.log(`[openai] Safety ceiling (${config.maxToolTurns} turns) reached, requesting summary`);
        try {
          const summaryInput: CodexInputItem[] = [
            ...input,
            {
              role: "user",
              content: [{
                type: "input_text",
                text: "You have reached the maximum number of tool calls. Please summarize what you accomplished, what remains to be done, and any important findings so far.",
              }],
            },
          ];

          const summaryRes = await codexRequest(
            model, systemPrompt, summaryInput, [], accessToken, accountId,
          );
          const summaryResult = await parseCodexStream(summaryRes, onChunk);
          if (summaryResult.usage) {
            recordUsage({
              inputTokens: summaryResult.usage.input_tokens,
              outputTokens: summaryResult.usage.output_tokens,
              model,
              provider: "openai",
            });
          }
          invalidatePromptCache();
          return summaryResult.text || "I reached the processing limit. Please ask me to continue where I left off.";
        } catch {
          invalidatePromptCache();
          return "I reached the processing limit. Please ask me to continue where I left off.";
        }
      } catch (error: any) {
        console.error("[openai] Error:", error.message);
        // Surface actionable errors to the user
        const msg = error.message || "";
        if (msg.includes("not supported")) {
          return `This model (${model}) isn't available via the ChatGPT backend API. Try a GPT-5.x model: /model set gpt5`;
        }
        if (msg.includes("usage_limit_reached") || msg.includes("usage limit")) {
          return "You've hit your ChatGPT usage limit. Wait a bit and try again.";
        }
        return "Sorry, I hit an error processing that. Try again in a moment.";
      }
    },
  };
}
