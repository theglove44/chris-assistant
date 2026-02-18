import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import { loadMemory, buildSystemPrompt } from "./memory/loader.js";
import { updateMemoryTool } from "./memory/tools.js";
import { formatHistoryForPrompt } from "./conversation.js";

// Create the in-process MCP server with our memory tool
const memoryServer = createSdkMcpServer({
  name: "memory",
  tools: [updateMemoryTool],
});

// Cache the system prompt so we don't hit GitHub on every message.
// Refreshed periodically or on demand.
let cachedSystemPrompt: string | null = null;
let lastPromptLoad = 0;
const PROMPT_CACHE_MS = 5 * 60 * 1000; // Refresh every 5 minutes

async function getSystemPrompt(): Promise<string> {
  const now = Date.now();
  if (!cachedSystemPrompt || now - lastPromptLoad > PROMPT_CACHE_MS) {
    console.log("[claude] Loading memory from GitHub...");
    const memory = await loadMemory();
    cachedSystemPrompt = buildSystemPrompt(memory);
    lastPromptLoad = now;
    console.log("[claude] System prompt loaded (%d chars)", cachedSystemPrompt.length);
  }
  return cachedSystemPrompt;
}

/** Force refresh the system prompt (e.g. after a memory update) */
export function invalidatePromptCache(): void {
  cachedSystemPrompt = null;
}

/**
 * Send a message to Claude and get a response.
 */
export async function chat(chatId: number, userMessage: string): Promise<string> {
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
        model: config.claude.model,
        maxTurns: 3, // Allow a few turns for tool use (memory updates)
        mcpServers: {
          memory: memoryServer,
        },
        // Only allow our memory tool — no file editing, no bash
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

  // Invalidate prompt cache after any conversation that might have updated memory
  invalidatePromptCache();

  return responseText;
}
