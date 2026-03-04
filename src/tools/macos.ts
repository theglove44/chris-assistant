import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { z } from "zod";
import { registerTool } from "./registry.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Paths — absolute, pm2 doesn't inherit shell PATH
// ---------------------------------------------------------------------------

const HOME = process.env.HOME ?? "/Users/christaylor";
const CALENDAR_APP = join(HOME, ".chris-assistant/ChrisCalendar.app");
const OPEN_BIN = "/usr/bin/open";
const OSASCRIPT_BIN = "/usr/bin/osascript";
const IS_DARWIN = process.platform === "darwin";

const MAX_OUTPUT = 50_000;
const CALENDAR_TIMEOUT = 10_000;  // Swift EventKit via 'open' is fast
const MAIL_TIMEOUT = 120_000;     // AppleScript Mail can be slow

const DEFAULT_CALENDAR = "Family";
const DEFAULT_MAIL_ACCOUNT = "iCloud";
const CALENDAR_SETUP_CMD = "npm run setup:calendar-helper";

function truncate(s: string): string {
  if (s.length > MAX_OUTPUT) {
    return s.slice(0, MAX_OUTPUT) + "\n\n[... truncated ...]";
  }
  return s;
}

// ---------------------------------------------------------------------------
// Calendar: Swift EventKit binary (fast, <1s)
// ---------------------------------------------------------------------------

interface CalendarResult {
  ok: boolean;
  data?: any;
  error?: string;
}

async function runCalendar(args: string[]): Promise<string> {
  if (!existsSync(CALENDAR_APP)) {
    return (
      `Error: Calendar helper not found at ${CALENDAR_APP}. ` +
      `Install it with: ${CALENDAR_SETUP_CMD}`
    );
  }

  // Launch via 'open -n -W' so macOS treats it as its own app for TCC permissions.
  // -n: new instance (avoids "already running" rejection on sequential calls)
  // -W: wait for exit (no polling needed, output file is ready when open returns)
  // Capture stdout via temp file since 'open' doesn't pipe output.
  const outFile = join(tmpdir(), `chris-cal-${randomBytes(4).toString("hex")}.json`);
  try {
    await execFileAsync(
      OPEN_BIN,
      ["-n", "-W", "--stdout", outFile, "--stderr", outFile, CALENDAR_APP, "--args", ...args],
      { timeout: CALENDAR_TIMEOUT },
    );

    const raw = readFileSync(outFile, "utf-8").trim();
    if (!raw) return "Error: Calendar helper produced no output";
    const result: CalendarResult = JSON.parse(raw);
    if (!result.ok) return `Error: ${result.error}`;
    return typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data, null, 2);
  } catch (err: any) {
    return `Error: ${err.message}`;
  } finally {
    try { unlinkSync(outFile); } catch { /* ignore */ }
  }
}

function formatEvents(json: string): string {
  try {
    const events = JSON.parse(json);
    if (!Array.isArray(events) || events.length === 0) return "No events found.";
    return events.map((e: any) => {
      const start = new Date(e.start);
      const end = new Date(e.end);
      const timeFmt = (d: Date) =>
        d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const dateFmt = (d: Date) =>
        d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

      let line = e.allDay
        ? `${dateFmt(start)} (all day) — ${e.title}`
        : `${dateFmt(start)} ${timeFmt(start)}–${timeFmt(end)} — ${e.title}`;
      if (e.location) line += ` 📍 ${e.location}`;
      return line;
    }).join("\n");
  } catch {
    return json; // Return raw if parse fails
  }
}

// ---------------------------------------------------------------------------
// Mail: AppleScript (no framework API alternative)
// ---------------------------------------------------------------------------

function escapeAS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function runAppleScript(script: string): Promise<string> {
  const tmpFile = join(tmpdir(), `chris-as-${randomBytes(4).toString("hex")}.applescript`);
  try {
    writeFileSync(tmpFile, script, "utf-8");
    const { stdout, stderr } = await execFileAsync(
      OSASCRIPT_BIN,
      [tmpFile],
      { timeout: MAIL_TIMEOUT, maxBuffer: 2 * 1024 * 1024 },
    );
    return truncate(((stdout ?? "") + (stderr ?? "")).trim());
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

async function getMailSummary(account: string): Promise<string> {
  const script = `
tell application "Mail"
  set inb to mailbox "INBOX" of account "${escapeAS(account)}"
  set mc to count of messages of inb
  set unrd to count of (messages of inb whose read status is false)
  return "${escapeAS(account)}: " & mc & " total, " & unrd & " unread"
end tell`;
  return runAppleScript(script);
}

async function getInboxMessages(
  account: string,
  count: number,
  unreadOnly: boolean,
): Promise<string> {
  const limit = Math.min(count, 20);

  if (unreadOnly) {
    const script = `
tell application "Mail"
  set output to ""
  set allMsgs to (messages of mailbox "INBOX" of account "${escapeAS(account)}" whose read status is false)
  set msgCount to count of allMsgs
  if msgCount > ${limit} then set msgCount to ${limit}
  repeat with i from 1 to msgCount
    set m to item i of allMsgs
    set subj to subject of m
    set sndr to sender of m
    set dt to date received of m as string
    set output to output & "[UNREAD] " & subj & " | " & sndr & " | " & dt & "
"
  end repeat
  if msgCount = 0 then return "No unread messages."
  return output
end tell`;
    return runAppleScript(script);
  }

  const script = `
tell application "Mail"
  set output to ""
  set allMsgs to messages of mailbox "INBOX" of account "${escapeAS(account)}"
  set msgCount to count of allMsgs
  if msgCount > ${limit} then set msgCount to ${limit}
  repeat with i from 1 to msgCount
    set m to item i of allMsgs
    set subj to subject of m
    set sndr to sender of m
    set dt to date received of m as string
    set isRead to read status of m
    set tag to ""
    if isRead is false then set tag to "[UNREAD] "
    set output to output & tag & subj & " | " & sndr & " | " & dt & "
"
  end repeat
  return output
end tell`;
  return runAppleScript(script);
}

async function searchMail(
  query: string,
  account: string,
  limit = 10,
): Promise<string> {
  const cap = Math.min(limit, 20);

  const script = `
tell application "Mail"
  set output to ""
  set matchCount to 0
  set allMsgs to messages of mailbox "INBOX" of account "${escapeAS(account)}"
  repeat with m in allMsgs
    if matchCount is greater than or equal to ${cap} then exit repeat
    set subj to subject of m
    set sndr to sender of m
    if subj contains "${escapeAS(query)}" or sndr contains "${escapeAS(query)}" then
      set dt to date received of m as string
      set isRead to read status of m
      set tag to ""
      if isRead is false then set tag to "[UNREAD] "
      set output to output & tag & subj & " | " & sndr & " | " & dt & "
"
      set matchCount to matchCount + 1
    end if
  end repeat
  if matchCount = 0 then return "No messages found matching: ${escapeAS(query)}"
  return output
end tell`;

  return runAppleScript(script);
}

// ---------------------------------------------------------------------------
// Tool registration: Calendar (Swift binary)
// ---------------------------------------------------------------------------

if (!IS_DARWIN) {
  console.log("[tools] skipping macos_calendar and macos_mail registration (platform != darwin)");
} else {
registerTool({
  name: "macos_calendar",
  category: "always",
  description:
    "Interact with macOS Calendar via fast native EventKit. " +
    "Actions: list_calendars, get_events, add_event, delete_event. " +
    "Default calendar is 'Family'. Dates use YYYY-MM-DD or YYYY-MM-DD HH:MM format. " +
    "Delete by UID (preferred) or by title + date (scoped to single day, first match only).",
  zodSchema: {
    action: z.enum(["list_calendars", "get_events", "add_event", "delete_event"]),
    calendar: z.string().optional(),
    title: z.string().optional(),
    uid: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
    all_day: z.boolean().optional(),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["list_calendars", "get_events", "add_event", "delete_event"],
        description:
          "list_calendars: show all calendar names. " +
          "get_events: view events (requires start_date; end_date defaults to next day). " +
          "add_event: create event (requires title, start_date; end_date defaults to +1hr). " +
          "delete_event: remove event by uid (preferred) or by title + start_date (scoped to single day, first match only).",
      },
      calendar: {
        type: "string",
        description: `Calendar name. Defaults to '${DEFAULT_CALENDAR}'.`,
      },
      title: {
        type: "string",
        description: "Event title. Required for add_event. Optional for delete_event when uid is provided.",
      },
      uid: {
        type: "string",
        description: "Stable event UID from get_events output. Preferred for delete_event.",
      },
      start_date: {
        type: "string",
        description: "Start date: YYYY-MM-DD or YYYY-MM-DD HH:MM",
      },
      end_date: {
        type: "string",
        description: "End date: YYYY-MM-DD or YYYY-MM-DD HH:MM",
      },
      location: { type: "string", description: "Event location (for add_event)" },
      notes: { type: "string", description: "Event notes (for add_event)" },
      all_day: { type: "boolean", description: "All-day event (for add_event)" },
    },
  },
  execute: async (args: any): Promise<string> => {
    const {
      action,
      title,
      uid,
      start_date,
      end_date,
      location,
      notes,
      all_day,
    } = args;
    const cal = args.calendar || DEFAULT_CALENDAR;

    try {
      switch (action) {
        case "list_calendars":
          return await runCalendar(["list-calendars"]);

        case "get_events": {
          if (!start_date) return "Error: start_date is required for get_events";
          // Default end to start+1day. If end_date equals start_date (date-only),
          // also bump to next day — a zero-width range misses same-day events.
          let end = end_date;
          if (!end || end === start_date) {
            const d = new Date(start_date);
            d.setDate(d.getDate() + 1);
            end = d.toISOString().split("T")[0];
          }
          const raw = await runCalendar(["get-events", cal, start_date, end]);
          // Try to format nicely, fall back to raw
          if (raw.startsWith("Error:")) return raw;
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return formatEvents(raw);
          } catch { /* not JSON, return as-is */ }
          return raw;
        }

        case "add_event": {
          if (!title) return "Error: title is required for add_event";
          if (!start_date) return "Error: start_date is required for add_event";
          const end = end_date || (() => {
            const d = new Date(start_date.replace(" ", "T"));
            d.setHours(d.getHours() + 1);
            const pad = (n: number) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
          })();
          const cmdArgs = ["add-event", cal, title, start_date, end];
          if (location) cmdArgs.push("--location", location);
          if (notes) cmdArgs.push("--notes", notes);
          if (all_day) cmdArgs.push("--allday");
          return await runCalendar(cmdArgs);
        }

        case "delete_event": {
          if (!title && !uid) {
            return "Error: delete_event requires either 'uid' (preferred) or 'title' + 'start_date'";
          }
          const cmdArgs = ["delete-event", cal];
          if (uid) {
            cmdArgs.push("--uid", uid);
          } else {
            if (!start_date) return "Error: start_date is required when deleting by title (scopes to a single day)";
            cmdArgs.push(title!, "--date", start_date);
          }
          return await runCalendar(cmdArgs);
        }

        default:
          return `Unknown action: ${action}`;
      }
    } catch (err: any) {
      console.error("[macos_calendar] Error:", err.message);
      return `Error: ${err.message}`;
    }
  },
});

// ---------------------------------------------------------------------------
// Tool registration: Mail (AppleScript)
// ---------------------------------------------------------------------------

registerTool({
  name: "macos_mail",
  category: "always",
  description:
    `Interact with macOS Mail app (default account: ${DEFAULT_MAIL_ACCOUNT}). ` +
    "Actions: summary (unread count), inbox (recent messages), search (find by subject/sender).",
  zodSchema: {
    action: z.enum(["summary", "inbox", "search"]),
    count: z.number().optional(),
    unread_only: z.boolean().optional(),
    query: z.string().optional(),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["summary", "inbox", "search"],
        description:
          "summary: get total/unread message counts. " +
          "inbox: read recent messages (optional: count, unread_only). " +
          "search: find messages by subject or sender (requires query).",
      },
      count: {
        type: "number",
        description: "Number of messages to return (default 5, max 20).",
      },
      unread_only: {
        type: "boolean",
        description: "If true, only return unread messages. Default false.",
      },
      query: {
        type: "string",
        description: "Search term — matches against subject and sender.",
      },
    },
  },
  execute: async (args: any): Promise<string> => {
    const { action, count, unread_only, query } = args;

    try {
      switch (action) {
        case "summary":
          return await getMailSummary(DEFAULT_MAIL_ACCOUNT);

        case "inbox":
          return await getInboxMessages(DEFAULT_MAIL_ACCOUNT, count ?? 5, unread_only ?? false);

        case "search": {
          if (!query) return "Error: query is required for search action";
          return await searchMail(query, DEFAULT_MAIL_ACCOUNT, count ?? 10);
        }

        default:
          return `Unknown action: ${action}. Use summary, inbox, or search.`;
      }
    } catch (err: any) {
      console.error("[macos_mail] Error:", err.message);
      return `Error: ${err.message}`;
    }
  },
});

console.log("[tools] macos_calendar registered");
console.log("[tools] macos_mail registered");
}
