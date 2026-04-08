import { chatService } from "../../agent/chat-service.js";
import { writeMemoryFile } from "../../memory/github.js";
import { datestamp, readLocalArchive } from "./archive-service.js";
import type { ArchiveEntry } from "./types.js";

const SUMMARY_HOUR = 23;
const SUMMARY_MINUTE = 50;
const SUMMARY_DAY = 0;
const TICK_INTERVAL_MS = 60_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastSummaryWeek = "";

function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function lastNDates(n: number): string[] {
  const dates: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(datestamp(d.getTime()));
  }
  return dates;
}

function sanitizeChannelName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
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

function groupByChannel(entries: ArchiveEntry[]): Map<string, ArchiveEntry[]> {
  const map = new Map<string, ArchiveEntry[]>();
  for (const entry of entries) {
    if (!entry.channelName) continue;
    const existing = map.get(entry.channelName);
    if (existing) existing.push(entry);
    else map.set(entry.channelName, [entry]);
  }
  return map;
}

async function generateChannelSummary(channelName: string, entries: ArchiveEntry[]): Promise<string> {
  const prompt = `You are summarizing a week's activity in the #${channelName} Discord channel between Chris and his AI assistant. Write a concise summary in markdown that captures:

- Key topics discussed
- Decisions made or agreed upon
- Action items or plans
- Useful information shared
- Open questions

Keep it under 2000 characters. Write naturally as a reference summary. Start directly with content, no title needed.

Here are this week's conversations in #${channelName}:

${formatArchiveForPrompt(entries)}`;

  const raw = await chatService.sendMessage({ chatId: 0, userMessage: prompt, allowedTools: [] });
  return raw.replace(new RegExp("<" + "think>[\\s\\S]*?<" + "/think>", "g"), "").trim();
}

async function runChannelSummaries(week: string): Promise<void> {
  console.log("[channel-summary] Running weekly channel summaries for week %s", week);

  const dates = lastNDates(7);
  const allEntries: ArchiveEntry[] = [];
  for (const date of dates) {
    allEntries.push(...readLocalArchive(date));
  }

  if (allEntries.length === 0) {
    console.log("[channel-summary] No messages in the past 7 days, skipping");
    return;
  }

  const channelMap = groupByChannel(allEntries);
  if (channelMap.size === 0) {
    console.log("[channel-summary] No channel-tagged messages found, skipping");
    return;
  }

  console.log("[channel-summary] Found %d channels with activity: %s", channelMap.size, [...channelMap.keys()].join(", "));

  for (const [channelName, entries] of channelMap) {
    try {
      const summary = await generateChannelSummary(channelName, entries);
      const sanitized = sanitizeChannelName(channelName);
      const repoPath = `conversations/channels/${sanitized}/${week}.md`;
      const markdown = `# #${channelName} — Week ${week}\n\n${summary}`;
      await writeMemoryFile(repoPath, markdown, `chore: weekly channel summary #${channelName} ${week}`);
      console.log("[channel-summary] Wrote summary for #%s (%d messages, %d chars)", channelName, entries.length, summary.length);
    } catch (err: any) {
      console.error("[channel-summary] Failed to summarize #%s:", channelName, err.message);
    }
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  if (now.getDay() !== SUMMARY_DAY) return;
  if (now.getHours() !== SUMMARY_HOUR) return;
  if (now.getMinutes() !== SUMMARY_MINUTE) return;

  const week = isoWeek(now);
  if (lastSummaryWeek === week) return;
  lastSummaryWeek = week;

  try {
    await runChannelSummaries(week);
  } catch (err: any) {
    console.error("[channel-summary] Failed to generate weekly channel summaries:", err.message);
  }
}

export function startChannelSummarizer(): void {
  if (tickTimer !== null) {
    console.warn("[channel-summary] Already running, ignoring duplicate start");
    return;
  }

  console.log("[channel-summary] Starting weekly channel summarizer (fires Sunday at %d:%02d)", SUMMARY_HOUR, SUMMARY_MINUTE);

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
