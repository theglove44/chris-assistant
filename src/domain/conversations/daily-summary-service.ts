import { mkdir, writeFile } from "fs/promises";
import * as path from "path";
import { chatService } from "../../agent/chat-service.js";
import { readMemoryFile, writeMemoryFile } from "../../memory/github.js";
import { readLocalJournal } from "../../memory/journal.js";
import { LOCAL_MEMORY_DIR } from "../memory/recall.js";
import { datestamp, readLocalArchive } from "./archive-service.js";
import type { ArchiveEntry } from "./types.js";

const SUMMARY_HOUR = 23;
const SUMMARY_MINUTE = 55;
const TICK_INTERVAL_MS = 60_000;
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

let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastSummaryDate = "";

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

/**
 * Dual-write: persist daily summary as a local recall file so Sonnet can
 * surface conversation context beyond the 7-day always-loaded window.
 */
async function writeLocalSummaryFile(date: string, summary: string): Promise<void> {
  try {
    const summariesDir = path.join(LOCAL_MEMORY_DIR, "summaries");
    await mkdir(summariesDir, { recursive: true });
    const filename = `${date}.md`;
    const filePath = path.join(summariesDir, filename);

    // First line of summary as description
    const firstLine = summary.split("\n").find((l) => l.trim().length > 0) || "";
    const description = firstLine.length > 120 ? firstLine.slice(0, 117) + "..." : firstLine;

    const fileContent = `---
name: conversation summary ${date}
description: ${description}
type: reference
---

# Conversation Summary — ${date}

${summary}
`;
    await writeFile(filePath, fileContent, "utf-8");
    console.log("[summary] Local recall file written: summaries/%s", filename);
  } catch (err: any) {
    console.warn("[summary] Failed to write local recall file:", err instanceof Error ? err.message : err);
  }
}

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

  const summary = await chatService.sendMessage({ chatId: 0, userMessage: context, allowedTools: [] });
  const cleaned = summary.replace(new RegExp("<" + "think>[\\s\\S]*?<" + "/think>", "g"), "").trim();

  await writeMemoryFile(summaryRepoPath(date), `# Conversation Summary — ${date}\n\n${cleaned}`, `chore: daily summary ${date}`);
  console.log("[summary] Wrote summary for %s (%d chars)", date, cleaned.length);

  // Dual-write: local recall file so Sonnet can surface old summaries
  // beyond the 7-day always-loaded window.
  writeLocalSummaryFile(date, cleaned).catch(() => {});

  return cleaned;
}

async function hasSummary(date: string): Promise<boolean> {
  const content = await readMemoryFile(summaryRepoPath(date));
  return content !== null;
}

async function tick(): Promise<void> {
  const now = new Date();
  if (now.getHours() !== SUMMARY_HOUR || now.getMinutes() !== SUMMARY_MINUTE) return;

  const today = datestamp();
  if (lastSummaryDate === today) return;
  lastSummaryDate = today;

  try {
    await generateSummary(today);
  } catch (err: any) {
    console.error("[summary] Failed to generate daily summary:", err.message);
  }
}

async function backfillYesterday(): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = datestamp(yesterday.getTime());

  const entries = readLocalArchive(date);
  if (entries.length === 0) return;

  try {
    if (await hasSummary(date)) return;
    console.log("[summary] Backfilling summary for yesterday (%s)", date);
    await generateSummary(date);
  } catch (err: any) {
    console.error("[summary] Failed to backfill yesterday's summary:", err.message);
  }
}

export function startDailySummarizer(): void {
  if (tickTimer !== null) {
    console.warn("[summary] Summarizer already running, ignoring duplicate start");
    return;
  }

  console.log("[summary] Starting daily summarizer (fires at %d:%02d)", SUMMARY_HOUR, SUMMARY_MINUTE);
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
