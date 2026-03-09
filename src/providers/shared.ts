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
  if (model.toLowerCase().startsWith("codex-agent")) return "OpenAI Codex Agent";
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

- **Be conversational.** For greetings, questions, opinions, and casual chat — just reply naturally. Don't reach for coding/web tools unless there's a reason.
- **Proactively update memory.** After any substantive conversation, ask yourself: did I learn anything new about Chris, his preferences, projects, or people in his life? If yes, call update_memory before finishing your response. Don't wait to be asked.
- **Don't explore unprompted.** Never run tools to "orient yourself" or explore the filesystem unless Chris asks you to.
- **Ask before big changes.** For destructive or multi-file edits, describe your plan and get confirmation before proceeding.
- **Format for Telegram.** Use emoji as visual markers, bold key terms, and generous line breaks. Every message should be easy to scan on a phone. Follow the formatting patterns in your VOICE.md identity file.`;

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
      `\n\n---\n\n# System Info\n\nYou are currently running as model \`${model}\` via the ${provider} API. If asked what model you are, report this accurately.` +
      `\n\n---\n\n# CRITICAL: Message Formatting Rules\n\nThese formatting rules MUST be followed in EVERY response:\n\n1. **Use emoji as visual markers** — start key points with relevant emoji (🎯 📦 💡 ⚡ ✅ 🔍 📝 ⚠️ 🛠️ 🚀). One emoji per point, varied by meaning.\n2. **Bold key terms** — use **bold** for important words, options, names, and labels. Make every message scannable.\n3. **Use line breaks generously** — separate ideas with blank lines. Never write dense paragraphs.\n4. **Even short replies get personality** — a one-liner still uses emoji. "hey 👋 what's up?" not "hey, what's up?"\n\nExample of correct formatting:\n\n🎯 **Direct answer here**\n\n📦 **Option A** — description\n💡 **Option B** — description\n\nFollow-up question?\n\nNEVER send flat walls of unformatted text. ALWAYS use bold + emoji + spacing.`;
    lastPromptLoad = now;
    console.log("[prompt] System prompt loaded (%d chars)", cachedSystemPrompt.length);
  }
  return cachedSystemPrompt;
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
export async function getClaudeAppendPrompt(): Promise<string> {
  const now = Date.now();
  if (cachedClaudeAppendPrompt && now - lastClaudePromptLoad < PROMPT_CACHE_MS) {
    return cachedClaudeAppendPrompt;
  }

  console.log("[prompt] Loading memory for Claude append prompt...");
  const memory = await loadMemory();
  const model = config.model;

  const parts: string[] = [];

  // Identity — who you are
  if (memory.identity) {
    parts.push(`# Identity\n\n${memory.identity}`);
  }

  // Curated memory summary
  if (memory.curatedSummary) {
    parts.push(`# Curated Memory\n\nYour consolidated understanding of Chris — updated weekly.\n\n${memory.curatedSummary}`);
  }

  // Knowledge
  if (memory.knowledge) {
    parts.push(`# Knowledge About Chris\n\n${memory.knowledge}`);
  }

  // Memories & learnings
  if (memory.memory) {
    parts.push(`# Memories & Learnings\n\n${memory.memory}`);
  }

  // Recent conversation summaries
  if (memory.recentSummaries) {
    parts.push(`# Recent Conversation History\n\nAI-generated summaries of recent conversations with Chris.\n\n${memory.recentSummaries}`);
  }

  // Journal
  if (memory.recentJournal) {
    parts.push(`# Your Recent Journal\n\nNotes you wrote during recent conversations.\n\n${memory.recentJournal}`);
  }

  // Skill discovery
  if (memory.skillIndex) {
    parts.push(`# Available Skills\n\nYou have reusable skills. Use the run_skill tool to execute them. Use manage_skills to create, edit, or delete skills.\n\n${memory.skillIndex}`);
  }

  // Custom tools description — Claude needs to know about the MCP tools it has
  parts.push(`# Custom Tools (via MCP)

You have the following custom tools in addition to your standard Claude Code tools:

**update_memory** — Update persistent memory about Chris. Categories: about-chris, preferences, projects, people, decisions, learnings. Use proactively when you learn something worth remembering.

**journal_entry** — Write a note in your daily journal. Use after substantive conversations.

**ssh** — Remote device management via Tailscale. Actions: exec, send_keys, read_pane, devices, scp_push, scp_pull.

**manage_schedule** — Create, list, delete, toggle scheduled tasks. These run on cron schedules.

**recall_conversations** — Search and read past conversation archives and summaries.

**manage_skills** — Create, list, update, delete, and toggle reusable skills. Skills are structured workflows that compose existing tools.

**run_skill** — Execute a skill by ID with optional inputs. The skill's instructions guide you through using its declared tools.`);

  // Telegram formatting rules
  parts.push(`# CRITICAL: Message Formatting Rules

You are Chris's personal AI assistant running as a Telegram bot. Every response is rendered in Telegram.

1. **Use emoji as visual markers** — start key points with relevant emoji (🎯 📦 💡 ⚡ ✅ 🔍 📝 ⚠️ 🛠️ 🚀)
2. **Bold key terms** — use **bold** for important words, options, names, labels
3. **Use line breaks generously** — separate ideas with blank lines. Never write dense paragraphs.
4. **Even short replies get personality** — a one-liner still uses emoji
5. **Be conversational** — for greetings, questions, opinions, and casual chat, just reply naturally. Don't reach for tools unless there's a reason.
6. **Proactively update memory** — if you learn something new about Chris, call update_memory
7. **Ask before big changes** — for destructive or multi-file edits, describe your plan first`);

  // System info
  parts.push(`# System Info

You are running as model \`${model}\` via the Anthropic Claude Agent SDK, authenticated through a Max subscription. You are accessible through Telegram as Chris's personal assistant.`);

  cachedClaudeAppendPrompt = parts.join("\n\n---\n\n");
  lastClaudePromptLoad = now;
  console.log("[prompt] Claude append prompt loaded (%d chars)", cachedClaudeAppendPrompt.length);

  return cachedClaudeAppendPrompt;
}

export async function getCodexSystemPrompt(): Promise<string> {
  const now = Date.now();
  if (cachedCodexSystemPrompt && now - lastCodexPromptLoad < PROMPT_CACHE_MS) {
    return cachedCodexSystemPrompt;
  }

  console.log("[prompt] Loading memory for Codex system prompt...");
  const memory = await loadMemory();
  const model = config.model;

  const parts: string[] = [];

  if (memory.identity) {
    parts.push(`# Identity\n\n${memory.identity}`);
  }

  if (memory.curatedSummary) {
    parts.push(`# Curated Memory\n\n${memory.curatedSummary}`);
  }

  if (memory.knowledge) {
    parts.push(`# Knowledge About Chris\n\n${memory.knowledge}`);
  }

  if (memory.memory) {
    parts.push(`# Memories & Learnings\n\n${memory.memory}`);
  }

  if (memory.recentSummaries) {
    parts.push(`# Recent Conversation History\n\n${memory.recentSummaries}`);
  }

  if (memory.recentJournal) {
    parts.push(`# Recent Journal\n\n${memory.recentJournal}`);
  }

  if (memory.skillIndex) {
    parts.push(`# Available Skills\n\n${memory.skillIndex}`);
  }

  const bootstrap = loadBootstrapFile();
  if (bootstrap) {
    parts.push(`# Project Context\n\n${bootstrap}`);
  }

  parts.push(`# Runtime Guidance

You are Chris's personal AI assistant running through the OpenAI Codex SDK, which wraps the \`codex\` CLI.

- Use Codex's native coding abilities for repository work.
- Stay concise and scan-friendly for Telegram output.
- Update Chris-facing memory only when it is genuinely useful.
- Ask before destructive or wide-ranging changes.
- Prefer making real progress over narrating tools.`);

  parts.push(`# Formatting

1. Use emoji sparingly but deliberately for scanability.
2. Bold key terms and decisions.
3. Prefer short paragraphs and compact lists.
4. Do not dump raw tool chatter back to the user.`);

  parts.push(`# System Info

You are running as model \`${model}\` via the OpenAI Codex SDK backed by the local \`codex\` CLI. You are accessible through Telegram as Chris's personal assistant.`);

  cachedCodexSystemPrompt = parts.join("\n\n---\n\n");
  lastCodexPromptLoad = now;
  console.log("[prompt] Codex system prompt loaded (%d chars)", cachedCodexSystemPrompt.length);

  return cachedCodexSystemPrompt;
}
