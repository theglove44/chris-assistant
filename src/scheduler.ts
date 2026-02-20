/**
 * Scheduled tasks (cron-like) via Telegram.
 *
 * Loads tasks from ~/.chris-assistant/schedules.json, ticks every 60s,
 * and fires matching tasks by sending the prompt to the active AI provider
 * with full tool access. Results are sent to Telegram via raw fetch.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { config } from "./config.js";
import { chat } from "./providers/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  schedule: string; // cron expression (min hour dom month dow)
  enabled: boolean;
  createdAt: number;
  lastRun: number | null;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(os.homedir(), ".chris-assistant");
const SCHEDULES_FILE = path.join(DATA_DIR, "schedules.json");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let schedules: Schedule[] = [];
let tickInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadSchedules(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const raw = fs.readFileSync(SCHEDULES_FILE, "utf-8");
    schedules = JSON.parse(raw);
  } catch {
    schedules = [];
  }
}

function saveSchedules(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Cron matching
// ---------------------------------------------------------------------------

/**
 * Check if a Date matches a 5-field cron expression.
 * Supports: *, specific numbers, comma-separated values, step values (star/N).
 * Fields: minute hour day-of-month month day-of-week (0=Sun or 7=Sun)
 */
function matchesCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1, // cron months are 1-12
    date.getDay(), // 0=Sunday
  ];

  for (let i = 0; i < 5; i++) {
    if (!fieldMatches(fields[i], values[i], i === 4)) return false;
  }
  return true;
}

function fieldMatches(field: string, value: number, isDow: boolean): boolean {
  // Handle comma-separated values
  if (field.includes(",")) {
    return field.split(",").some((part) => fieldMatches(part.trim(), value, isDow));
  }

  // Handle step values: */N
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return false;
    return value % step === 0;
  }

  // Wildcard
  if (field === "*") return true;

  // Specific number
  const num = parseInt(field, 10);
  if (isNaN(num)) return false;

  // Normalize day-of-week: 7 → 0 (both mean Sunday)
  if (isDow && num === 7) return value === 0;

  return value === num;
}

// ---------------------------------------------------------------------------
// Telegram sender (raw fetch, same pattern as health.ts)
// ---------------------------------------------------------------------------

async function sendTelegramMessage(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  try {
    // Telegram has a 4096 char limit — truncate if needed
    const truncated = text.length > 4000
      ? text.slice(0, 4000) + "\n\n[truncated]"
      : text;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.allowedUserId,
        text: truncated,
      }),
    });
  } catch (err: any) {
    console.error("[scheduler] Failed to send Telegram message:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

async function executeTask(task: Schedule): Promise<void> {
  console.log("[scheduler] Executing task: %s (%s)", task.name, task.id);

  try {
    // Use the user's actual chat ID so the AI has conversation context
    const chatId = config.telegram.allowedUserId;
    const response = await chat(chatId, task.prompt);

    await sendTelegramMessage(`[${task.name}]\n\n${response}`);

    // Update lastRun
    task.lastRun = Date.now();
    saveSchedules();

    console.log("[scheduler] Task completed: %s", task.name);
  } catch (err: any) {
    console.error("[scheduler] Task failed: %s — %s", task.name, err.message);
    await sendTelegramMessage(`[${task.name}] Failed: ${err.message}`);
    task.lastRun = Date.now();
    saveSchedules();
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

async function tick(): Promise<void> {
  const now = new Date();

  for (const task of schedules) {
    if (!task.enabled) continue;
    if (!matchesCron(task.schedule, now)) continue;

    // Prevent double-firing: skip if lastRun was within the same minute
    if (task.lastRun) {
      const lastRunDate = new Date(task.lastRun);
      if (
        lastRunDate.getFullYear() === now.getFullYear() &&
        lastRunDate.getMonth() === now.getMonth() &&
        lastRunDate.getDate() === now.getDate() &&
        lastRunDate.getHours() === now.getHours() &&
        lastRunDate.getMinutes() === now.getMinutes()
      ) {
        continue;
      }
    }

    // Fire and forget — don't block other tasks
    executeTask(task).catch((err: any) => {
      console.error("[scheduler] Unexpected error in task %s:", task.id, err.message);
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startScheduler(): void {
  loadSchedules();
  console.log("[scheduler] Loaded %d schedule(s)", schedules.length);

  tickInterval = setInterval(() => {
    tick().catch((err: any) => {
      console.error("[scheduler] Tick error:", err.message);
    });
  }, 60_000);

  console.log("[scheduler] Scheduler started (60s tick)");
}

export function stopScheduler(): void {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
    console.log("[scheduler] Scheduler stopped");
  }
}

export function getSchedules(): Schedule[] {
  return schedules;
}

export function addSchedule(task: Omit<Schedule, "id" | "createdAt" | "lastRun">): Schedule {
  const id = Math.random().toString(16).slice(2, 8);
  const schedule: Schedule = {
    ...task,
    id,
    createdAt: Date.now(),
    lastRun: null,
  };
  schedules.push(schedule);
  saveSchedules();
  console.log("[scheduler] Added schedule: %s (%s) — %s", schedule.name, schedule.id, schedule.schedule);
  return schedule;
}

export function removeSchedule(id: string): boolean {
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  const [removed] = schedules.splice(idx, 1);
  saveSchedules();
  console.log("[scheduler] Removed schedule: %s (%s)", removed.name, removed.id);
  return true;
}

export function toggleSchedule(id: string): Schedule | null {
  const task = schedules.find((s) => s.id === id);
  if (!task) return null;
  task.enabled = !task.enabled;
  saveSchedules();
  console.log("[scheduler] Toggled schedule %s (%s): %s", task.name, task.id, task.enabled ? "enabled" : "disabled");
  return task;
}
