import OpenAI from "openai";
import { config } from "../config.js";
import { getSystemPrompt, invalidatePromptCache } from "./shared.js";
import { formatHistoryForPrompt } from "../conversation.js";
import { getOpenAiToolDefinitions, dispatchToolCall } from "../tools/index.js";
import { getValidAccessToken } from "./openai-oauth.js";
import { needsCompaction, compactMessages } from "./compaction.js";
import type { Provider, ImageAttachment } from "./types.js";
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";

export function createOpenAiProvider(model: string): Provider {
  return {
    name: "openai",
    async chat(chatId, userMessage, onChunk, image?: ImageAttachment) {
      // Get fresh OAuth token for each request (auto-refreshes if needed)
      const accessToken = await getValidAccessToken();
      const client = new OpenAI({
        apiKey: accessToken,
      });

      const systemPrompt = await getSystemPrompt();
      const conversationContext = formatHistoryForPrompt(chatId);

      const fullUserMessage = conversationContext
        ? `${conversationContext}\n\n${userMessage}`
        : userMessage;

      // Build user content — text only, or text + image when an attachment is present
      const userContent: ChatCompletionContentPart[] = image
        ? [
            { type: "text", text: fullUserMessage },
            {
              type: "image_url",
              image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
            },
          ]
        : [{ type: "text", text: fullUserMessage }];

      let messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ];

      try {
        // Tool call loop — runs until the model returns a final text response.
        // Context compaction keeps us within the model's context window.
        // config.maxToolTurns (default 200) is a safety ceiling only.
        for (let turn = 0; turn < config.maxToolTurns; turn++) {
          // Check if context needs compaction before the API call
          if (needsCompaction(model, messages)) {
            messages = await compactMessages(client, model, messages, "openai");
          }

          const stream = await client.chat.completions.create({
            model,
            messages,
            tools: getOpenAiToolDefinitions(),
            stream: true,
          });

          let contentAccumulator = "";
          // Tool calls accumulator: Map<index, { id, name, arguments }>
          const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

          // Strip think tags from content
          const stripThinkTags = (text: string) =>
            text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/g, "");

          for await (const chunk of stream) {
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
              const result = await dispatchToolCall(tc.function.name, tc.function.arguments, "openai");
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
        console.log(`[openai] Safety ceiling (${config.maxToolTurns} turns) reached, requesting summary`);
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
        console.error("[openai] Error:", error.message);
        return "Sorry, I hit an error processing that. Try again in a moment.";
      }
    },
  };
}
