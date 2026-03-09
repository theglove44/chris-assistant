/**
 * Daily usage report — posts a token usage / cost summary to Telegram at midnight.
 *
 * Follows the same tick-based pattern as daily-summary-service.ts:
 * check every 60s, fire at the target hour:minute, prevent double-fire.
 */

import { config } from "../../config.js";
import { formatUsageReport } from "../../usage-tracker.js";
import { toMarkdownV2 } from "../../markdown.js";

const REPORT_HOUR = 0;
const REPORT_MINUTE = 0;
const TICK_INTERVAL_MS = 60_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastReportDate = "";

async function sendTelegramMessage(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;

  try {
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "\n\n[truncated]" : text;

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
    console.error("[usage-report] Failed to send Telegram message:", err.message);
  }
}

export async function generateAndSendUsageReport(date?: string): Promise<void> {
  // Default to yesterday (midnight report covers the previous day)
  const reportDate = date ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const report = formatUsageReport(reportDate);

  // Convert markdown bold to HTML bold for Telegram
  const htmlReport = toMarkdownV2(report);
  await sendTelegramMessage(htmlReport);
  console.log("[usage-report] Sent daily report for %s", reportDate);
}

async function tick(): Promise<void> {
  const now = new Date();
  if (now.getHours() !== REPORT_HOUR || now.getMinutes() !== REPORT_MINUTE) return;

  const today = now.toISOString().slice(0, 10);
  if (lastReportDate === today) return;
  lastReportDate = today;

  try {
    await generateAndSendUsageReport();
  } catch (err: any) {
    console.error("[usage-report] Failed to generate daily usage report:", err.message);
  }
}

export function startUsageReport(): void {
  if (tickTimer !== null) {
    console.warn("[usage-report] Already running, ignoring duplicate start");
    return;
  }

  console.log("[usage-report] Starting daily usage reporter (fires at %d:%02d)", REPORT_HOUR, REPORT_MINUTE);

  tickTimer = setInterval(() => {
    tick().catch((err: any) => {
      console.error("[usage-report] Tick error:", err.message);
    });
  }, TICK_INTERVAL_MS);

  tickTimer.unref();
}

export function stopUsageReport(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
    console.log("[usage-report] Daily usage reporter stopped");
  }
}
