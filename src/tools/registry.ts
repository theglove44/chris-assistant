import { tool as createMcpTool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolCategory = "always" | "coding";

interface ToolRegistration {
  name: string;
  description: string;
  /** Tool category — "always" tools are sent on every request, "coding" only when a project is active. */
  category?: ToolCategory;
  /** Zod schema for Claude MCP tool generation */
  zodSchema: Record<string, z.ZodTypeAny>;
  /** JSON Schema for OpenAI function-calling format */
  jsonSchemaParameters: {
    type: "object";
    required: string[];
    properties: Record<string, any>;
  };
  /** The executor function — takes parsed args, returns a string result */
  execute: (args: any) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Registry storage
// ---------------------------------------------------------------------------

const tools = new Map<string, ToolRegistration>();

// ---------------------------------------------------------------------------
// Loop detection
// ---------------------------------------------------------------------------

const LOOP_THRESHOLD = 3;    // consecutive identical calls before breaking
const FREQUENCY_LIMIT = 20;  // total calls to same tool name before hard stop

let recentFingerprints: string[] = [];
const toolCallCounts = new Map<string, number>();

/**
 * Check if a tool call is stuck in a loop. Returns an error message if so,
 * or null if the call should proceed.
 *
 * Two independent checks run in sequence:
 *   1. Frequency check — same tool name called >= FREQUENCY_LIMIT times this
 *      conversation (catches slow loops where args vary between calls).
 *   2. Exact-duplicate check — same tool name + same args called LOOP_THRESHOLD
 *      times consecutively (catches tight identical loops quickly).
 */
function checkLoopDetection(name: string, argsJson: string): string | null {
  // 1. Frequency check
  const count = (toolCallCounts.get(name) ?? 0) + 1;
  toolCallCounts.set(name, count);

  if (count >= FREQUENCY_LIMIT) {
    console.warn(
      "[tools] Frequency limit reached: %s called %d times this conversation",
      name,
      count,
    );
    return `Tool ${name} has been called ${count} times this conversation. You appear to be stuck — try a different approach or ask the user for help.`;
  }

  // 2. Exact-duplicate fingerprint check
  const fingerprint = `${name}:${argsJson.slice(0, 500)}`;

  recentFingerprints.push(fingerprint);

  // Only keep the last LOOP_THRESHOLD entries
  if (recentFingerprints.length > LOOP_THRESHOLD) {
    recentFingerprints = recentFingerprints.slice(-LOOP_THRESHOLD);
  }

  // Check if all recent entries are identical
  if (
    recentFingerprints.length >= LOOP_THRESHOLD &&
    recentFingerprints.every((fp) => fp === fingerprint)
  ) {
    console.warn("[tools] Loop detected: %s called %d times with same args", name, LOOP_THRESHOLD);
    recentFingerprints = []; // Reset after breaking
    return `Loop detected: you've called ${name} with the same arguments ${LOOP_THRESHOLD} times in a row. Try a different approach.`;
  }

  return null;
}

/** Reset loop detection state (call between conversations). */
export function resetLoopDetection(): void {
  recentFingerprints = [];
  toolCallCounts.clear();
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTool(reg: ToolRegistration): void {
  tools.set(reg.name, reg);
}

// ---------------------------------------------------------------------------
// OpenAI / MiniMax providers
// ---------------------------------------------------------------------------

function filterTools(includeCoding: boolean): ToolRegistration[] {
  return Array.from(tools.values()).filter(
    (t) => includeCoding || (t.category ?? "always") === "always",
  );
}

/** Returns tool definitions in OpenAI ChatCompletionTool format. */
export function getOpenAiToolDefinitions(includeCoding = true): ChatCompletionTool[] {
  return filterTools(includeCoding).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.jsonSchemaParameters,
    },
  }));
}

/**
 * Parses argsJson and dispatches to the registered tool executor.
 * Returns an error string for unknown tools or parse failures rather than
 * throwing, so the provider can feed the result back to the model cleanly.
 */
export async function dispatchToolCall(
  name: string,
  argsJson: string,
  logPrefix: string,
): Promise<string> {
  const t = tools.get(name);
  if (!t) return `Unknown tool: ${name}`;
  try {
    const loopError = checkLoopDetection(name, argsJson);
    if (loopError) return loopError;

    const args = JSON.parse(argsJson);
    console.log(
      "[%s] Tool call: %s(%s)",
      logPrefix,
      name,
      JSON.stringify(args).slice(0, 100),
    );
    return await t.execute(args);
  } catch (err: any) {
    console.error(
      "[%s] Bad tool call arguments for %s:",
      logPrefix,
      name,
      argsJson,
    );
    return `Failed to parse tool arguments: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Claude provider
// ---------------------------------------------------------------------------

/** Generates MCP tool objects from the registry for use with createSdkMcpServer. */
export function getMcpTools() {
  // MCP server gets all tools — filtering happens via allowedTools
  return Array.from(tools.values()).map((t) =>
    createMcpTool(
      t.name,
      t.description,
      t.zodSchema,
      async (args: any) => {
        const argsJson = JSON.stringify(args);
        const loopError = checkLoopDetection(t.name, argsJson);
        if (loopError) {
          return {
            content: [{ type: "text" as const, text: loopError }],
            isError: true,
          };
        }
        const result = await t.execute(args);
        // Heuristic: any result starting with an error-like keyword signals failure
        const isError = /^(Unknown|Failed|Error|rejected|denied)/i.test(result) || result.includes("rejected:");
        return {
          content: [{ type: "text" as const, text: result }],
          ...(isError && { isError: true }),
        };
      },
    ),
  );
}

/**
 * Returns the allowedTools list for the Claude provider.
 * MCP tools are namespaced as mcp__<serverName>__<toolName>.
 * The server is named "tools" in claude.ts.
 */
export function getMcpAllowedToolNames(includeCoding = true): string[] {
  return filterTools(includeCoding).map((t) => `mcp__tools__${t.name}`);
}
