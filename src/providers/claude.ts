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
import { formatHistoryForPrompt } from "../conversation.js";
import type { Provider, ImageAttachment } from "./types.js";
import { recordUsage } from "../usage-tracker.js";
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

/** One abort controller per concurrent chat. Keyed by chatId. */
const activeControllers = new Map<number, AbortController>();

/**
 * Abort the running Claude query for a specific chat (or all if chatId omitted).
 * Called by the /stop Telegram command.
 */
export function abortClaudeQuery(chatId?: number): boolean {
  if (chatId !== undefined) {
    const ctrl = activeControllers.get(chatId);
    if (ctrl) {
      ctrl.abort();
      activeControllers.delete(chatId);
      return true;
    }
    return false;
  }
  // No chatId — abort all active queries
  if (activeControllers.size === 0) return false;
  for (const [id, ctrl] of activeControllers) {
    ctrl.abort();
  }
  activeControllers.clear();
  return true;
}

// ---------------------------------------------------------------------------
// Safety hook — block dangerous commands in native Bash tool
// ---------------------------------------------------------------------------

/**
 * Patterns that must never run via Claude's native Bash tool.
 * Mirrors DANGEROUS_PATTERNS from src/tools/run-code.ts but applies to
 * the Agent SDK's built-in Bash, which bypasses our tool registry.
 */
const BLOCKED_BASH_PATTERNS = [
  /\bpm2\b/i,
  /\bkill\b.*chris-assistant/i,
  /\bsystemctl\b.*(restart|stop|disable)/i,
  /\breboot\b/,
  /\bshutdown\b/,
  /\brm\s+-rf\s+[/~]/,
  /\bnpm\s+run\s+(start|dev)\b/i,
  /\bchris\s+(start|stop|restart)\b/i,
];

/**
 * PreToolUse hook callback. Inspects Bash commands before execution and
 * blocks anything matching BLOCKED_BASH_PATTERNS.
 */
async function safetyHook(
  input: any,
  _toolUseID: string | undefined,
  _options: { signal: AbortSignal },
): Promise<any> {
  if (input.hook_event_name !== "PreToolUse") return { continue: true };
  if (input.tool_name !== "Bash") return { continue: true };

  const command = input.tool_input?.command;
  if (typeof command !== "string") return { continue: true };

  for (const pattern of BLOCKED_BASH_PATTERNS) {
    if (pattern.test(command)) {
      console.warn("[claude] Blocked dangerous Bash command: %s", command.slice(0, 200));
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            `Blocked: command matches dangerous pattern (${pattern.source}). ` +
            "You cannot restart, stop, or destroy the bot process via Bash. " +
            "Ask Chris to restart manually if needed.",
        },
      };
    }
  }

  return { continue: true };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const MCP_SERVER_NAME = "chris-tools";

export function createClaudeProvider(model: string): Provider {
  return {
    name: "claude",
    async chat(chatId, userMessage, onChunk, _images?: ImageAttachment[], allowedTools?: string[]) {
      // Build tool server fresh each call so newly registered tools are always
      // available (avoids stale snapshot when the provider is cached).
      const toolServer = createSdkMcpServer({
        name: MCP_SERVER_NAME,
        tools: getCustomMcpTools(),
      });

      const appendPrompt = await getClaudeAppendPrompt();
      const thinkingTokens = getThinkingTokens(userMessage);

      // Build allowed tools list: custom MCP tools + all native Claude Code tools
      const customMcpAllowed = getCustomMcpAllowedToolNames(MCP_SERVER_NAME, allowedTools);
      console.log("[claude] chatId=%d tools=%d allowed=%d", chatId, getCustomMcpTools().length, customMcpAllowed.length);

      // Session resume — continue existing conversation if we have one
      const existingSessionId = chatId !== 0 ? getSessionId(chatId) : null;

      const abortController = new AbortController();
      activeControllers.set(chatId, abortController);

      // Image handling — Claude Agent SDK only accepts string prompts
      const messageWithImageNote = _images && _images.length > 0
        ? `[${_images.length} image(s) attached but the Claude Agent SDK can't process images directly in this mode. The user's caption follows.]\n\n${userMessage}`
        : userMessage;

      // When no session exists (fresh start or cleared after image routing),
      // prepend conversation history so Claude has context from prior exchanges.
      let promptWithContext = messageWithImageNote;
      if (!existingSessionId && chatId !== 0) {
        const history = await formatHistoryForPrompt(chatId);
        if (history) {
          promptWithContext = `${history}\n\n${messageWithImageNote}`;
        }
      }

      let responseText = "";
      let accumulatedText = "";

      try {
        const conversation = query({
          prompt: promptWithContext,
          options: {
            model,
            cwd: getWorkspaceRoot(),
            additionalDirectories: [
              path.join(os.homedir(), ".chris-assistant"),
            ],
            // Scheduled tasks (chatId 0) use a plain string system prompt to
            // avoid the claude_code preset's "I am Claude Code CLI" identity,
            // which causes the model to refuse custom MCP tool calls.
            systemPrompt: chatId === 0
              ? appendPrompt
              : {
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
            hooks: {
              PreToolUse: [{
                matcher: "Bash",
                hooks: [safetyHook],
              }],
            },
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

            // Record token usage if available
            const usage = "usage" in message ? (message as any).usage : undefined;
            if (usage && typeof usage.input_tokens === "number") {
              recordUsage({
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens ?? 0,
                model,
                provider: "claude",
              });
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
        activeControllers.delete(chatId);
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
