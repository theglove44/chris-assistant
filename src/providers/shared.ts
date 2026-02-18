import { loadMemory, buildSystemPrompt } from "../memory/loader.js";

let cachedSystemPrompt: string | null = null;
let lastPromptLoad = 0;
const PROMPT_CACHE_MS = 5 * 60 * 1000;

export async function getSystemPrompt(): Promise<string> {
  const now = Date.now();
  if (!cachedSystemPrompt || now - lastPromptLoad > PROMPT_CACHE_MS) {
    console.log("[prompt] Loading memory from GitHub...");
    const memory = await loadMemory();
    cachedSystemPrompt = buildSystemPrompt(memory);
    lastPromptLoad = now;
    console.log("[prompt] System prompt loaded (%d chars)", cachedSystemPrompt.length);
  }
  return cachedSystemPrompt;
}

export function invalidatePromptCache(): void {
  cachedSystemPrompt = null;
}
