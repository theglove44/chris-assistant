/**
 * Periodic backup of local conversation history to the GitHub memory repo.
 * Runs every 6 hours. Only writes when the content hash has changed since
 * the last successful backup.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeMemoryFile } from "./memory/github.js";

// How often to run the backup check (milliseconds)
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Local source file — matches the path used in conversation.ts
const CONVERSATIONS_FILE = path.join(
  os.homedir(),
  ".chris-assistant",
  "conversations.json",
);

// Destination path inside the memory repo
const BACKUP_REPO_PATH = "backups/conversations.json";

// Module-level state — no persistence needed, first run always backs up
let lastBackedUpHash = "";
let backupTimer: ReturnType<typeof setInterval> | null = null;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function runBackup(): Promise<void> {
  let raw: string;

  try {
    raw = await fs.promises.readFile(CONVERSATIONS_FILE, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // No conversations file yet — nothing to back up
      console.log("[backup] conversations.json not found, skipping");
      return;
    }
    console.error("[backup] Failed to read conversations.json:", err.message);
    return;
  }

  const currentHash = hashContent(raw);

  if (currentHash === lastBackedUpHash) {
    console.log("[backup] No changes since last backup, skipping");
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    await writeMemoryFile(
      BACKUP_REPO_PATH,
      raw,
      `chore: backup conversations ${timestamp}`,
    );
    lastBackedUpHash = currentHash;
    console.log("[backup] Conversation history backed up to GitHub");
  } catch (err: any) {
    // Log and continue — a failed backup must never crash the bot
    console.error("[backup] Failed to write backup to GitHub:", err.message);
  }
}

/**
 * Start the periodic conversation backup timer.
 * Runs an immediate backup on startup, then every BACKUP_INTERVAL_MS.
 */
export function startConversationBackup(): void {
  if (backupTimer !== null) {
    console.warn("[backup] Backup already running, ignoring duplicate start");
    return;
  }

  console.log("[backup] Starting conversation backup (every 6 hours)");

  // Run immediately on startup so the first backup doesn't wait 6 hours
  runBackup().catch((err: any) => {
    console.error("[backup] Unexpected error during initial backup:", err.message);
  });

  backupTimer = setInterval(() => {
    runBackup().catch((err: any) => {
      console.error("[backup] Unexpected error during scheduled backup:", err.message);
    });
  }, BACKUP_INTERVAL_MS);

  // Prevent the interval from keeping the process alive if everything else exits
  backupTimer.unref();
}

/**
 * Stop the periodic conversation backup timer.
 */
export function stopConversationBackup(): void {
  if (backupTimer !== null) {
    clearInterval(backupTimer);
    backupTimer = null;
    console.log("[backup] Conversation backup stopped");
  }
}
