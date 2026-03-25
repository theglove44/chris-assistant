// Import tool modules to trigger their side-effectful registerTool() calls.
// The order here controls registration order, which determines the order of
// tool definitions sent to providers.
import "./memory.js";
import "./web-search.js";
import "./fetch-url.js";
import "./browse-url.js";
import "./run-code.js";
import "./files.js";
import "./git.js";
import "./scheduler.js";
import "./ssh.js";
import "./recall.js";
import "./journal.js";
import "./market-snapshot.js";
import "./skills.js";
import "./usage.js";
import "./octopus-energy.js";
import "./peekaboo.js";
// macOS-only tools — Calendar (EventKit) and Mail (AppleScript)
if (process.platform === "darwin") {
  await import("./macos.js");
}

// Re-export registry functions so providers only need to import from one place.
export {
  getOpenAiToolDefinitions,
  dispatchToolCall,
  getMcpTools,
  getMcpAllowedToolNames,
  getCustomMcpTools,
  getCustomMcpAllowedToolNames,
  resetLoopDetection,
  getRegisteredToolNames,
} from "./registry.js";

export { isProjectActive } from "./files.js";
