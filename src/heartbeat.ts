/**
 * Periodic heartbeat writer.
 *
 * Every 3 hours, writes HEARTBEAT.md to the root of the GitHub memory repo
 * with a self-reported status snapshot: uptime, model, health checks,
 * scheduled tasks, and last conversation activity.
 *
 * Also writes once immediately on startup. Uses SHA-256 hash dedup to skip
 * writes when nothing has changed.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Octokit } from "@octokit/rest";
import { config, repoOwner, repoName } from "./config.js";
import { writeMemoryFile } from "./memory/github.js";
import { getSchedules } from "./scheduler.js";
import { loadTokens as loadMinimaxTokens } from "./providers/minimax-oauth.js";
import { loadTokens as loadOpenaiTokens } from "./providers/openai-oauth.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
const HEARTBEAT_REPO_PATH = "HEARTBEAT.md";

// Warning thresholds — mirror the values in health.ts
const MINIMAX_WARN_MS = 30 * 60 * 1000;   // 30 minutes
const OPENAI_WARN_MS  = 60 * 60 * 1000;   // 1 hour

// Local data paths
const CONVERSATIONS_FILE = path.join(os.homedir(), ".chris-assistant", "conversations.json");
const ARCHIVE_DIR = path.join(os.homedir(), ".chris-assistant", "archive");

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** UTC ISO string captured once when the module first loads. */
const BOT_STARTED_AT = new Date().toISOString();

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastWrittenHash = "";

const octokit = new Octokit({ auth: config.github.token });

// ---------------------------------------------------------------------------
// Provider name helper (mirrors health.ts / provider logic)
// ---------------------------------------------------------------------------

function getProviderName(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-")) return "OpenAI";
  if (model.startsWith("MiniMax")) return "MiniMax";
  return "Claude";
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function relativeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Uptime formatter
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// SHA-256 dedup helper
// ---------------------------------------------------------------------------

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Health status collectors
// ---------------------------------------------------------------------------

interface StatusLine {
  label: string;
  icon: string;
  detail: string;
}

async function githubStatus(): Promise<StatusLine> {
  try {
    await octokit.repos.get({ owner: repoOwner, repo: repoName });
    return { label: "GitHub memory repo", icon: "✅", detail: "OK" };
  } catch (err: any) {
    return { label: "GitHub memory repo", icon: "🔴", detail: err.message ?? "unreachable" };
  }
}

function minimaxStatus(): StatusLine {
  const tokens = loadMinimaxTokens();
  if (!tokens) {
    return { label: "MiniMax tokens", icon: "⚪", detail: "not configured" };
  }

  const now = Date.now();
  if (now >= tokens.expires) {
    return { label: "MiniMax tokens", icon: "🔴", detail: "expired — run chris minimax login" };
  }
  if (now >= tokens.expires - MINIMAX_WARN_MS) {
    const minutesLeft = Math.floor((tokens.expires - now) / 60_000);
    return {
      label: "MiniMax tokens",
      icon: "🟡",
      detail: `expiring in ~${minutesLeft}m`,
    };
  }
  const hoursLeft = Math.floor((tokens.expires - now) / 3_600_000);
  return { label: "MiniMax tokens", icon: "✅", detail: `OK (expires in ${hoursLeft}h)` };
}

function openaiStatus(): StatusLine {
  const tokens = loadOpenaiTokens();
  if (!tokens) {
    return { label: "OpenAI tokens", icon: "⚪", detail: "not configured" };
  }

  const hasRefreshToken = Boolean(tokens.refresh_token);
  if (hasRefreshToken) {
    return { label: "OpenAI tokens", icon: "✅", detail: "OK (has refresh token)" };
  }

  const now = Date.now();
  if (now >= tokens.expires) {
    return { label: "OpenAI tokens", icon: "🔴", detail: "expired — run chris openai login" };
  }
  if (now >= tokens.expires - OPENAI_WARN_MS) {
    const minutesLeft = Math.floor((tokens.expires - now) / 60_000);
    return {
      label: "OpenAI tokens",
      icon: "🟡",
      detail: `expiring in ~${minutesLeft}m (no refresh token)`,
    };
  }
  return { label: "OpenAI tokens", icon: "✅", detail: "OK (no refresh token, not expiring soon)" };
}

// ---------------------------------------------------------------------------
// Activity collectors
// ---------------------------------------------------------------------------

interface ActivityInfo {
  lastMessageRelative: string;
  messagesToday: number;
}

function getActivityInfo(): ActivityInfo {
  // Last message: read conversations.json for the most recent timestamp
  let lastMessageRelative = "unknown";
  try {
    const raw = fs.readFileSync(CONVERSATIONS_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, Array<{ role: string; content: string; timestamp?: number }>>;
    let latestTs = 0;
    for (const messages of Object.values(data)) {
      for (const msg of messages) {
        if (msg.timestamp && msg.timestamp > latestTs) {
          latestTs = msg.timestamp;
        }
      }
    }
    if (latestTs > 0) {
      lastMessageRelative = relativeTime(Date.now() - latestTs);
    }
  } catch {
    // conversations.json may not exist yet
  }

  // Messages today: count lines in today's JSONL archive
  let messagesToday = 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const archivePath = path.join(ARCHIVE_DIR, `${today}.jsonl`);
    const raw = fs.readFileSync(archivePath, "utf-8");
    messagesToday = raw.split("\n").filter(Boolean).length;
  } catch {
    // Archive file may not exist yet today
  }

  return { lastMessageRelative, messagesToday };
}

// ---------------------------------------------------------------------------
// Scheduled tasks section
// ---------------------------------------------------------------------------

function buildScheduledTasksSection(): string {
  const schedules = getSchedules();
  if (schedules.length === 0) {
    return "## Scheduled Tasks\n\nNo tasks configured.\n";
  }

  const now = Date.now();
  const lines = schedules.map((task) => {
    const lastRunStr = task.lastRun
      ? relativeTime(now - task.lastRun)
      : "never";
    const state = task.enabled ? "enabled" : "disabled";
    return `- ${task.name} — \`${task.schedule}\` (${state}) — last run: ${lastRunStr}`;
  });

  return `## Scheduled Tasks\n\n${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Heartbeat document builder
// ---------------------------------------------------------------------------

async function buildHeartbeatDocument(): Promise<string> {
  const now = new Date().toISOString();
  const uptimeSeconds = process.uptime();
  const model = config.model;
  const provider = getProviderName(model);

  // Collect health statuses (GitHub check is async, token checks are sync)
  const ghStatus = await githubStatus();
  const mmStatus = minimaxStatus();
  const oaiStatus = openaiStatus();

  const healthLines = [ghStatus, mmStatus, oaiStatus]
    .map((s) => `- **${s.label}**: ${s.icon} ${s.detail}`)
    .join("\n");

  const { lastMessageRelative, messagesToday } = getActivityInfo();
  const scheduledSection = buildScheduledTasksSection();

  return [
    "# Bot Heartbeat",
    "",
    `*Last updated: ${now}*`,
    "",
    "## Status",
    `- **Uptime**: ${formatUptime(Math.floor(uptimeSeconds))}`,
    `- **Started**: ${BOT_STARTED_AT}`,
    `- **Model**: ${model} (${provider})`,
    "",
    "## Health",
    healthLines,
    "",
    scheduledSection,
    "## Recent Activity",
    `- Last message: ${lastMessageRelative}`,
    `- Messages today: ${messagesToday}`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Core writer
// ---------------------------------------------------------------------------

async function runHeartbeat(): Promise<void> {
  let document: string;
  try {
    document = await buildHeartbeatDocument();
  } catch (err: any) {
    console.error("[heartbeat] Failed to build heartbeat document:", err.message);
    return;
  }

  const currentHash = hashContent(document);
  if (currentHash === lastWrittenHash) {
    console.log("[heartbeat] No changes since last write, skipping");
    return;
  }

  try {
    await writeMemoryFile(HEARTBEAT_REPO_PATH, document, "chore: heartbeat update");
    lastWrittenHash = currentHash;
    console.log("[heartbeat] HEARTBEAT.md written to GitHub");
  } catch (err: any) {
    // Log and continue — a failed heartbeat write must never crash the bot
    console.error("[heartbeat] Failed to write HEARTBEAT.md to GitHub:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the periodic heartbeat writer.
 * Runs an immediate write on startup, then every 3 hours.
 */
export function startHeartbeat(): void {
  if (heartbeatTimer !== null) {
    console.warn("[heartbeat] Heartbeat already running, ignoring duplicate start");
    return;
  }

  console.log("[heartbeat] Starting heartbeat writer (every 3 hours)");

  // Immediate write on startup so the file is up-to-date from the first moment
  runHeartbeat().catch((err: any) => {
    console.error("[heartbeat] Unexpected error during initial write:", err.message);
  });

  heartbeatTimer = setInterval(() => {
    runHeartbeat().catch((err: any) => {
      console.error("[heartbeat] Unexpected error during scheduled write:", err.message);
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Don't keep the process alive if everything else has exited
  heartbeatTimer.unref();
}

/**
 * Stop the periodic heartbeat writer.
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log("[heartbeat] Heartbeat stopped");
  }
}
