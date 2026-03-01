/**
 * Weekly per-channel summarizer.
 *
 * Built-in module. Ticks every 60s, fires Sunday at 23:50 local time.
 * Reads the past 7 days of archives, groups messages by channel (using
 * the `channelName` field from ArchiveEntry), and generates a focused
 * summary for each channel that had activity.
 *
 * Summaries are written to conversations/channels/<name>/YYYY-WXX.md
 * in the GitHub memory repo.
 */

import { chat } from "./providers/index.js";
import { readLocalArchive, datestamp, type ArchiveEntry } from "./conversation-archive.js";
import { writeMemoryFile } from "./memory/github.js";

const SUMMARY_HOUR = 23;
const SUMMARY_MINUTE = 50;
const SUMMARY_DAY = 0; // Sunday (Date.getDay())
const TICK_INTERVAL_MS = 60_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastSummaryWeek = ""; // prevent double-fire: "YYYY-Www"

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
  for (let i = 0; i <= n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(datestamp(d.getTime()));
  }
  return dates;
}

/** Sanitize a channel name for use in repo paths: lowercase, hyphens, alphanumeric only. */
function sanitizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/** Format archive entries as readable conversation text for the summarization prompt. */
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

/** Group archive entries by channelName, skipping entries without one. */
function groupByChannel(entries: ArchiveEntry[]): Map<string, ArchiveEntry[]> {
  const map = new Map<string, ArchiveEntry[]>();
  for (const entry of entries) {
    if (!entry.channelName) continue;
    const existing = map.get(entry.channelName);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(entry.channelName, [entry]);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

/** Generate an AI summary for a single channel's weekly activity. */
async function generateChannelSummary(
  channelName: string,
  entries: ArchiveEntry[],
): Promise<string> {
  const conversationText = formatArchiveForPrompt(entries);

  const prompt = `You are summarizing a week's activity in the #${channelName} Discord channel between Chris and his AI assistant. Write a concise summary in markdown that captures:

- Key topics discussed
- Decisions made or agreed upon
- Action items or plans
- Useful information shared
- Open questions

Keep it under 2000 characters. Write naturally as a reference summary. Start directly with content, no title needed.

Here are this week's conversations in #${channelName}:

${conversationText}`;

  // Use chatId 0 — internal system call, not a user conversation
  const raw = await chat(0, prompt);

  // Strip thinking tags (reasoning models) — esbuild-safe regex
  return raw.replace(new RegExp("<" + "think>[\\s\\S]*?<" + "/think>", "g"), "").trim();
}

// ---------------------------------------------------------------------------
// Tick — fires on Sunday at 23:50 local time
// ---------------------------------------------------------------------------

async function tick(): Promise<void> {
  const now = new Date();
  if (now.getDay() !== SUMMARY_DAY) return;
  if (now.getHours() !== SUMMARY_HOUR) return;
  if (now.getMinutes() !== SUMMARY_MINUTE) return;

  const week = isoWeek(now);
  if (lastSummaryWeek === week) return; // already ran this week

  lastSummaryWeek = week;

  try {
    await runChannelSummaries(week);
  } catch (err: any) {
    console.error("[channel-summary] Failed to generate weekly channel summaries:", err.message);
  }
}

/** Run channel summaries for the past 7 days. */
async function runChannelSummaries(week: string): Promise<void> {
  console.log("[channel-summary] Running weekly channel summaries for week %s", week);

  // Collect all archive entries from the past 7 days (including today)
  const dates = lastNDates(7);
  const allEntries: ArchiveEntry[] = [];
  for (const date of dates) {
    allEntries.push(...readLocalArchive(date));
  }

  if (allEntries.length === 0) {
    console.log("[channel-summary] No messages in the past 7 days, skipping");
    return;
  }

  // Group by channel
  const channelMap = groupByChannel(allEntries);

  if (channelMap.size === 0) {
    console.log("[channel-summary] No channel-tagged messages found, skipping");
    return;
  }

  console.log(
    "[channel-summary] Found %d channels with activity: %s",
    channelMap.size,
    [...channelMap.keys()].join(", "),
  );

  // Generate a summary for each channel
  for (const [channelName, entries] of channelMap) {
    try {
      const sanitized = sanitizeChannelName(channelName);
      const summary = await generateChannelSummary(channelName, entries);

      const repoPath = `conversations/channels/${sanitized}/${week}.md`;
      const markdown = `# #${channelName} — Week ${week}\n\n${summary}`;
      await writeMemoryFile(repoPath, markdown, `chore: weekly channel summary #${channelName} ${week}`);
      console.log(
        "[channel-summary] Wrote summary for #%s (%d messages, %d chars)",
        channelName,
        entries.length,
        summary.length,
      );
    } catch (err: any) {
      console.error("[channel-summary] Failed to summarize #%s:", channelName, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startChannelSummarizer(): void {
  if (tickTimer !== null) {
    console.warn("[channel-summary] Already running, ignoring duplicate start");
    return;
  }

  console.log(
    "[channel-summary] Starting weekly channel summarizer (fires Sunday at %d:%02d)",
    SUMMARY_HOUR,
    SUMMARY_MINUTE,
  );

  tickTimer = setInterval(() => {
    tick().catch((err: any) => {
      console.error("[channel-summary] Tick error:", err.message);
    });
  }, TICK_INTERVAL_MS);

  tickTimer.unref();
}

export function stopChannelSummarizer(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
    console.log("[channel-summary] Weekly channel summarizer stopped");
  }
}
