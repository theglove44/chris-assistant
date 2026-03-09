import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { writeMemoryFile } from "../../memory/github.js";
import { appDataPath } from "../../infra/storage/paths.js";
import type { ArchiveEntry, ConversationMeta } from "./types.js";

const ARCHIVE_DIR = appDataPath("archive");
const UPLOAD_INTERVAL_MS = 30 * 60 * 1000;
const uploadedHashes = new Map<string, string>();
let uploadTimer: ReturnType<typeof setInterval> | null = null;

export function datestamp(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function localArchivePath(date: string): string {
  return path.join(ARCHIVE_DIR, `${date}.jsonl`);
}

export function archiveMessage(
  chatId: number,
  role: "user" | "assistant",
  content: string,
  ts: number,
  meta?: ConversationMeta,
): void {
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    const entry: ArchiveEntry = { ts, chatId, role, content, ...meta };
    fs.appendFileSync(localArchivePath(datestamp(ts)), JSON.stringify(entry) + "\n");
  } catch (err: any) {
    console.error("[archive] Failed to write:", err.message);
  }
}

export function readLocalArchive(date: string): ArchiveEntry[] {
  const filePath = localArchivePath(date);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as ArchiveEntry);
  } catch {
    return [];
  }
}

export function listLocalArchiveDates(): string[] {
  try {
    return fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(".jsonl", "")).sort();
  } catch {
    return [];
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function redactArchiveEntries(chatId: number, date: string): number {
  const filePath = localArchivePath(date);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const kept: string[] = [];
    let removed = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ArchiveEntry;
        if (entry.chatId === chatId) removed++;
        else kept.push(line);
      } catch {
        kept.push(line);
      }
    }

    if (removed > 0) {
      fs.writeFileSync(filePath, kept.length > 0 ? kept.join("\n") + "\n" : "");
    }

    return removed;
  } catch {
    return 0;
  }
}

export async function uploadArchives(): Promise<void> {
  let files: string[];
  try {
    files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = path.join(ARCHIVE_DIR, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const hash = hashContent(content);
      if (uploadedHashes.get(file) === hash) continue;

      await writeMemoryFile(`archive/${file}`, content, `chore: archive ${file}`);
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

  console.log("[archive] Starting archive uploader (every 30 minutes)");
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
