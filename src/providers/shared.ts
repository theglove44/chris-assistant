import * as fs from "fs";
import * as path from "path";
import { loadMemory, buildSystemPrompt } from "../memory/loader.js";
import { config } from "../config.js";
import { resetLoopDetection } from "../tools/index.js";
import { getWorkspaceRoot, isProjectActive, setWorkspaceChangeCallback } from "../tools/files.js";

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

function buildCapabilitiesSection(): string {
  const hasBraveSearch = !!process.env.BRAVE_SEARCH_API_KEY;
  const projectActive = isProjectActive();
  const workspaceRoot = getWorkspaceRoot();

  let section = `# Your Capabilities

You are Chris's personal AI assistant, running as a Telegram bot. You are conversational first — most messages just need a thoughtful reply, not a tool call. Use tools only when they genuinely help answer the question.

## How You Work

You ARE the coding agent. There is no external agent, SDK, or framework doing work on your behalf — you directly call tools yourself to read files, write code, run commands, and make git commits. Chris built you as a custom Telegram bot with a tool-calling loop. When asked what you use to code, the answer is: your own built-in tools listed below.

## Tools Available

**Memory** — You can persistently remember important things about Chris using update_memory. Use it when you learn something significant (preferences, decisions, projects, people). Be selective — quality over quantity. Write entries as concise facts, not narratives.

**Web** — You can search the web${hasBraveSearch ? " (web_search)" : ""} and fetch URLs (fetch_url) to get current information. Use these when Chris asks about something you don't know, need real-time data, or want to verify facts.

**Coding** — You have full coding capabilities: read, write, and edit files; search codebases; run code (JS, TS, Python, shell); and use git (status, diff, commit).`;

  if (projectActive) {
    section += `

**Active project: \`${workspaceRoot}\`** — Coding tools are scoped to this directory. You can read and modify files, run code, search the codebase, and make git commits. When Chris asks you to build, fix, or explore code, use these tools. Work methodically: read first, understand, then make changes. For multi-step coding tasks, think through the approach before diving in.`;
  } else {
    section += `

**No active project** — The workspace is set to the default (\`${workspaceRoot}\`). Coding tools are available but Chris hasn't pointed you at a specific project yet. If Chris asks you to work on code, suggest they set a project with the /project command first. You can still run quick code snippets and answer coding questions without needing a project.`;
  }

  section += `

## Guidelines

- **Be conversational.** For greetings, questions, opinions, and casual chat — just reply naturally. Don't use tools unless there's a reason.
- **Don't explore unprompted.** Never run tools to "orient yourself" or explore the filesystem unless Chris asks you to.
- **Ask before big changes.** For destructive or multi-file edits, describe your plan and get confirmation before proceeding.
- **Keep responses concise.** This is Telegram, not a document. Short, clear messages work best.`;

  return section;
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
      `\n\n---\n\n${buildCapabilitiesSection()}` +
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
