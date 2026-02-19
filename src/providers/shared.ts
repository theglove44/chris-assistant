import { loadMemory, buildSystemPrompt } from "../memory/loader.js";
import { config } from "../config.js";
import { resetLoopDetection } from "../tools/index.js";

let cachedSystemPrompt: string | null = null;
let lastPromptLoad = 0;
const PROMPT_CACHE_MS = 5 * 60 * 1000;

function getProviderName(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-")) return "OpenAI";
  if (model.startsWith("MiniMax")) return "MiniMax";
  return "Anthropic Claude";
}

export async function getSystemPrompt(): Promise<string> {
  const now = Date.now();
  if (!cachedSystemPrompt || now - lastPromptLoad > PROMPT_CACHE_MS) {
    console.log("[prompt] Loading memory from GitHub...");
    const memory = await loadMemory();
    const model = config.model;
    const provider = getProviderName(model);
    cachedSystemPrompt = buildSystemPrompt(memory) +
      `\n\n---\n\n# System Info\n\nYou are currently running as model \`${model}\` via the ${provider} API. If asked what model you are, report this accurately.`;
    lastPromptLoad = now;
    console.log("[prompt] System prompt loaded (%d chars)", cachedSystemPrompt.length);
  }
  return cachedSystemPrompt;
}

export function invalidatePromptCache(): void {
  cachedSystemPrompt = null;
  resetLoopDetection();
}
