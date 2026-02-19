import { tool as createMcpTool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolRegistration {
  name: string;
  description: string;
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
// Registration
// ---------------------------------------------------------------------------

export function registerTool(reg: ToolRegistration): void {
  tools.set(reg.name, reg);
}

// ---------------------------------------------------------------------------
// OpenAI / MiniMax providers
// ---------------------------------------------------------------------------

/** Returns tool definitions in OpenAI ChatCompletionTool format. */
export function getOpenAiToolDefinitions(): ChatCompletionTool[] {
  return Array.from(tools.values()).map((t) => ({
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
  return Array.from(tools.values()).map((t) =>
    createMcpTool(
      t.name,
      t.description,
      t.zodSchema,
      async (args: any) => {
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
export function getMcpAllowedToolNames(): string[] {
  return Array.from(tools.keys()).map((name) => `mcp__tools__${name}`);
}
