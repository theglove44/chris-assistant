import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { checkToolLoop } from "./loop-guard.js";
import { filterTools } from "./filtering.js";
import { getRegisteredTool } from "./store.js";

export function getOpenAiToolDefinitions(includeCoding = true, allowedTools?: string[]): ChatCompletionTool[] {
  return filterTools(includeCoding, allowedTools).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.jsonSchemaParameters,
    },
  }));
}

export async function dispatchToolCall(name: string, argsJson: string, logPrefix: string): Promise<string> {
  const tool = getRegisteredTool(name);
  if (!tool) return `Unknown tool: ${name}`;

  try {
    const loopError = checkToolLoop(name, argsJson, tool.frequencyLimit);
    if (loopError) return loopError;

    const args = JSON.parse(argsJson);
    console.log("[%s] Tool call: %s(%s)", logPrefix, name, JSON.stringify(args).slice(0, 100));
    return await tool.execute(args);
  } catch (err: any) {
    console.error("[%s] Bad tool call arguments for %s:", logPrefix, name, argsJson);
    return `Failed to parse tool arguments: ${err.message}`;
  }
}
