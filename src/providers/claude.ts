import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { updateMemoryTool } from "../memory/tools.js";
import { getSystemPrompt, invalidatePromptCache } from "./shared.js";
import { formatHistoryForPrompt } from "../conversation.js";
import type { Provider } from "./types.js";

export function createClaudeProvider(model: string): Provider {
  const memoryServer = createSdkMcpServer({
    name: "memory",
    tools: [updateMemoryTool],
  });

  return {
    name: "claude",
    async chat(chatId, userMessage) {
      const systemPrompt = await getSystemPrompt();
      const conversationContext = formatHistoryForPrompt(chatId);

      const fullPrompt = conversationContext
        ? `${conversationContext}\n\n${userMessage}`
        : userMessage;

      let responseText = "";

      try {
        const conversation = query({
          prompt: fullPrompt,
          options: {
            systemPrompt,
            model,
            maxTurns: 3,
            mcpServers: {
              memory: memoryServer,
            },
            allowedTools: ["mcp__memory__update_memory"],
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
