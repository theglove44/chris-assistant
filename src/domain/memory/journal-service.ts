import { createHash } from "crypto";
import * as fs from "fs";
import { appDataPath } from "../../infra/storage/paths.js";
import { writeMemoryFile } from "./repository.js";
import { withRetry } from "./retry.js";
import { recordUploadSuccess, recordUploadFailure } from "./upload-tracker.js";

const JOURNAL_DIR = appDataPath("journal");
const UPLOAD_INTERVAL_MS = 6 * 60 * 60 * 1000;

let uploadTimer: ReturnType<typeof setInterval> | null = null;
const uploadedHashes = new Map<string, string>();

export function localJournalPath(date: string): string {
  return appDataPath("journal", `${date}.md`);
}

export function journalRepoPath(date: string): string {
  return `journal/${date}.md`;
}

export function addJournalEntry(entry: string, date: string): void {
  try {
    fs.mkdirSync(JOURNAL_DIR, { recursive: true });
    const filePath = localJournalPath(date);
    const time = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    let prefix = "";
    if (!fs.existsSync(filePath)) {
      prefix = `# Journal — ${date}\n\n`;
    }

    fs.appendFileSync(filePath, `${prefix}**${time}** — ${entry}\n\n`);
  } catch (err: any) {
    console.error("[journal] Failed to write entry:", err.message);
  }
}

export function readLocalJournal(date: string): string {
  try {
    return fs.readFileSync(localJournalPath(date), "utf-8");
  } catch {
    return "";
  }
}

export function listLocalJournalDates(): string[] {
  try {
    return fs.readdirSync(JOURNAL_DIR).filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", "")).sort();
  } catch {
    return [];
  }
}

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
    const filePath = appDataPath("journal", file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err: any) {
      console.error("[journal] Failed to read %s:", file, err.message);
      continue;
    }

    const hash = hashContent(content);
    if (uploadedHashes.get(file) === hash) continue;

    const date = file.replace(".md", "");
    const repoPath = journalRepoPath(date);
    try {
      await withRetry(
        () => writeMemoryFile(repoPath, content, `chore: journal ${date}`),
        { label: repoPath },
      );
      uploadedHashes.set(file, hash);
      recordUploadSuccess("journal-uploader", repoPath);
      console.log("[journal] Uploaded %s to GitHub", file);
    } catch (err: unknown) {
      recordUploadFailure("journal-uploader", repoPath, err);
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
