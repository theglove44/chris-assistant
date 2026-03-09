import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SymphonySnapshot } from "./types.js";

export const SYMPHONY_HOME = path.join(os.homedir(), ".chris-assistant", "symphony");
export const SYMPHONY_LOGS_DIR = path.join(SYMPHONY_HOME, "logs");
export const SYMPHONY_STATUS_DIR = path.join(SYMPHONY_HOME, "status");
export const SYMPHONY_STATUS_FILE = path.join(SYMPHONY_STATUS_DIR, "runtime.json");

export function ensureSymphonyDirs(): void {
  for (const dir of [SYMPHONY_HOME, SYMPHONY_LOGS_DIR, SYMPHONY_STATUS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function sanitizeIssueKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function issueLogPath(identifier: string): string {
  ensureSymphonyDirs();
  return path.join(SYMPHONY_LOGS_DIR, `${sanitizeIssueKey(identifier)}.log`);
}

export function appendIssueLog(identifier: string, line: string): void {
  ensureSymphonyDirs();
  fs.appendFileSync(issueLogPath(identifier), `${new Date().toISOString()} ${line}\n`, "utf-8");
}

export function readIssueLog(identifier: string, lineCount = 200): string[] {
  try {
    const lines = fs.readFileSync(issueLogPath(identifier), "utf-8").trim().split("\n");
    return lines.filter(Boolean).slice(-lineCount);
  } catch {
    return [];
  }
}

export function writeSnapshot(snapshot: SymphonySnapshot): void {
  ensureSymphonyDirs();
  fs.writeFileSync(SYMPHONY_STATUS_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
}

export function readSnapshot(): SymphonySnapshot | null {
  try {
    return JSON.parse(fs.readFileSync(SYMPHONY_STATUS_FILE, "utf-8")) as SymphonySnapshot;
  } catch {
    return null;
  }
}
