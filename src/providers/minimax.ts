import OpenAI from "openai";
import { config } from "../config.js";
import { getSystemPrompt, invalidatePromptCache } from "./shared.js";
import { formatHistoryForPrompt } from "../conversation.js";
import { getOpenAiToolDefinitions, dispatchToolCall } from "../tools/index.js";
import { getValidAccessToken } from "./minimax-oauth.js";
import { needsCompaction, compactMessages } from "./compaction.js";
import { recordUsage } from "../usage-tracker.js";
import type { Provider, ImageAttachment } from "./types.js";
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";

export function createMiniMaxProvider(model: string): Provider {
  // Validate OAuth tokens at startup
  getValidAccessToken();

  return {
    name: "minimax",
    async chat(chatId, userMessage, onChunk, _images?: ImageAttachment[], allowedTools?: string[]) {
      // Get fresh OAuth token for each request
      const accessToken = getValidAccessToken();
      const client = new OpenAI({
        apiKey: accessToken,
        baseURL: "https://api.minimax.io/v1",
      });

      const systemPrompt = await getSystemPrompt();
      const conversationContext = await formatHistoryForPrompt(chatId);

      const fullUserMessage = conversationContext
        ? `${conversationContext}\n\n${userMessage}`
        : userMessage;

      // Build user content — text only, or text + images when attachments are present
      const userContent: ChatCompletionContentPart[] = _images && _images.length > 0
        ? [
            { type: "text", text: fullUserMessage },
            ..._images.map((img) => ({
              type: "image_url" as const,
              image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
            })),
          ]
        : [{ type: "text", text: fullUserMessage }];

      let messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        // Few-shot examples to teach the model the expected formatting style.
        // These are invisible to the user but strongly guide output formatting.
        { role: "user", content: "should I use postgres or sqlite for this project" },
        { role: "assistant", content: "depends on the scale:\n\n📦 **PostgreSQL** — concurrent writes, multi-user, proper service deployment\n💡 **SQLite** — simpler, faster, zero config, great for solo projects\n\nfor a side project? sqlite all day. what's the project?" },
        { role: "user", content: "remind me what we talked about yesterday" },
        { role: "assistant", content: "yesterday was mostly the CLI work:\n\n🛠️ **pm2 commands** — got start/stop/status wired up\n📦 **memory management** — connected to GitHub repo\n✅ **full flow tested** — everything running clean\n\nyou were on a roll with it" },
        { role: "user", content: userContent },
      ];

      try {
        // Tool call loop — runs until the model returns a final text response.
        // Context compaction keeps us within the model's context window.
        // config.maxToolTurns (default 200) is a safety ceiling only.
        for (let turn = 0; turn < config.maxToolTurns; turn++) {
          // Check if context needs compaction before the API call
          if (needsCompaction(model, messages)) {
            messages = await compactMessages(client, model, messages, "minimax");
          }

          const stream = await client.chat.completions.create({
            model,
            messages,
            tools: getOpenAiToolDefinitions(true, allowedTools),
            stream: true,
          });

          let contentAccumulator = "";
          // Tool calls accumulator: Map<index, { id, name, arguments }>
          const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();
          let lastChunkUsage: { prompt_tokens?: number; completion_tokens?: number } | null = null;

          // Strip think tags from content
          const thinkClose = "<" + "/think>";
          const thinkingClose = "<" + "/thinking>";
          const stripThinkTags = (text: string) =>
            text
              .replace(new RegExp("<think>[\\s\\S]*?" + thinkClose, "g"), "")
              .replace(new RegExp("<thinking>[\\s\\S]*?" + thinkingClose, "g"), "")
              .replace(/<think>[\s\S]*$/g, "")
              .replace(/<thinking>[\s\S]*$/g, "");

          for await (const chunk of stream) {
            if ((chunk as any).usage) {
              lastChunkUsage = (chunk as any).usage;
            }
            const choice = chunk.choices[0];
            if (!choice) continue;

            const delta = choice.delta;

            // Accumulate text content and notify caller
            if (delta?.content) {
              contentAccumulator += delta.content;
              const cleaned = stripThinkTags(contentAccumulator);
              onChunk?.(cleaned);
            }

            // Accumulate tool call deltas
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = toolCallAccumulator.get(tc.index);
                if (existing) {
                  if (tc.function?.arguments) {
                    existing.arguments += tc.function.arguments;
                  }
                } else {
                  toolCallAccumulator.set(tc.index, {
                    id: tc.id || "",
                    name: tc.function?.name || "",
                    arguments: tc.function?.arguments || "",
                  });
                }
              }
            }
          }

          // Record usage from this turn (every API call, not just the final one)
          if (lastChunkUsage) {
            recordUsage({
              inputTokens: lastChunkUsage.prompt_tokens ?? 0,
              outputTokens: lastChunkUsage.completion_tokens ?? 0,
              model,
              provider: "minimax",
            });
          }

          // If we got tool calls, execute them and continue the loop
          if (toolCallAccumulator.size > 0) {
            const toolCallsArray = Array.from(toolCallAccumulator.values()).map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            }));
            messages.push({
              role: "assistant",
              content: contentAccumulator || null,
              tool_calls: toolCallsArray,
            });

            for (const tc of toolCallsArray) {
              const result = await dispatchToolCall(tc.function.name, tc.function.arguments, "minimax");
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: result,
              });
            }
            continue; // Next turn
          }

          // No tool calls — this is the final text response
          invalidatePromptCache();
          return stripThinkTags(contentAccumulator);
        }

        // Safety ceiling reached — ask the model to summarize what it accomplished
        console.log(`[minimax] Safety ceiling (${config.maxToolTurns} turns) reached, requesting summary`);
        try {
          const summaryStream = await client.chat.completions.create({
            model,
            messages: [
              ...messages,
              {
                role: "user",
                content:
                  "You have reached the maximum number of tool calls. Please summarize what you accomplished, what remains to be done, and any important findings so far.",
              },
            ],
            stream: true,
          });
          let summary = "";
          for await (const chunk of summaryStream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              summary += delta.content;
              onChunk?.(summary);
            }
          }
          invalidatePromptCache();
          return summary || "I reached the processing limit. Please ask me to continue where I left off.";
        } catch {
          invalidatePromptCache();
          return "I reached the processing limit. Please ask me to continue where I left off.";
        }
      } catch (error: any) {
        console.error("[minimax] Error:", error.message);
        return "Sorry, I hit an error processing that. Try again in a moment.";
      }
    },
  };
}
