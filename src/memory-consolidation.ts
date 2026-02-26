/**
 * Weekly memory consolidation.
 *
 * Built-in module (not user-managed via manage_schedule — can't be accidentally
 * deleted). Ticks every 60s, fires on Sunday at 23:00 local time to produce a
 * curated SUMMARY.md from the full knowledge base, recent daily summaries, and
 * recent journal entries.
 *
 * On startup: if memory/SUMMARY.md does not exist in GitHub, runs consolidation
 * immediately. Otherwise the Sunday 23:00 tick handles weekly updates.
 */

import { chat } from "./providers/index.js";
import { datestamp } from "./conversation-archive.js";
import { readMemoryFile, writeMemoryFile } from "./memory/github.js";
import { readLocalJournal } from "./memory/journal.js";

const CONSOLIDATION_HOUR = 23;
const CONSOLIDATION_DAY = 0; // Sunday (Date.getDay())
const TICK_INTERVAL_MS = 60_000;
const MAX_OUTPUT_CHARS = 32_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastConsolidationWeek = ""; // prevent double-fire: "YYYY-Www"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO week string for a Date: "YYYY-Www" */
function isoWeek(d: Date): string {
  // Copy date so we don't mutate the original
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number, making Sunday's day number 7
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

/** Generate the last N days of dates as YYYY-MM-DD strings. */
function lastNDates(n: number): string[] {
  const dates: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(datestamp(d.getTime()));
  }
  return dates;
}

const KNOWLEDGE_FILES = [
  "knowledge/about-chris.md",
  "knowledge/preferences.md",
  "knowledge/projects.md",
  "knowledge/people.md",
];

const MEMORY_FILES = [
  "memory/decisions.md",
  "memory/learnings.md",
];

const SUMMARY_REPO_PATH = "memory/SUMMARY.md";

// ---------------------------------------------------------------------------
// Consolidation prompt
// ---------------------------------------------------------------------------

const CONSOLIDATION_PROMPT = `You are performing a weekly memory consolidation for an AI assistant. Your task is to create a single, well-organized markdown document called SUMMARY.md that represents a curated, up-to-date understanding of Chris.

You have been given:
1. The current knowledge files (about-chris, preferences, projects, people)
2. The current memory files (decisions, learnings)
3. The existing SUMMARY.md (if any) — use this as the base to update, not replace from scratch
4. The past 7 days of daily conversation summaries
5. The past 7 days of journal entries written by the assistant

Your output should:
- Be a single well-organized markdown document
- Organize information by topic: who Chris is, current projects, preferences & style, important people, recent events & context, key decisions, communication patterns & what works
- Merge new information from the journals and summaries into the existing SUMMARY.md structure
- Remove outdated information (finished projects, stale facts that have been superseded)
- Keep it under 30000 characters total
- Write naturally and in an integrated way — not as a raw data dump or list of facts
- Maintain the existing structure if SUMMARY.md already exists; update it rather than rewriting from scratch
- Start with a brief "Last updated: WEEK" line at the top

Here is all the context:

`;

// ---------------------------------------------------------------------------
// Consolidation generation
// ---------------------------------------------------------------------------

export async function runConsolidation(): Promise<void> {
  const now = new Date();
  const week = isoWeek(now);
  console.log("[consolidation] Running weekly memory consolidation for week %s", week);

  // 1. Load all knowledge and memory files from GitHub
  const [knowledgeResults, memoryResults] = await Promise.all([
    Promise.all(KNOWLEDGE_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
    Promise.all(MEMORY_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
  ]);

  // 2. Load existing SUMMARY.md and last 7 days of conversation summaries from GitHub
  const recentDates = lastNDates(7);
  const [existingSummary, ...dailySummaryResults] = await Promise.all([
    readMemoryFile(SUMMARY_REPO_PATH),
    ...recentDates.map((date) =>
      readMemoryFile(`conversations/summaries/${date}.md`).then((c) => ({ date, content: c }))
    ),
  ]);

  // 3. Load last 7 days of local journals
  const journalEntries = recentDates.map((date) => ({
    date,
    content: readLocalJournal(date),
  }));

  // ---------------------------------------------------------------------------
  // Build prompt context
  // ---------------------------------------------------------------------------

  const formatFileSection = (files: { path: string; content: string | null }[]) =>
    files
      .filter((f) => f.content)
      .map((f) => `### ${f.path}\n\n${f.content}`)
      .join("\n\n");

  const parts: string[] = [CONSOLIDATION_PROMPT];

  // Existing SUMMARY.md
  if (existingSummary) {
    parts.push(`## Existing SUMMARY.md (update this, don't replace from scratch)\n\n${existingSummary}`);
  } else {
    parts.push(`## Existing SUMMARY.md\n\n(None — create from scratch)`);
  }

  // Knowledge files
  const knowledgeText = formatFileSection(knowledgeResults);
  if (knowledgeText) {
    parts.push(`## Current Knowledge Files\n\n${knowledgeText}`);
  }

  // Memory files
  const memoryText = formatFileSection(memoryResults);
  if (memoryText) {
    parts.push(`## Current Memory Files\n\n${memoryText}`);
  }

  // Daily conversation summaries
  const summaryText = (dailySummaryResults as { date: string; content: string | null }[])
    .filter((s) => s.content)
    .map((s) => `### ${s.date}\n\n${s.content}`)
    .join("\n\n");
  if (summaryText) {
    parts.push(`## Past 7 Days — Conversation Summaries\n\n${summaryText}`);
  }

  // Journal entries
  const journalText = journalEntries
    .filter((j) => j.content)
    .map((j) => `### ${j.date}\n\n${j.content}`)
    .join("\n\n");
  if (journalText) {
    parts.push(`## Past 7 Days — Journal Entries\n\n${journalText}`);
  }

  const prompt = parts.join("\n\n---\n\n");

  console.log(
    "[consolidation] Prompt assembled (%d chars). Calling chat()...",
    prompt.length
  );

  // Use chatId 0 — internal system call, not a user conversation
  const raw = await chat(0, prompt);

  // Strip thinking tags (reasoning models)
  const cleaned = raw
    .replace(new RegExp("<" + "think>[\\s\\S]*?<" + "/think>", "g"), "")
    .trim();

  // Truncate to max output size
  const truncated =
    cleaned.length > MAX_OUTPUT_CHARS ? cleaned.slice(0, MAX_OUTPUT_CHARS) + "\n\n<!-- truncated -->" : cleaned;

  // Write to GitHub
  await writeMemoryFile(SUMMARY_REPO_PATH, truncated, `chore: weekly memory consolidation ${week}`);
  console.log("[consolidation] Wrote SUMMARY.md (%d chars) for week %s", truncated.length, week);
}

// ---------------------------------------------------------------------------
// Tick — fires on Sunday at 23:00 local time
// ---------------------------------------------------------------------------

async function tick(): Promise<void> {
  const now = new Date();
  if (now.getDay() !== CONSOLIDATION_DAY) return;
  if (now.getHours() !== CONSOLIDATION_HOUR) return;

  const week = isoWeek(now);
  if (lastConsolidationWeek === week) return; // already ran this week

  lastConsolidationWeek = week;

  try {
    await runConsolidation();
  } catch (err: any) {
    console.error("[consolidation] Failed to run weekly consolidation:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Startup check — run immediately if SUMMARY.md doesn't exist
// ---------------------------------------------------------------------------

async function startupCheck(): Promise<void> {
  try {
    const existing = await readMemoryFile(SUMMARY_REPO_PATH);
    if (existing !== null) {
      console.log("[consolidation] SUMMARY.md exists — skipping startup consolidation");
      return;
    }
    console.log("[consolidation] SUMMARY.md not found — running initial consolidation on startup");
    await runConsolidation();
  } catch (err: any) {
    console.error("[consolidation] Startup check failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startMemoryConsolidation(): void {
  if (tickTimer !== null) {
    console.warn("[consolidation] Already running, ignoring duplicate start");
    return;
  }

  console.log(
    "[consolidation] Starting weekly memory consolidation (fires Sunday at %d:00)",
    CONSOLIDATION_HOUR
  );

  // Run startup check — backfills if SUMMARY.md is missing
  startupCheck().catch((err: any) => {
    console.error("[consolidation] Unexpected error during startup check:", err.message);
  });

  tickTimer = setInterval(() => {
    tick().catch((err: any) => {
      console.error("[consolidation] Tick error:", err.message);
    });
  }, TICK_INTERVAL_MS);

  tickTimer.unref();
}

export function stopMemoryConsolidation(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
    console.log("[consolidation] Weekly memory consolidation stopped");
  }
}
