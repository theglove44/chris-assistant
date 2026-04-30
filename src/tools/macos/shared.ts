import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "fs";
import os, { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

export const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Paths — absolute, pm2 doesn't inherit shell PATH
// ---------------------------------------------------------------------------

export const HOME = process.env.HOME ?? os.homedir();
export const CALENDAR_APP = join(HOME, ".chris-assistant/ChrisCalendar.app");
export const REMINDERS_APP = join(HOME, ".chris-assistant/ChrisReminders.app");
export const OPEN_BIN = "/usr/bin/open";
export const OSASCRIPT_BIN = "/usr/bin/osascript";
export const IS_DARWIN = process.platform === "darwin";

export const MAX_OUTPUT = 50_000;
export const CALENDAR_TIMEOUT = 10_000;  // Swift EventKit via 'open' is fast
export const MAIL_TIMEOUT = 120_000;     // AppleScript Mail can be slow
export const REMINDERS_TIMEOUT = 15_000; // Swift EventKit via 'open' is fast
export const NOTES_TIMEOUT = 30_000;     // AppleScript Notes can be slow with large notes

export const DEFAULT_CALENDAR = "Family";
export const DEFAULT_MAIL_ACCOUNT = "iCloud";
export const DEFAULT_REMINDERS_LIST = "Reminders";
export const CALENDAR_SETUP_CMD = "npm run setup:calendar-helper";
export const REMINDERS_SETUP_CMD = "npm run setup:reminders-helper";

export function truncate(s: string): string {
  if (s.length > MAX_OUTPUT) {
    return s.slice(0, MAX_OUTPUT) + "\n\n[... truncated ...]";
  }
  return s;
}

/**
 * Escape a string for safe inclusion in an AppleScript double-quoted literal.
 * Must escape backslashes first, then double quotes.
 */
export function escapeAS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Run an AppleScript by writing to a temp file (osascript -e doesn't handle
 * multi-line scripts well) and invoking osascript with a configurable timeout.
 */
export async function runAppleScript(
  script: string,
  timeoutMs: number = MAIL_TIMEOUT,
  filePrefix: string = "chris-as",
): Promise<string> {
  const tmpFile = join(tmpdir(), `${filePrefix}-${randomBytes(4).toString("hex")}.applescript`);
  try {
    writeFileSync(tmpFile, script, "utf-8");
    const { stdout, stderr } = await execFileAsync(
      OSASCRIPT_BIN,
      [tmpFile],
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
    );
    return truncate(((stdout ?? "") + (stderr ?? "")).trim());
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

interface SwiftHelperResult {
  ok: boolean;
  data?: any;
  error?: string;
}

/**
 * Run a Swift EventKit helper app bundle via `open -n -W`.
 * Output is captured via temp file since `open` doesn't pipe stdout.
 *  -n: new instance (avoids "already running" rejection on sequential calls)
 *  -W: wait for exit (output file is ready when open returns)
 */
export async function runSwiftHelper(
  appPath: string,
  args: string[],
  options: {
    timeoutMs: number;
    filePrefix: string;
    notFoundMessage: string;
  },
): Promise<string> {
  if (!existsSync(appPath)) {
    return options.notFoundMessage;
  }

  const outFile = join(tmpdir(), `${options.filePrefix}-${randomBytes(4).toString("hex")}.json`);
  try {
    await execFileAsync(
      OPEN_BIN,
      ["-n", "-W", "--stdout", outFile, "--stderr", outFile, appPath, "--args", ...args],
      { timeout: options.timeoutMs },
    );

    const raw = readFileSync(outFile, "utf-8").trim();
    if (!raw) return `Error: ${options.filePrefix} helper produced no output`;
    const result: SwiftHelperResult = JSON.parse(raw);
    if (!result.ok) return `Error: ${result.error}`;
    return typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data, null, 2);
  } catch (err: any) {
    // Try to read output file for structured error
    try {
      const raw = readFileSync(outFile, "utf-8").trim();
      if (raw) {
        const result: SwiftHelperResult = JSON.parse(raw);
        if (!result.ok) return `Error: ${result.error}`;
      }
    } catch { /* ignore */ }
    return `Error: ${err.message}`;
  } finally {
    try { unlinkSync(outFile); } catch { /* ignore */ }
  }
}
