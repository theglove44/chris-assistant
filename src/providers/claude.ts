/**
 * Claude Agent SDK provider — full-featured agent mode.
 *
 * Uses the Agent SDK as a primary agent with:
 * - Native Claude Code tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, etc.)
 * - Custom tools via in-process MCP server (memory, SSH, scheduler, recall, journal)
 * - Streaming via includePartialMessages for real-time Telegram updates
 * - Session persistence via resume for multi-turn conversations
 * - Extended thinking triggered by keywords
 * - Abort support for /stop command
 */

import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { getCustomMcpTools, getCustomMcpAllowedToolNames } from "../tools/index.js";
import { getClaudeAppendPrompt, invalidatePromptCache } from "./shared.js";
import { getWorkspaceRoot } from "../tools/files.js";
import { getSessionId, setSessionId } from "../claude-sessions.js";
import type { Provider, ImageAttachment } from "./types.js";
import * as os from "os";
import * as path from "path";

// ---------------------------------------------------------------------------
// Extended thinking keywords
// ---------------------------------------------------------------------------

const THINKING_KEYWORDS = ["think", "consider", "reason", "analyze"];
const THINKING_DEEP_KEYWORDS = ["think hard", "think deeply", "ultrathink", "deep think"];

function getThinkingTokens(message: string): number | undefined {
  const lower = message.toLowerCase();
  if (THINKING_DEEP_KEYWORDS.some((k) => lower.includes(k))) return 50_000;
  if (THINKING_KEYWORDS.some((k) => lower.includes(k))) return 10_000;
  return undefined;
}

// ---------------------------------------------------------------------------
// Active query tracking (for abort support)
// ---------------------------------------------------------------------------

let activeAbortController: AbortController | null = null;

/**
 * Abort the currently running Claude query (if any).
 * Called by the /stop Telegram command.
 */
export function abortClaudeQuery(): boolean {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const MCP_SERVER_NAME = "chris-tools";

export function createClaudeProvider(model: string): Provider {
  const toolServer = createSdkMcpServer({
    name: MCP_SERVER_NAME,
    tools: getCustomMcpTools(),
  });

  return {
    name: "claude",
    async chat(chatId, userMessage, onChunk, _image?: ImageAttachment, allowedTools?: string[]) {
      const appendPrompt = await getClaudeAppendPrompt();
      const thinkingTokens = getThinkingTokens(userMessage);

      // Build allowed tools list: custom MCP tools + all native Claude Code tools
      const customMcpAllowed = getCustomMcpAllowedToolNames(MCP_SERVER_NAME, allowedTools);

      // Session resume — continue existing conversation if we have one
      const existingSessionId = chatId !== 0 ? getSessionId(chatId) : null;

      const abortController = new AbortController();
      activeAbortController = abortController;

      // Image handling — Claude Agent SDK only accepts string prompts
      const messageWithImageNote = _image
        ? `[An image was attached but the Claude Agent SDK can't process images directly in this mode. The user's caption follows.]\n\n${userMessage}`
        : userMessage;

      let responseText = "";
      let accumulatedText = "";

      try {
        const conversation = query({
          prompt: messageWithImageNote,
          options: {
            model,
            cwd: getWorkspaceRoot(),
            additionalDirectories: [
              path.join(os.homedir(), ".chris-assistant"),
            ],
            systemPrompt: {
              type: "preset",
              preset: "claude_code",
              append: appendPrompt,
            },
            tools: { type: "preset", preset: "claude_code" },
            mcpServers: {
              [MCP_SERVER_NAME]: toolServer,
            },
            allowedTools: customMcpAllowed,
            maxTurns: config.maxToolTurns,
            ...(thinkingTokens && { maxThinkingTokens: thinkingTokens }),
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            includePartialMessages: true,
            // Session management — chatId 0 is for system/scheduled tasks (no resume)
            ...(existingSessionId && { resume: existingSessionId }),
            ...(chatId === 0 && { persistSession: false }),
            abortController,
          },
        });

        for await (const message of conversation) {
          handleStreamEvent(message, onChunk, (text) => {
            accumulatedText = text;
          });

          // Capture session ID from any message that has one
          if ("session_id" in message && message.session_id && chatId !== 0) {
            setSessionId(chatId, message.session_id);
          }

          // Capture final result
          if (message.type === "result") {
            if (message.subtype === "success") {
              responseText = message.result;
            } else {
              // Error results — use accumulated text if we have it, otherwise report error
              const errors = "errors" in message ? message.errors : [];
              responseText = accumulatedText || `I hit an issue: ${errors.join(", ") || "unknown error"}`;
            }
          }
        }
      } catch (error: any) {
        if (error.name === "AbortError" || abortController.signal.aborted) {
          responseText = accumulatedText || "Stopped.";
        } else {
          console.error("[claude] Error:", error.message);
          responseText = accumulatedText || "Sorry, I hit an error processing that. Try again in a moment.";
        }
      } finally {
        activeAbortController = null;
      }

      invalidatePromptCache();
      return responseText;
    },
  };
}

// ---------------------------------------------------------------------------
// Stream event handler
// ---------------------------------------------------------------------------

/**
 * Process SDK streaming events, extracting text content for Telegram updates.
 */
function handleStreamEvent(
  message: SDKMessage,
  onChunk: ((accumulated: string) => void) | undefined,
  onTextUpdate: (text: string) => void,
): void {
  if (message.type === "stream_event" && onChunk) {
    const event = message.event;

    // content_block_delta with text_delta — the main streaming content
    if (event.type === "content_block_delta" && "delta" in event) {
      const delta = event.delta as any;
      if (delta.type === "text_delta" && delta.text) {
        // We need to accumulate text ourselves for streaming
        // The onTextUpdate callback lets the outer scope track it
        // But we don't have access to accumulated text here — the caller manages it
      }
    }
  }

  // For assistant messages, extract text content blocks
  if (message.type === "assistant" && message.message) {
    const content = message.message.content;
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const block of content) {
        if ("type" in block && block.type === "text" && "text" in block) {
          textParts.push(block.text as string);
        }
      }
      if (textParts.length > 0) {
        const text = textParts.join("");
        onTextUpdate(text);
        onChunk?.(text);
      }
    }
  }
}
