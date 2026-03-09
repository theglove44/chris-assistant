import { config } from "../../config.js";
import { chatService } from "../../agent/chat-service.js";
import { sendToDiscordChannel } from "../../discord.js";
import { toMarkdownV2 } from "../../markdown.js";
import { matchesCron } from "./cron.js";
import { readSchedules, writeSchedules } from "./store.js";
import type { NewSchedule, Schedule, ScheduleUpdates } from "./types.js";

async function sendTelegramMessage(text: string, title?: string): Promise<void> {
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;

  try {
    let fullText = text;
    if (title) {
      fullText = `🧾 <b>${title}</b>\n\n${text}`;
    }

    const truncated = fullText.length > 4000 ? fullText.slice(0, 4000) + "\n\n[truncated]" : fullText;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.allowedUserId,
        text: truncated,
        parse_mode: "HTML",
      }),
    });
  } catch (err: any) {
    console.error("[scheduler] Failed to send Telegram message:", err.message);
  }
}

function wasRunThisMinute(task: Schedule, now: Date): boolean {
  if (!task.lastRun) return false;

  const lastRunDate = new Date(task.lastRun);
  return (
    lastRunDate.getFullYear() === now.getFullYear() &&
    lastRunDate.getMonth() === now.getMonth() &&
    lastRunDate.getDate() === now.getDate() &&
    lastRunDate.getHours() === now.getHours() &&
    lastRunDate.getMinutes() === now.getMinutes()
  );
}

async function executeTask(task: Schedule): Promise<void> {
  const toolInfo = task.allowedTools ? `tools: ${task.allowedTools.join(", ")}` : "tools: all";
  console.log("[scheduler] Executing task: %s (%s) — %s", task.name, task.id, toolInfo);

  try {
    const response = await chatService.sendMessage({
      chatId: 0,
      userMessage: task.prompt,
      allowedTools: task.allowedTools,
    });

    const trimmed = response.trim();
    if (!trimmed || trimmed.startsWith("NOUPDATE:")) {
      console.log("[scheduler] No update for task: %s — staying quiet", task.name);
    } else if (task.discordChannel) {
      await sendToDiscordChannel(task.discordChannel, trimmed);
    } else {
      await sendTelegramMessage(toMarkdownV2(trimmed), task.name);
    }

    task.lastRun = Date.now();
    writeSchedules(readSchedules());
    console.log("[scheduler] Task completed: %s", task.name);
  } catch (err: any) {
    console.error("[scheduler] Task failed: %s — %s", task.name, err.message);
    await sendTelegramMessage(`[${task.name}] Failed: ${err.message}`);
    task.lastRun = Date.now();
    writeSchedules(readSchedules());
  }
}

export class ScheduleService {
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.tickInterval !== null) return;

    const schedules = readSchedules();
    console.log("[scheduler] Loaded %d schedule(s)", schedules.length);

    this.tickInterval = setInterval(() => {
      this.tick().catch((err: any) => {
        console.error("[scheduler] Tick error:", err.message);
      });
    }, 60_000);

    console.log("[scheduler] Scheduler started (60s tick)");
  }

  stop(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      console.log("[scheduler] Scheduler stopped");
    }
  }

  getSchedules(): Schedule[] {
    return readSchedules();
  }

  addSchedule(task: NewSchedule): Schedule {
    const schedule: Schedule = {
      ...task,
      id: Math.random().toString(16).slice(2, 8),
      createdAt: Date.now(),
      lastRun: null,
    };

    const schedules = readSchedules();
    schedules.push(schedule);
    writeSchedules(schedules);
    console.log("[scheduler] Added schedule: %s (%s) — %s", schedule.name, schedule.id, schedule.schedule);
    return schedule;
  }

  removeSchedule(id: string): boolean {
    const schedules = readSchedules();
    const idx = schedules.findIndex((s) => s.id === id);
    if (idx === -1) return false;

    const [removed] = schedules.splice(idx, 1);
    writeSchedules(schedules);
    console.log("[scheduler] Removed schedule: %s (%s)", removed.name, removed.id);
    return true;
  }

  updateSchedule(id: string, updates: ScheduleUpdates): Schedule | null {
    const task = readSchedules().find((s) => s.id === id);
    if (!task) return null;

    if (updates.name !== undefined) task.name = updates.name;
    if (updates.prompt !== undefined) task.prompt = updates.prompt;
    if (updates.schedule !== undefined) task.schedule = updates.schedule;
    if (updates.enabled !== undefined) task.enabled = updates.enabled;
    if (updates.allowedTools !== undefined) task.allowedTools = updates.allowedTools.length > 0 ? updates.allowedTools : undefined;
    if (updates.discordChannel !== undefined) task.discordChannel = updates.discordChannel || undefined;

    writeSchedules(readSchedules());
    console.log("[scheduler] Updated schedule: %s (%s)", task.name, task.id);
    return task;
  }

  toggleSchedule(id: string): Schedule | null {
    const task = readSchedules().find((s) => s.id === id);
    if (!task) return null;

    task.enabled = !task.enabled;
    writeSchedules(readSchedules());
    console.log("[scheduler] Toggled schedule %s (%s): %s", task.name, task.id, task.enabled ? "enabled" : "disabled");
    return task;
  }

  async tick(now = new Date()): Promise<void> {
    for (const task of readSchedules()) {
      if (!task.enabled) continue;
      if (!matchesCron(task.schedule, now)) continue;
      if (wasRunThisMinute(task, now)) continue;

      executeTask(task).catch((err: any) => {
        console.error("[scheduler] Unexpected error in task %s:", task.id, err.message);
      });
    }
  }
}

export const scheduleService = new ScheduleService();
