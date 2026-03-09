import { getRegisteredTools } from "./store.js";
import type { ToolRegistration } from "./types.js";

export function filterTools(includeCoding: boolean, allowedTools?: string[]): ToolRegistration[] {
  let result = getRegisteredTools().filter((t) => includeCoding || (t.category ?? "always") === "always");

  if (allowedTools) {
    const allowed = new Set(allowedTools);
    result = result.filter((t) => allowed.has(t.name));
  }

  return result;
}
