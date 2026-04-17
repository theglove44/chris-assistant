/**
 * Upload tracker — tracks last-success / last-failure timestamps for the three
 * GitHub upload services (archive, journal, conversation-backup).
 *
 * State is in-memory only (v1). It resets on restart, which is acceptable:
 * the health endpoint will show "never uploaded" until the first tick fires.
 *
 * Surface area:
 *   - recordUploadSuccess(service, file?) — call after a successful GitHub write
 *   - recordUploadFailure(service, file, err) — call on exhausted retry, triggers alert
 *   - getUploadHealthStatus() — called by health.ts to merge into /api/health
 */

import { config } from "../../config.js";

export type UploadServiceName = "archive-uploader" | "journal-uploader" | "conversation-backup";

interface UploadServiceState {
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureMsg: string | null;
  consecutiveFailures: number;
  /** Timestamp of the last Telegram alert sent for this service. */
  lastAlertAt: number | null;
}

const ALERT_DEDUP_MS = 60 * 60 * 1000; // 1 hour

const state = new Map<UploadServiceName, UploadServiceState>();

function getOrCreate(service: UploadServiceName): UploadServiceState {
  let s = state.get(service);
  if (!s) {
    s = {
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureMsg: null,
      consecutiveFailures: 0,
      lastAlertAt: null,
    };
    state.set(service, s);
  }
  return s;
}

export function recordUploadSuccess(service: UploadServiceName, file?: string): void {
  const s = getOrCreate(service);
  s.lastSuccessAt = Date.now();
  s.consecutiveFailures = 0;
  // Clear failure state on recovery so the next failure starts fresh
  if (s.lastFailureAt !== null) {
    console.log("[upload-tracker] %s recovered (file: %s)", service, file ?? "n/a");
    s.lastFailureAt = null;
    s.lastFailureMsg = null;
  }
}

export function recordUploadFailure(service: UploadServiceName, file: string, err: unknown): void {
  const s = getOrCreate(service);
  const errMsg = err instanceof Error ? err.message : String(err);
  s.lastFailureAt = Date.now();
  s.lastFailureMsg = `${file}: ${errMsg}`;
  s.consecutiveFailures += 1;

  console.error(
    "[upload-tracker] ERROR %s exhausted retries — file: %s, error: %s, consecutive failures: %d",
    service,
    file,
    errMsg,
    s.consecutiveFailures,
  );

  // Dedup: send at most one Telegram alert per service per hour
  const now = Date.now();
  const shouldAlert = s.lastAlertAt === null || now - s.lastAlertAt >= ALERT_DEDUP_MS;
  if (shouldAlert) {
    s.lastAlertAt = now;
    sendUploadAlert(service, file, errMsg).catch((alertErr: unknown) => {
      const msg = alertErr instanceof Error ? alertErr.message : String(alertErr);
      console.error("[upload-tracker] Failed to send Telegram alert:", msg);
    });
  } else {
    const secUntilNext = Math.ceil((ALERT_DEDUP_MS - (now - (s.lastAlertAt ?? 0))) / 1000);
    console.log(
      "[upload-tracker] Alert for %s suppressed (dedup — next allowed in %ds)",
      service,
      secUntilNext,
    );
  }
}

/**
 * Returns upload health data merged into the /api/health response.
 * Each service produces one entry; missing entries mean the service hasn't
 * attempted an upload since restart.
 */
export function getUploadHealthStatus(): Array<{
  name: string;
  ok: boolean;
  detail?: string;
  checkedAt: number;
}> {
  const services: UploadServiceName[] = ["archive-uploader", "journal-uploader", "conversation-backup"];
  return services.map((service) => {
    const s = state.get(service);
    if (!s) {
      return {
        name: `upload:${service}`,
        ok: true, // not yet attempted — not a failure
        detail: "No upload attempted since last restart",
        checkedAt: 0,
      };
    }

    const failing = s.lastFailureAt !== null && (s.lastSuccessAt === null || s.lastFailureAt > s.lastSuccessAt);
    return {
      name: `upload:${service}`,
      ok: !failing,
      detail: failing
        ? `Last failure: ${s.lastFailureMsg ?? "unknown"} (${s.consecutiveFailures} consecutive)`
        : s.lastSuccessAt
        ? `Last success: ${new Date(s.lastSuccessAt).toISOString()}`
        : undefined,
      checkedAt: s.lastFailureAt ?? s.lastSuccessAt ?? 0,
    };
  });
}

// --- Telegram alert (uses fetch directly to avoid circular deps) ---

async function sendUploadAlert(service: UploadServiceName, file: string, errMsg: string): Promise<void> {
  const token = config.telegram?.botToken;
  const chatId = config.telegram?.allowedUserId;
  if (!token || !chatId) return;

  const text =
    `Upload failure: ${service}\n` +
    `File: ${file}\n` +
    `Error: ${errMsg}\n` +
    `(Alerts suppressed for 1 hour per service)`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
