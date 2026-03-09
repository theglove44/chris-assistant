export type { ToolCategory, ToolRegistration } from "./types.js";

export { registerTool, getRegisteredToolNames } from "./store.js";
export { resetLoopDetection } from "./loop-guard.js";
export { getOpenAiToolDefinitions, dispatchToolCall } from "./openai-adapter.js";
export {
  getMcpTools,
  getMcpAllowedToolNames,
  getCustomMcpTools,
  getCustomMcpAllowedToolNames,
} from "./claude-mcp-adapter.js";
