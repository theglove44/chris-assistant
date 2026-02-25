/**
 * Daily AI summarizer.
 *
 * Built-in module (not user-managed via manage_schedule — can't be accidentally
 * deleted). Ticks every 60s, fires at 23:55 local time to summarize today's
 * conversations. Writes summaries to the GitHub memory repo.
 *
 * On startup, checks if yesterday has messages but no summary (handles
 * overnight restarts).
 */

import { chat } from "./providers/index.js";
import { readLocalArchive, datestamp, type ArchiveEntry } from "./conversation-archive.js";
import { readMemoryFile, writeMemoryFile } from "./memory/github.js";
import { readLocalJournal } from "./memory/journal.js";

const SUMMARY_HOUR = 23;
const SUMMARY_MINUTE = 55;
const TICK_INTERVAL_MS = 60_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastSummaryDate = ""; // prevent double-fire

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summaryRepoPath(date: string): string {
  return `conversations/summaries/${date}.md`;
}

function formatArchiveForPrompt(entries: ArchiveEntry[]): string {
  return entries
    .map((e) => {
      const time = new Date(e.ts).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      const speaker = e.role === "user" ? "Chris" : "Assistant";
      return `[${time}] ${speaker}: ${e.content}`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

const SUMMARIZE_PROMPT = `You are summarizing today's conversations between Chris and his AI assistant for a daily recap. Write a concise summary in markdown that captures:

- Key topics discussed
- Any decisions made
- Action items or follow-ups
- Interesting things mentioned
- Emotional tone / how Chris seemed

Keep it under 2000 characters. Write naturally, not as a bulleted list — more like a brief journal entry. Use second person ("you" = Chris). Start directly with the content, no title needed.

Journal notes written by the assistant during the day (if any) are included after the conversation log — use them as additional context to enrich the summary.

Here are today's conversations:

`;

/**
 * Generate an AI summary for a given date.
 * Exported so the recall tool can trigger it on demand.
 */
export async function generateSummary(date: string): Promise<string | null> {
  const entries = readLocalArchive(date);
  if (entries.length === 0) {
    console.log("[summary] No messages for %s, skipping", date);
    return null;
  }

  const conversationText = formatArchiveForPrompt(entries);
  console.log("[summary] Generating summary for %s (%d messages)", date, entries.length);

  const journal = readLocalJournal(date);
  let context = SUMMARIZE_PROMPT + conversationText;
  if (journal) {
    context += "\n\n---\n\nThe assistant also wrote these journal notes during the day:\n\n" + journal;
  }

  // Use a dummy chatId (0) — this is an internal system call, not a user conversation
  const summary = await chat(0, context);

  // Strip any thinking tags (reasoning models)
  const cleaned = summary.replace(new RegExp("<" + "think>[\\s\\S]*?<" + "/think>", "g"), "").trim();

  // Write to GitHub
  const repoPath = summaryRepoPath(date);
  const markdown = `# Conversation Summary — ${date}\n\n${cleaned}`;
  await writeMemoryFile(repoPath, markdown, `chore: daily summary ${date}`);
  console.log("[summary] Wrote summary for %s (%d chars)", date, cleaned.length);

  return cleaned;
}

// ---------------------------------------------------------------------------
// Check if a summary already exists
// ---------------------------------------------------------------------------

async function hasSummary(date: string): Promise<boolean> {
  const content = await readMemoryFile(summaryRepoPath(date));
  return content !== null;
}

// ---------------------------------------------------------------------------
// Tick — fires at 23:55 local time
// ---------------------------------------------------------------------------

async function tick(): Promise<void> {
  const now = new Date();
  if (now.getHours() !== SUMMARY_HOUR || now.getMinutes() !== SUMMARY_MINUTE) return;

  const today = datestamp();
  if (lastSummaryDate === today) return; // already ran today

  lastSummaryDate = today;

  try {
    await generateSummary(today);
  } catch (err: any) {
    console.error("[summary] Failed to generate daily summary:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Startup check — backfill yesterday if missing
// ---------------------------------------------------------------------------

async function backfillYesterday(): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = datestamp(yesterday.getTime());

  const entries = readLocalArchive(date);
  if (entries.length === 0) return; // no messages yesterday

  try {
    if (await hasSummary(date)) return; // already summarized
    console.log("[summary] Backfilling summary for yesterday (%s)", date);
    await generateSummary(date);
  } catch (err: any) {
    console.error("[summary] Failed to backfill yesterday's summary:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startDailySummarizer(): void {
  if (tickTimer !== null) {
    console.warn("[summary] Summarizer already running, ignoring duplicate start");
    return;
  }

  console.log("[summary] Starting daily summarizer (fires at %d:%02d)", SUMMARY_HOUR, SUMMARY_MINUTE);

  // Backfill yesterday on startup
  backfillYesterday().catch((err: any) => {
    console.error("[summary] Unexpected error during backfill:", err.message);
  });

  tickTimer = setInterval(() => {
    tick().catch((err: any) => {
      console.error("[summary] Tick error:", err.message);
    });
  }, TICK_INTERVAL_MS);

  tickTimer.unref();
}

export function stopDailySummarizer(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
    console.log("[summary] Daily summarizer stopped");
  }
}
