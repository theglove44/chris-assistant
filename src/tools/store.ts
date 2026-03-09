import type { ToolRegistration } from "./types.js";

const tools = new Map<string, ToolRegistration>();

export function registerTool(reg: ToolRegistration): void {
  tools.set(reg.name, reg);
}

export function getRegisteredToolNames(): string[] {
  return Array.from(tools.keys());
}

export function getRegisteredTools(): ToolRegistration[] {
  return Array.from(tools.values());
}

export function getRegisteredTool(name: string): ToolRegistration | undefined {
  return tools.get(name);
}
