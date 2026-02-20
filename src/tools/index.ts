// Import tool modules to trigger their side-effectful registerTool() calls.
// The order here controls registration order, which determines the order of
// tool definitions sent to providers.
import "./memory.js";
import "./web-search.js";
import "./fetch-url.js";
import "./run-code.js";
import "./files.js";
import "./git.js";
import "./scheduler.js";

// Re-export registry functions so providers only need to import from one place.
export {
  getOpenAiToolDefinitions,
  dispatchToolCall,
  getMcpTools,
  getMcpAllowedToolNames,
  resetLoopDetection,
} from "./registry.js";

export { isProjectActive } from "./files.js";
