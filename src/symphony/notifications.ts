import type { Issue } from "./types.js";

function canSendTelegram(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_ALLOWED_USER_ID;
}

async function sendTelegram(text: string): Promise<void> {
  if (!canSendTelegram()) return;

  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_ALLOWED_USER_ID,
        text,
      }),
    });
  } catch (err: any) {
    console.error("[symphony] Failed to send Telegram notification:", err.message);
  }
}

export async function notifyIssueClaimed(issue: Issue): Promise<void> {
  await sendTelegram(`Symphony claimed ${issue.identifier}: ${issue.title}`);
}

export async function notifyIssueBlocked(issue: Issue, reason: string): Promise<void> {
  await sendTelegram(`Symphony blocked on ${issue.identifier}: ${reason}`);
}

export async function notifyIssueReady(issue: Issue): Promise<void> {
  await sendTelegram(`Symphony handoff ready for ${issue.identifier}: ${issue.title}`);
}

export async function notifyRetryExhausted(issue: Issue, reason: string): Promise<void> {
  await sendTelegram(`Symphony retries exhausted for ${issue.identifier}: ${reason}`);
}
