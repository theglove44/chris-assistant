/**
 * DreamTask — Background memory consolidation service.
 *
 * Inspired by Claude Code's autoDream system. Runs after conversations
 * when enough time has passed and enough new sessions have accumulated.
 *
 * 3-gate system (cheapest checks first):
 * 1. Time gate: >= minHours since last consolidation (default 12h)
 * 2. Session gate: >= minSessions new archive files since last consolidation
 * 3. Lock gate: no other process is mid-consolidation
 */

import * as fs from "fs";
import { chatService } from "../../agent/chat-service.js";
import { datestamp } from "../conversations/archive-service.js";
import { readLocalArchive, listLocalArchiveDates } from "../conversations/archive-service.js";
import { readLocalJournal, listLocalJournalDates } from "./journal-service.js";
import { CURATED_SUMMARY_PATH, KNOWLEDGE_FILES, MEMORY_FILES } from "./constants.js";
import { readMemoryFile, writeMemoryFile } from "./repository.js";
import { acquireLock, releaseLock, rollbackLock, hoursSinceLastConsolidation, lastConsolidatedAt } from "./dream-lock.js";
import { DREAM_CONSOLIDATION_PROMPT } from "./dream-prompt.js";

const MIN_HOURS = 12;
const MIN_SESSIONS = 3;
const MAX_TRANSCRIPT_CHARS = 80_000;
const MAX_OUTPUT_CHARS = 32_000;
const MAX_CONSECUTIVE_FAILURES = 3;

let consecutiveFailures = 0;
let dreamRunning = false;

/**
 * Count archive files modified since the last consolidation.
 */
function sessionsSinceLastConsolidation(): number {
  const lastTime = lastConsolidatedAt();
  if (lastTime === 0) return Infinity;

  const dates = listLocalArchiveDates();
  let count = 0;

  for (const date of dates) {
    try {
      const archivePath = `${process.env.HOME}/.chris-assistant/archive/${date}.jsonl`;
      const stat = fs.statSync(archivePath);
      if (stat.mtimeMs > lastTime) count++;
    } catch {
      // Skip files we can't stat
    }
  }

  return count;
}

/**
 * Check all three gates. Returns a reason string if blocked, null if clear.
 */
function checkGates(): string | null {
  // Circuit breaker
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return `circuit breaker: ${consecutiveFailures} consecutive failures`;
  }

  // Gate 1: Time
  const hours = hoursSinceLastConsolidation();
  if (hours < MIN_HOURS) {
    return `time gate: only ${hours.toFixed(1)}h since last consolidation (need ${MIN_HOURS}h)`;
  }

  // Gate 2: Sessions
  const sessions = sessionsSinceLastConsolidation();
  if (sessions < MIN_SESSIONS) {
    return `session gate: only ${sessions} new sessions (need ${MIN_SESSIONS})`;
  }

  // Gate 3: Lock
  if (!acquireLock()) {
    return "lock gate: another consolidation is in progress";
  }

  return null;
}

/**
 * Build the consolidation prompt with current memory state and recent transcripts.
 */
async function buildDreamPrompt(): Promise<string> {
  // Phase 1: Orient — read current memory state
  const [knowledgeResults, memoryResults, existingSummary] = await Promise.all([
    Promise.all(KNOWLEDGE_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
    Promise.all(MEMORY_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
    readMemoryFile(CURATED_SUMMARY_PATH),
  ]);

  // Phase 2: Gather — collect recent transcripts and journals
  const lastTime = lastConsolidatedAt();
  const allDates = listLocalArchiveDates();
  const recentDates = lastTime === 0
    ? allDates.slice(-7) // First run: last 7 days
    : allDates.filter((date) => {
        try {
          const archivePath = `${process.env.HOME}/.chris-assistant/archive/${date}.jsonl`;
          const stat = fs.statSync(archivePath);
          return stat.mtimeMs > lastTime;
        } catch {
          return false;
        }
      });

  // Build transcript excerpts (capped to avoid token explosion)
  let transcriptChars = 0;
  const transcriptParts: string[] = [];

  for (const date of recentDates.slice(-10)) { // Max 10 days
    const entries = readLocalArchive(date);
    if (entries.length === 0) continue;

    const lines = entries.map((e) => {
      const time = new Date(e.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
      const speaker = e.role === "user" ? "Chris" : "Assistant";
      return `[${time}] ${speaker}: ${e.content}`;
    });

    const dayText = `### ${date}\n${lines.join("\n")}`;

    if (transcriptChars + dayText.length > MAX_TRANSCRIPT_CHARS) {
      transcriptParts.push(`### ${date}\n[${entries.length} messages — truncated to stay within budget]`);
      break;
    }

    transcriptParts.push(dayText);
    transcriptChars += dayText.length;
  }

  // Gather journal entries for same period
  const journalDates = listLocalJournalDates();
  const recentJournalDates = lastTime === 0
    ? journalDates.slice(-7)
    : journalDates.filter((date) => {
        try {
          const journalPath = `${process.env.HOME}/.chris-assistant/journal/${date}.md`;
          const stat = fs.statSync(journalPath);
          return stat.mtimeMs > lastTime;
        } catch {
          return false;
        }
      });

  const journalParts = recentJournalDates.slice(-7).map((date) => {
    const content = readLocalJournal(date);
    return content ? `### ${date}\n${content}` : null;
  }).filter(Boolean);

  // Assemble the full prompt
  const formatFiles = (files: { path: string; content: string | null }[]) =>
    files.filter((f) => f.content).map((f) => `### ${f.path}\n${f.content}`).join("\n\n");

  const parts: string[] = [DREAM_CONSOLIDATION_PROMPT];

  if (existingSummary) {
    parts.push(`## Current SUMMARY.md\n\n${existingSummary}`);
  } else {
    parts.push("## Current SUMMARY.md\n\n(None — create from scratch)");
  }

  const knowledgeText = formatFiles(knowledgeResults);
  if (knowledgeText) parts.push(`## Current Knowledge Files\n\n${knowledgeText}`);

  const memoryText = formatFiles(memoryResults);
  if (memoryText) parts.push(`## Current Memory Files\n\n${memoryText}`);

  if (transcriptParts.length > 0) {
    parts.push(`## Recent Conversations (since last consolidation)\n\n${transcriptParts.join("\n\n")}`);
  }

  if (journalParts.length > 0) {
    parts.push(`## Recent Journal Entries\n\n${journalParts.join("\n\n")}`);
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Parse the consolidation response JSON from the model output.
 */
function parseResponse(raw: string): { summary?: string; learnings?: string | null; user?: string | null; changes: string[] } | null {
  // Strip thinking tags if present
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // Try to extract JSON from markdown code blocks
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : cleaned;

  try {
    return JSON.parse(jsonStr);
  } catch {
    // If the whole response isn't JSON, try to find a JSON object anywhere
    const objectMatch = cleaned.match(/\{[\s\S]*"changes"[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // fall through
      }
    }
    console.error("[dream] Failed to parse consolidation response as JSON");
    return null;
  }
}

/**
 * Execute the dream consolidation.
 */
export async function runDream(): Promise<{ success: boolean; changes: string[] }> {
  if (dreamRunning) {
    return { success: false, changes: ["Already running"] };
  }

  dreamRunning = true;
  const startTime = Date.now();

  try {
    console.log("[dream] Starting memory consolidation...");

    const prompt = await buildDreamPrompt();
    console.log("[dream] Prompt assembled (%d chars). Calling AI (no tools)...", prompt.length);

    // Use empty allowedTools to force a single-shot text response.
    // This prevents the dream agent from going on multi-turn tool-use
    // adventures and ensures it returns structured JSON.
    const raw = await chatService.sendMessage({
      chatId: 0,
      userMessage: prompt,
      allowedTools: [],
      maxTurns: 1,
    });
    console.log("[dream] Raw response length: %d chars, first 500: %s", raw.length, raw.slice(0, 500));
    const parsed = parseResponse(raw);

    if (!parsed) {
      consecutiveFailures++;
      rollbackLock();
      return { success: false, changes: ["Failed to parse AI response"] };
    }

    // Write updated files
    const writes: Promise<void>[] = [];
    const changes = parsed.changes || [];

    if (parsed.summary) {
      const truncated = parsed.summary.length > MAX_OUTPUT_CHARS
        ? parsed.summary.slice(0, MAX_OUTPUT_CHARS) + "\n\n<!-- truncated by dream -->"
        : parsed.summary;
      writes.push(writeMemoryFile(CURATED_SUMMARY_PATH, truncated, `dream: consolidation ${datestamp()}`));
    }

    if (parsed.learnings) {
      writes.push(writeMemoryFile("memory/learnings.md", parsed.learnings, `dream: update learnings ${datestamp()}`));
    }

    if (parsed.user) {
      writes.push(writeMemoryFile("USER.md", parsed.user, `dream: update user knowledge ${datestamp()}`));
    }

    await Promise.all(writes);

    // Success — release lock (updates mtime to now)
    releaseLock();
    consecutiveFailures = 0;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("[dream] Consolidation complete in %ss. Changes: %s", elapsed, changes.join("; "));

    return { success: true, changes };
  } catch (err: any) {
    consecutiveFailures++;
    rollbackLock();
    console.error("[dream] Consolidation failed:", err.message);
    return { success: false, changes: [`Error: ${err.message}`] };
  } finally {
    dreamRunning = false;
  }
}

/**
 * Try to run dream consolidation if all gates pass.
 * Called after each conversation turn — fire-and-forget.
 */
export async function tryDream(): Promise<void> {
  const blocked = checkGates();
  if (blocked) {
    return;
  }

  console.log("[dream] All gates passed — starting consolidation");
  const result = await runDream();

  if (result.success) {
    console.log("[dream] Finished: %d changes", result.changes.length);
  }
}

/**
 * Force a dream run, bypassing gates (for manual trigger / CLI).
 */
export async function forceDream(): Promise<{ success: boolean; changes: string[] }> {
  if (!acquireLock()) {
    return { success: false, changes: ["Another consolidation is in progress"] };
  }

  return runDream();
}

/**
 * Get dream status for diagnostics.
 */
export function dreamStatus(): {
  lastConsolidated: string;
  hoursSince: number;
  sessionsSince: number;
  consecutiveFailures: number;
  isRunning: boolean;
} {
  const last = lastConsolidatedAt();
  return {
    lastConsolidated: last === 0 ? "never" : new Date(last).toISOString(),
    hoursSince: Math.round(hoursSinceLastConsolidation() * 10) / 10,
    sessionsSince: sessionsSinceLastConsolidation(),
    consecutiveFailures,
    isRunning: dreamRunning,
  };
}
