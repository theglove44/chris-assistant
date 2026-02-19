import OpenAI from "openai";
import { getSystemPrompt, invalidatePromptCache } from "./shared.js";
import { formatHistoryForPrompt } from "../conversation.js";
import { executeMemoryTool, MEMORY_TOOL_DEFINITION } from "../memory/tools.js";
import { getValidAccessToken } from "./openai-oauth.js";
import type { Provider } from "./types.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export function createOpenAiProvider(model: string): Provider {
  return {
    name: "openai",
    async chat(chatId, userMessage) {
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

      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: fullUserMessage },
      ];

      try {
        // Tool call loop — max 3 rounds (same as Claude and MiniMax)
        for (let turn = 0; turn < 3; turn++) {
          const response = await client.chat.completions.create({
            model,
            messages,
            tools: [MEMORY_TOOL_DEFINITION],
          });

          const choice = response.choices[0];
          const assistantMessage = choice.message;
          messages.push(assistantMessage);

          // No tool calls — we're done
          if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
            invalidatePromptCache();
            return assistantMessage.content || "";
          }

          // Handle tool calls
          for (const toolCall of assistantMessage.tool_calls) {
            if (toolCall.type !== "function") continue;
            if (toolCall.function.name === "update_memory") {
              let result: string;
              try {
                const args = JSON.parse(toolCall.function.arguments);
                result = await executeMemoryTool(args);
                console.log("[openai] Tool call: update_memory(%s/%s)", args.category, args.action);
              } catch (parseError: any) {
                result = `Failed to parse tool arguments: ${parseError.message}`;
                console.error("[openai] Bad tool call arguments:", toolCall.function.arguments);
              }
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: result,
              });
            }
          }
        }

        // Exhausted turns — return last assistant content
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
        invalidatePromptCache();
        return (lastAssistant as any)?.content || "Sorry, I ran out of processing turns.";
      } catch (error: any) {
        console.error("[openai] Error:", error.message);
        return "Sorry, I hit an error processing that. Try again in a moment.";
      }
    },
  };
}
