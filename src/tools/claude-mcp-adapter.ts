import { tool as createMcpTool } from "@anthropic-ai/claude-agent-sdk";
import { checkToolLoop } from "./loop-guard.js";
import { filterTools } from "./filtering.js";
import { getRegisteredTools } from "./store.js";

const NATIVE_CLAUDE_TOOLS = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "search_files",
  "run_code",
  "git_status",
  "git_diff",
  "git_commit",
  "web_search",
  "fetch_url",
]);

function toMcpTool(tool: ReturnType<typeof getRegisteredTools>[number]) {
  return createMcpTool(tool.name, tool.description, tool.zodSchema, async (args: any) => {
    const argsJson = JSON.stringify(args);
    const loopError = checkToolLoop(tool.name, argsJson, tool.frequencyLimit);
    if (loopError) {
      return {
        content: [{ type: "text" as const, text: loopError }],
        isError: true,
      };
    }

    const result = await tool.execute(args);
    const isError = /^(Unknown|Failed|Error|rejected|denied)/i.test(result) || result.includes("rejected:");
    return {
      content: [{ type: "text" as const, text: result }],
      ...(isError && { isError: true }),
    };
  });
}

export function getMcpTools() {
  return getRegisteredTools().map(toMcpTool);
}

export function getMcpAllowedToolNames(includeCoding = true, allowedTools?: string[]): string[] {
  return filterTools(includeCoding, allowedTools).map((t) => `mcp__tools__${t.name}`);
}

export function getCustomMcpTools() {
  return getRegisteredTools().filter((t) => !NATIVE_CLAUDE_TOOLS.has(t.name)).map(toMcpTool);
}

export function getCustomMcpAllowedToolNames(serverName: string, allowedTools?: string[]): string[] {
  let customTools = getRegisteredTools().filter((t) => !NATIVE_CLAUDE_TOOLS.has(t.name));
  if (allowedTools) {
    const allowed = new Set(allowedTools);
    customTools = customTools.filter((t) => allowed.has(t.name));
  }
  return customTools.map((t) => `mcp__${serverName}__${t.name}`);
}
