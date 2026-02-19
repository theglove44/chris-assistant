import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { getMcpTools, getMcpAllowedToolNames } from "../tools/index.js";
import { getSystemPrompt, invalidatePromptCache } from "./shared.js";
import { formatHistoryForPrompt } from "../conversation.js";
import type { Provider, ImageAttachment } from "./types.js";

export function createClaudeProvider(model: string): Provider {
  const toolServer = createSdkMcpServer({
    name: "tools",
    tools: getMcpTools(),
  });

  return {
    name: "claude",
    async chat(chatId, userMessage, _onChunk, _image?: ImageAttachment) {
      const systemPrompt = await getSystemPrompt();
      const conversationContext = formatHistoryForPrompt(chatId);

      // Claude Agent SDK query() only accepts a string prompt — no content blocks.
      // Prepend an honest note when an image was attached so the response is accurate.
      const messageWithImageNote = _image
        ? `[An image was attached but the Claude provider can't process images directly. The user's caption follows.]\n\n${userMessage}`
        : userMessage;

      const fullPrompt = conversationContext
        ? `${conversationContext}\n\n${messageWithImageNote}`
        : messageWithImageNote;

      let responseText = "";

      try {
        const conversation = query({
          prompt: fullPrompt,
          options: {
            systemPrompt,
            model,
            maxTurns: 3,
            mcpServers: {
              tools: toolServer,
            },
            allowedTools: getMcpAllowedToolNames(),
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
          },
        });

        for await (const message of conversation) {
          if (message.type === "result" && message.subtype === "success") {
            responseText = message.result;
          }
        }
      } catch (error: any) {
        console.error("[claude] Error:", error.message);
        responseText = "Sorry, I hit an error processing that. Try again in a moment.";
      }

      invalidatePromptCache();
      return responseText;
    },
  };
}
