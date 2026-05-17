import * as fs from "fs";
import * as path from "path";
import { loadMemory, buildSystemPrompt } from "../memory/loader.js";
import type { LoadedMemory } from "../memory/loader.js";
import { config } from "../config.js";
import { resetLoopDetection } from "../tools/index.js";
import { getWorkspaceRoot, isProjectActive, setWorkspaceChangeCallback } from "../tools/files.js";
import { LIMITS } from "../infra/config/limits.js";
import { findRelevantMemories, formatRecalledMemories } from "../domain/memory/recall.js";

let cachedSystemPrompt: string | null = null;
let lastPromptLoad = 0;
const PROMPT_CACHE_MS = LIMITS.promptCacheMs;
const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const BOOTSTRAP_MAX_CHARS = 20_000;
const BOOTSTRAP_CANDIDATES = ["CLAUDE.md", "AGENTS.md", "README.md"];

setWorkspaceChangeCallback(() => invalidatePromptCache());

function getProviderName(model: string): string {
  if (model.toLowerCase().startsWith("codex-agent")) return "OpenAI Codex Agent";
  const m = model.toLowerCase();
  if (m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-")) return "OpenAI";
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

type PromptProviderMode = "openai" | "claude" | "codex-agent";

interface PromptAssembly {
  assistantRuntimeContract: string;
  identityMemory: string;
  runtimeContext: string;
  providerAdapter: string;
  formatting: string;
  currentDateTime: string;
  projectContext: string;
}

export interface PromptInspectionSection {
  name: string;
  present: boolean;
  chars: number;
  details?: string[];
}

export interface PromptInspection {
  model: string;
  provider: string;
  workspaceRoot: string;
  sections: PromptInspectionSection[];
}

function currentDateTimeSection(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Europe/London",
  });
  const timeStr = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

  return `# Current Date & Time

Today is **${dateStr}** and the current time is **${timeStr} (Europe/London)**. Use this when answering any question about today's date, the day of the week, upcoming events, or scheduling. Do not rely on training data for the current date.`;
}

export function buildAssistantRuntimeContract(): string {
  return `# Assistant Runtime Contract

You are **Chris Assistant**: Chris's personal assistant with memory, purpose, continuity, and local runtime awareness. You are not Claude Code, not the Codex CLI, not a generic OpenAI assistant, and not a provider-branded coding shell.

## Identity Answers

- If Chris asks "who are you?", answer that you are Chris Assistant.
- If Chris asks "where do you run?", explain that you run as the \`chris-assistant\` Node.js/TypeScript app, normally reached through Telegram, on Chris's MacBook Pro under pm2.
- If Chris asks "what memory/tools do you have?", describe persistent memory, recent conversation summaries, journal context, reusable skills, and the provider-specific tools available in the current mode.
- If Chris asks "how are you different from Claude Code?", explain that Claude Code or Codex may be execution substrates, but Chris Assistant is the product identity, memory layer, Telegram surface, tool policy, and continuity contract.

## Operating Contract

- Preserve the feeling of a personal assistant first. Use coding-agent abilities when useful, but do not let tool/runtime branding replace your identity.
- Treat memory, journal notes, and recent summaries as part of your continuity with Chris.
- Be explicit about the active model or provider if asked, while still identifying as Chris Assistant.`;
}

function buildIdentityMemorySection(memory: LoadedMemory): string {
  const body = buildSystemPrompt(memory);
  return body ? `# Identity / Memory\n\n${body}` : "";
}

function buildRuntimeContextSection(model: string, provider: string): string {
  return `# Runtime Context

You are currently running as model \`${model}\` through ${provider}. If asked what model or provider you are using, report that accurately without adopting the provider as your identity.

## Where You Live

You are the \`chris-assistant\` project. You run as a Node.js process managed by pm2 on **Chris's MacBook Pro** (the local machine, not a remote server).

- **Your source code**: \`${PROJECT_ROOT}/\`
- **Your config/data**: \`~/.chris-assistant/\`
- **Your logs**: read \`~/.pm2/logs/chris-assistant-out.log\` and \`~/.pm2/logs/chris-assistant-error.log\` directly
- **Your schedules**: \`~/.chris-assistant/schedules.json\`
- **Your process**: managed by pm2; \`npx pm2 list\` shows status

When debugging your own errors, inspect local logs and source code first. Never SSH to debug yourself; SSH is for remote devices on Tailscale, not for inspecting your own process.`;
}

function buildProviderAdapterSection(mode: PromptProviderMode): string {
  if (mode === "claude") {
    return `# Provider Adapter

You are running through the Anthropic Claude Agent SDK with the Claude Code tool preset. Claude Code is an execution substrate and tool runtime, not your identity.

- Do not introduce yourself as Claude Code or a Claude Code CLI session.
- Use native Claude Code tools for repository work when they help.
- Use Chris Assistant custom MCP tools for memory, journal, recall, schedules, skills, SSH, macOS helpers, browser tools, market data, energy data, usage reports, and other assistant capabilities.
- If the Claude Code preset says something generic about identity, this Chris Assistant runtime contract takes priority.`;
  }

  if (mode === "codex-agent") {
    return `# Provider Adapter

You are running through the OpenAI Codex SDK, which wraps the local \`codex\` CLI. Codex is an execution substrate and coding runtime, not your identity.

- Do not introduce yourself as Codex, the Codex CLI, or a generic coding agent.
- Use Codex native coding abilities for repository work when they help.
- Stay grounded in Chris Assistant's memory, Telegram surface, and local runtime context.
- Ask before destructive or wide-ranging changes.`;
  }

  return `# Provider Adapter

You are running through the OpenAI-backed tool-calling provider in \`chris-assistant\`. The API/model is an execution substrate, not your identity.

- Use your registered tools directly when they genuinely help.
- For coding work, read first, understand the repo, then make focused changes.
- For normal conversation, answer naturally as Chris Assistant without unnecessary tool use.`;
}

function buildFormattingSection(): string {
  return `# Formatting

Every response is rendered in Telegram.

1. Use emoji as visual markers when they improve scanability.
2. Bold key terms, options, names, and decisions.
3. Use line breaks generously; never send dense walls of text.
4. Keep short replies warm and human.
5. Do not dump raw tool chatter back to Chris.`;
}

function buildProjectContextSection(bootstrap: string | null): string {
  return bootstrap
    ? `# Project Context\n\nThe following is from the active project's documentation:\n\n${bootstrap}`
    : "";
}

function assemblePromptSections(memory: LoadedMemory, mode: PromptProviderMode, bootstrap: string | null): PromptAssembly {
  const model = config.model;
  const provider = getProviderName(model);
  return {
    assistantRuntimeContract: buildAssistantRuntimeContract(),
    identityMemory: buildIdentityMemorySection(memory),
    runtimeContext: buildRuntimeContextSection(model, provider),
    providerAdapter: buildProviderAdapterSection(mode),
    formatting: buildFormattingSection(),
    currentDateTime: currentDateTimeSection(),
    projectContext: buildProjectContextSection(bootstrap),
  };
}

function joinPromptSections(sections: Array<string | null | undefined>): string {
  return sections.filter((section): section is string => !!section && section.trim().length > 0).join("\n\n---\n\n");
}

export function buildPromptInspectionReport(inspection: PromptInspection): string {
  const lines = [
    "Chris Assistant Prompt Inspection",
    "",
    `Active model: ${inspection.model}`,
    `Resolved provider: ${inspection.provider}`,
    `Workspace root: ${inspection.workspaceRoot}`,
    "",
    "Sections:",
  ];

  for (const section of inspection.sections) {
    const status = section.present ? "present" : "missing";
    lines.push(`- ${section.name}: ${status}, ~${section.chars} chars`);
    for (const detail of section.details ?? []) {
      lines.push(`  ${detail}`);
    }
  }

  lines.push("");
  lines.push("Raw memory bodies, tokens, and environment values are intentionally redacted.");
  return lines.join("\n");
}

export async function inspectPrompt(): Promise<string> {
  const memory = await loadMemory();
  const bootstrap = loadBootstrapFile();
  const mode = config.model.toLowerCase().startsWith("codex-agent")
    ? "codex-agent"
    : config.model.toLowerCase().startsWith("claude-")
      ? "claude"
      : "openai";
  const sections = assemblePromptSections(memory, mode, bootstrap);
  const memoryDetails = [
    `identity: ${memory.identity ? "present" : "missing"}`,
    `curatedSummary: ${memory.curatedSummary ? "present" : "missing"}`,
    `knowledge: ${memory.knowledge ? "present" : "missing"}`,
    `memory: ${memory.memory ? "present" : "missing"}`,
    `recentSummaries: ${memory.recentSummaries ? "present" : "missing"}`,
    `recentJournal: ${memory.recentJournal ? "present" : "missing"}`,
    `skillIndex: ${memory.skillIndex ? "present" : "missing"}`,
  ];

  return buildPromptInspectionReport({
    model: config.model,
    provider: getProviderName(config.model),
    workspaceRoot: getWorkspaceRoot(),
    sections: [
      { name: "Assistant Runtime Contract", present: true, chars: sections.assistantRuntimeContract.length },
      { name: "Identity / Memory", present: !!sections.identityMemory, chars: sections.identityMemory.length, details: memoryDetails },
      { name: "Runtime Context", present: true, chars: sections.runtimeContext.length },
      { name: "Provider Adapter", present: true, chars: sections.providerAdapter.length },
      { name: "Formatting", present: true, chars: sections.formatting.length },
      { name: "Current Date & Time", present: true, chars: sections.currentDateTime.length },
      { name: "Project Context", present: !!sections.projectContext, chars: sections.projectContext.length },
    ],
  });
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

**Memory** — You have persistent memory across conversations via update_memory. **Actively use it.** Your memory is what makes you a personal assistant, not just a chatbot. If in doubt, save it — you can consolidate later.

Triggers for each category:
- **about-chris**: Chris shares something about his background, job, life, health, location, or routine
- **preferences**: Chris expresses a like, dislike, opinion, or style preference (food, tech, communication, workflow)
- **projects**: Chris mentions starting, finishing, or making progress on a project — or shifts what he's focused on
- **people**: Chris mentions someone by name — save who they are and their relationship/context
- **decisions**: Chris makes or announces a decision (career, technical, life) — save what was decided and why
- **learnings**: You discover something about how Chris prefers to interact, what kind of answers work best, or a mistake you should avoid repeating

**Journal** — You have a daily journal via journal_entry. After substantive conversations — decisions made, important topics discussed, tasks completed, things learned about Chris, or mood observations — write a brief note. These notes persist and help you maintain continuity across conversations. Don't journal every message — focus on what's worth remembering tomorrow.

**Web** — You can search the web${hasBraveSearch ? " (web_search)" : ""}, fetch URLs (fetch_url), and browse JS-heavy sites (browse_url) to get current information. Use these when Chris asks about something you don't know, need real-time data, or want to verify facts. Start with fetch_url for speed — use browse_url only when a page returns empty or broken content (SPAs, React apps, dynamic pages). **Important:** fetch_url/browse_url are for web pages and text content only — never use them to fetch image URLs. When Chris sends you an image, you can see it directly via your vision capabilities — describe it immediately without any tool calls.

**Coding** — You have full coding capabilities: read, write, and edit files; search codebases; run code (JS, TS, Python, shell); and use git (status, diff, commit).

**Reminders** — You can manage Apple Reminders: create, complete, search, and list reminders. When Chris mentions wanting to remember something, needing to do something later, or following up on something, proactively offer to create a reminder. When discussing tasks or to-dos, check existing reminders for context.`;

  if (projectActive) {
    section += `

**Active project: \`${workspaceRoot}\`** — Coding tools are scoped to this directory. You can read and modify files, run code, search the codebase, and make git commits. When Chris asks you to build, fix, or explore code, use these tools. Work methodically: read first, understand, then make changes. For multi-step coding tasks, think through the approach before diving in.`;
  } else {
    section += `

**No active project** — The workspace is set to the default (\`${workspaceRoot}\`). Coding tools are available but Chris hasn't pointed you at a specific project yet. If Chris asks you to work on code, suggest they set a project with the /project command first. You can still run quick code snippets and answer coding questions without needing a project.`;
  }

  section += `

## Guidelines

- **Be conversational.** For greetings, questions, opinions, and casual chat — just reply naturally. Don't reach for coding/web tools unless there's a reason.
- **Proactively update memory.** After any substantive conversation, ask yourself: did I learn anything new about Chris, his preferences, projects, or people in his life? If yes, call update_memory before finishing your response. Don't wait to be asked.
- **Don't explore unprompted.** Never run tools to "orient yourself" or explore the filesystem unless Chris asks you to.
- **Ask before big changes.** For destructive or multi-file edits, describe your plan and get confirmation before proceeding.
- **Format for Telegram.** Use visual markers, bold key terms, and generous line breaks. Every message should be easy to scan on a phone. Follow the formatting patterns in your identity and memory files.`;

  return section;
}

export async function getSystemPrompt(userMessage?: string): Promise<string> {
  const now = Date.now();
  if (!cachedSystemPrompt || now - lastPromptLoad > PROMPT_CACHE_MS) {
    console.log("[prompt] Loading memory from GitHub...");
    const memory = await loadMemory();
    const bootstrap = loadBootstrapFile();
    const sections = assemblePromptSections(memory, "openai", bootstrap);

    cachedSystemPrompt = joinPromptSections([
      sections.assistantRuntimeContract,
      sections.identityMemory,
      buildCapabilitiesSection(),
      sections.runtimeContext,
      sections.providerAdapter,
      sections.formatting,
      sections.currentDateTime,
      sections.projectContext,
    ]);
    lastPromptLoad = now;
    console.log("[prompt] System prompt loaded (%d chars)", cachedSystemPrompt.length);
  }
  return appendRecalledMemoryContext(cachedSystemPrompt, userMessage, "openai");
}

export function invalidatePromptCache(): void {
  cachedSystemPrompt = null;
  cachedClaudeAppendPrompt = null;
  cachedCodexSystemPrompt = null;
  resetLoopDetection();
}

// ---------------------------------------------------------------------------
// Claude Agent SDK append prompt
// ---------------------------------------------------------------------------

let cachedClaudeAppendPrompt: string | null = null;
let lastClaudePromptLoad = 0;
let cachedCodexSystemPrompt: string | null = null;
let lastCodexPromptLoad = 0;

/**
 * Build a system prompt designed to APPEND to Claude Code's default preset.
 *
 * This is lighter than getSystemPrompt() — it provides identity, memory,
 * knowledge, and Telegram formatting rules, but skips the capabilities
 * section since Claude Code's preset already handles tool descriptions.
 */
export async function getRecalledMemoryPrompt(userMessage: string, providerLabel: string): Promise<string> {
  if (!userMessage.trim()) return "";

  const recalledMemories = await findRelevantMemories(userMessage).catch((e) => {
    console.warn("[%s] Memory recall failed: %s", providerLabel, e instanceof Error ? e.message : e);
    return [];
  });

  const recalledSection = formatRecalledMemories(recalledMemories);
  if (recalledMemories.length > 0) {
    console.log("[%s] Recalled %d memories for current turn", providerLabel, recalledMemories.length);
  }

  return recalledSection;
}

async function appendRecalledMemoryContext(
  basePrompt: string,
  userMessage: string | undefined,
  providerLabel: string,
): Promise<string> {
  if (!userMessage) return basePrompt;

  const recalledSection = await getRecalledMemoryPrompt(userMessage, providerLabel);
  return recalledSection
    ? joinPromptSections([basePrompt, recalledSection])
    : basePrompt;
}

export async function getClaudeAppendPrompt(userMessage?: string): Promise<string> {
  const now = Date.now();
  if (cachedClaudeAppendPrompt && now - lastClaudePromptLoad < PROMPT_CACHE_MS) {
    return appendRecalledMemoryContext(cachedClaudeAppendPrompt, userMessage, "claude");
  }

  console.log("[prompt] Loading memory for Claude append prompt...");
  const memory = await loadMemory();
  const sections = assemblePromptSections(memory, "claude", null);

  cachedClaudeAppendPrompt = joinPromptSections([
    sections.assistantRuntimeContract,
    sections.identityMemory,
    sections.runtimeContext,
    sections.providerAdapter,
    sections.formatting,
    currentDateTimeSection(),
  ]);
  lastClaudePromptLoad = now;
  console.log("[prompt] Claude append prompt loaded (%d chars)", cachedClaudeAppendPrompt.length);

  return appendRecalledMemoryContext(cachedClaudeAppendPrompt, userMessage, "claude");
}

export async function getCodexSystemPrompt(userMessage?: string): Promise<string> {
  const now = Date.now();
  if (cachedCodexSystemPrompt && now - lastCodexPromptLoad < PROMPT_CACHE_MS) {
    return appendRecalledMemoryContext(cachedCodexSystemPrompt, userMessage, "codex-agent");
  }

  console.log("[prompt] Loading memory for Codex system prompt...");
  const memory = await loadMemory();
  const bootstrap = loadBootstrapFile();
  const sections = assemblePromptSections(memory, "codex-agent", bootstrap);

  cachedCodexSystemPrompt = joinPromptSections([
    sections.assistantRuntimeContract,
    sections.identityMemory,
    sections.runtimeContext,
    sections.providerAdapter,
    sections.formatting,
    sections.currentDateTime,
    sections.projectContext,
  ]);
  lastCodexPromptLoad = now;
  console.log("[prompt] Codex system prompt loaded (%d chars)", cachedCodexSystemPrompt.length);

  return appendRecalledMemoryContext(cachedCodexSystemPrompt, userMessage, "codex-agent");
}
