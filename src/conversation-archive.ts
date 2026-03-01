/**
 * Daily conversation archiver.
 *
 * Every message processed by addMessage() is also appended as a JSONL line
 * to ~/.chris-assistant/archive/YYYY-MM-DD.jsonl. This gives the bot a
 * complete, never-truncated record of all conversations.
 *
 * A periodic uploader (every 6 hours, like conversation-backup.ts) pushes
 * changed archive files to the GitHub memory repo for durability.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeMemoryFile } from "./memory/github.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ARCHIVE_DIR = path.join(os.homedir(), ".chris-assistant", "archive");
const UPLOAD_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ---------------------------------------------------------------------------
// Local archiving (called from addMessage — must be fast & never throw)
// ---------------------------------------------------------------------------

export interface ArchiveEntry {
  ts: number;
  chatId: number;
  role: "user" | "assistant";
  content: string;
  source?: "telegram" | "discord";
  channelName?: string;
}

/** YYYY-MM-DD for a timestamp (or now). */
export function datestamp(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Absolute path to a local archive file for a given date. */
export function localArchivePath(date: string): string {
  return path.join(ARCHIVE_DIR, `${date}.jsonl`);
}

/**
 * Append one message to today's local JSONL archive.
 * Synchronous appendFileSync — microseconds, fire-and-forget.
 */
export function archiveMessage(
  chatId: number,
  role: "user" | "assistant",
  content: string,
  ts: number,
  meta?: { source?: "telegram" | "discord"; channelName?: string },
): void {
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    const entry: ArchiveEntry = { ts, chatId, role, content, ...meta };
    const line = JSON.stringify(entry);
    fs.appendFileSync(localArchivePath(datestamp(ts)), line + "\n");
  } catch (err: any) {
    // Never let archiving crash the bot
    console.error("[archive] Failed to write:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers for reading local archives (used by recall tool + summarizer)
// ---------------------------------------------------------------------------

/** Parse a local JSONL archive into an array of entries. */
export function readLocalArchive(date: string): ArchiveEntry[] {
  const filePath = localArchivePath(date);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ArchiveEntry);
  } catch {
    return [];
  }
}

/** List all available archive dates (from local files). */
export function listLocalArchiveDates(): string[] {
  try {
    return fs
      .readdirSync(ARCHIVE_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""))
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Periodic GitHub uploader
// ---------------------------------------------------------------------------

let uploadTimer: ReturnType<typeof setInterval> | null = null;

/** SHA-256 hash of file content — used to skip unchanged uploads. */
const uploadedHashes = new Map<string, string>();

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function uploadArchives(): Promise<void> {
  let files: string[];
  try {
    files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return; // No archive dir yet
  }

  for (const file of files) {
    const filePath = path.join(ARCHIVE_DIR, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const hash = hashContent(content);

      if (uploadedHashes.get(file) === hash) continue; // unchanged

      const repoPath = `archive/${file}`;
      await writeMemoryFile(repoPath, content, `chore: archive ${file}`);
      uploadedHashes.set(file, hash);
      console.log("[archive] Uploaded %s to GitHub", file);
    } catch (err: any) {
      console.error("[archive] Failed to upload %s:", file, err.message);
    }
  }
}

export function startArchiveUploader(): void {
  if (uploadTimer !== null) {
    console.warn("[archive] Uploader already running, ignoring duplicate start");
    return;
  }

  console.log("[archive] Starting archive uploader (every 6 hours)");

  // Immediate upload on startup
  uploadArchives().catch((err: any) => {
    console.error("[archive] Unexpected error during initial upload:", err.message);
  });

  uploadTimer = setInterval(() => {
    uploadArchives().catch((err: any) => {
      console.error("[archive] Unexpected error during scheduled upload:", err.message);
    });
  }, UPLOAD_INTERVAL_MS);

  uploadTimer.unref();
}

export function stopArchiveUploader(): void {
  if (uploadTimer !== null) {
    clearInterval(uploadTimer);
    uploadTimer = null;
    console.log("[archive] Archive uploader stopped");
  }
}
