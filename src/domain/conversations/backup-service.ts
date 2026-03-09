import { createHash } from "crypto";
import * as fs from "fs";
import { writeMemoryFile } from "../../memory/github.js";
import { CONVERSATIONS_FILE } from "./store.js";

const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BACKUP_REPO_PATH = "backups/conversations.json";

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
    await writeMemoryFile(BACKUP_REPO_PATH, raw, `chore: backup conversations ${timestamp}`);
    lastBackedUpHash = currentHash;
    console.log("[backup] Conversation history backed up to GitHub");
  } catch (err: any) {
    console.error("[backup] Failed to write backup to GitHub:", err.message);
  }
}

export function startConversationBackup(): void {
  if (backupTimer !== null) {
    console.warn("[backup] Backup already running, ignoring duplicate start");
    return;
  }

  console.log("[backup] Starting conversation backup (every 6 hours)");
  runBackup().catch((err: any) => {
    console.error("[backup] Unexpected error during initial backup:", err.message);
  });

  backupTimer = setInterval(() => {
    runBackup().catch((err: any) => {
      console.error("[backup] Unexpected error during scheduled backup:", err.message);
    });
  }, BACKUP_INTERVAL_MS);

  backupTimer.unref();
}

export function stopConversationBackup(): void {
  if (backupTimer !== null) {
    clearInterval(backupTimer);
    backupTimer = null;
    console.log("[backup] Conversation backup stopped");
  }
}
