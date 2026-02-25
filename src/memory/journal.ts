/**
 * Daily memory journal.
 *
 * The bot writes structured notes throughout the day via the journal_entry tool.
 * Entries are appended to ~/.chris-assistant/journal/YYYY-MM-DD.md locally,
 * and uploaded to the GitHub memory repo periodically.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeMemoryFile } from "./github.js";

const JOURNAL_DIR = path.join(os.homedir(), ".chris-assistant", "journal");
const UPLOAD_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// --- Local journal operations ---

export function localJournalPath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.md`);
}

export function journalRepoPath(date: string): string {
  return `journal/${date}.md`;
}

/** Append a timestamped entry to today's local journal. Sync, never throws. */
export function addJournalEntry(entry: string, date: string): void {
  try {
    fs.mkdirSync(JOURNAL_DIR, { recursive: true });
    const filePath = localJournalPath(date);
    const time = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    // If file doesn't exist, add a header
    let prefix = "";
    if (!fs.existsSync(filePath)) {
      prefix = `# Journal — ${date}\n\n`;
    }

    fs.appendFileSync(filePath, `${prefix}**${time}** — ${entry}\n\n`);
  } catch (err: any) {
    console.error("[journal] Failed to write entry:", err.message);
  }
}

/** Read a local journal file. Returns empty string if not found. */
export function readLocalJournal(date: string): string {
  try {
    return fs.readFileSync(localJournalPath(date), "utf-8");
  } catch {
    return "";
  }
}

/** List available local journal dates. */
export function listLocalJournalDates(): string[] {
  try {
    return fs
      .readdirSync(JOURNAL_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""))
      .sort();
  } catch {
    return [];
  }
}

// --- Periodic GitHub upload ---

let uploadTimer: ReturnType<typeof setInterval> | null = null;
const uploadedHashes = new Map<string, string>();

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function uploadJournals(): Promise<void> {
  let files: string[];
  try {
    files = fs.readdirSync(JOURNAL_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = path.join(JOURNAL_DIR, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const hash = hashContent(content);
      if (uploadedHashes.get(file) === hash) continue;

      const date = file.replace(".md", "");
      await writeMemoryFile(journalRepoPath(date), content, `chore: journal ${date}`);
      uploadedHashes.set(file, hash);
      console.log("[journal] Uploaded %s to GitHub", file);
    } catch (err: any) {
      console.error("[journal] Failed to upload %s:", file, err.message);
    }
  }
}

export function startJournalUploader(): void {
  if (uploadTimer !== null) {
    console.warn("[journal] Uploader already running");
    return;
  }
  console.log("[journal] Starting journal uploader (every 6 hours)");

  uploadJournals().catch((err: any) => {
    console.error("[journal] Initial upload error:", err.message);
  });

  uploadTimer = setInterval(() => {
    uploadJournals().catch((err: any) => {
      console.error("[journal] Scheduled upload error:", err.message);
    });
  }, UPLOAD_INTERVAL_MS);
  uploadTimer.unref();
}

export function stopJournalUploader(): void {
  if (uploadTimer !== null) {
    clearInterval(uploadTimer);
    uploadTimer = null;
    console.log("[journal] Journal uploader stopped");
  }
}
