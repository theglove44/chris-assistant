import * as fs from "fs";
import * as path from "path";
import { loadMemory, buildSystemPrompt } from "../memory/loader.js";
import { config } from "../config.js";
import { resetLoopDetection } from "../tools/index.js";
import { getWorkspaceRoot, setWorkspaceChangeCallback } from "../tools/files.js";

let cachedSystemPrompt: string | null = null;
let lastPromptLoad = 0;
const PROMPT_CACHE_MS = 5 * 60 * 1000;
const BOOTSTRAP_MAX_CHARS = 20_000;
const BOOTSTRAP_CANDIDATES = ["CLAUDE.md", "AGENTS.md", "README.md"];

setWorkspaceChangeCallback(() => invalidatePromptCache());

function getProviderName(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-")) return "OpenAI";
  if (model.startsWith("MiniMax")) return "MiniMax";
  return "Anthropic Claude";
}

function loadBootstrapFile(): string | null {
  const root = getWorkspaceRoot();
  for (const candidate of BOOTSTRAP_CANDIDATES) {
    const filePath = path.join(root, candidate);
    try {
      const contents = fs.readFileSync(filePath, "utf-8");
      const truncated = contents.length > BOOTSTRAP_MAX_CHARS
        ? contents.slice(0, BOOTSTRAP_MAX_CHARS) + "\n\n[... truncated ...]"
        : contents;
      console.log("[prompt] Loaded bootstrap: %s (%d chars)", filePath, truncated.length);
      return truncated;
    } catch {
      // File not found or unreadable — try the next candidate.
    }
  }
  return null;
}

export async function getSystemPrompt(): Promise<string> {
  const now = Date.now();
  if (!cachedSystemPrompt || now - lastPromptLoad > PROMPT_CACHE_MS) {
    console.log("[prompt] Loading memory from GitHub...");
    const memory = await loadMemory();
    const model = config.model;
    const provider = getProviderName(model);

    const bootstrap = loadBootstrapFile();
    const projectSection = bootstrap
      ? `\n\n---\n\n# Project Context\n\nThe following is from the active project's documentation:\n\n${bootstrap}`
      : "";

    cachedSystemPrompt = buildSystemPrompt(memory) +
      projectSection +
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
