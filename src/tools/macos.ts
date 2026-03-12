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
const REMINDERS_APP = join(HOME, ".chris-assistant/ChrisReminders.app");
const OPEN_BIN = "/usr/bin/open";
const OSASCRIPT_BIN = "/usr/bin/osascript";
const IS_DARWIN = process.platform === "darwin";

const MAX_OUTPUT = 50_000;
const CALENDAR_TIMEOUT = 10_000;  // Swift EventKit via 'open' is fast
const MAIL_TIMEOUT = 120_000;     // AppleScript Mail can be slow
const REMINDERS_TIMEOUT = 15_000; // Swift EventKit via 'open' is fast

const DEFAULT_CALENDAR = "Family";
const DEFAULT_MAIL_ACCOUNT = "iCloud";
const DEFAULT_REMINDERS_LIST = "Reminders";
const CALENDAR_SETUP_CMD = "npm run setup:calendar-helper";
const REMINDERS_SETUP_CMD = "npm run setup:reminders-helper";

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
  mailbox = "INBOX",
): Promise<string> {
  const limit = Math.min(count, 20);
  const box = escapeAS(mailbox);

  if (unreadOnly) {
    const script = `
tell application "Mail"
  set output to ""
  set allMsgs to (messages of mailbox "${box}" of account "${escapeAS(account)}" whose read status is false)
  set msgCount to count of allMsgs
  if msgCount > ${limit} then set msgCount to ${limit}
  repeat with i from 1 to msgCount
    set m to item i of allMsgs
    set subj to subject of m
    set sndr to sender of m
    set dt to date received of m as string
    set mid to message id of m
    set output to output & "[UNREAD] " & subj & " | " & sndr & " | " & dt & " | id:" & mid & "
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
  set allMsgs to messages of mailbox "${box}" of account "${escapeAS(account)}"
  set msgCount to count of allMsgs
  if msgCount > ${limit} then set msgCount to ${limit}
  repeat with i from 1 to msgCount
    set m to item i of allMsgs
    set subj to subject of m
    set sndr to sender of m
    set dt to date received of m as string
    set isRead to read status of m
    set mid to message id of m
    set tag to ""
    if isRead is false then set tag to "[UNREAD] "
    set output to output & tag & subj & " | " & sndr & " | " & dt & " | id:" & mid & "
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
  mailbox = "INBOX",
): Promise<string> {
  const cap = Math.min(limit, 20);
  const box = escapeAS(mailbox);

  const script = `
tell application "Mail"
  set output to ""
  set matchCount to 0
  set allMsgs to messages of mailbox "${box}" of account "${escapeAS(account)}"
  repeat with m in allMsgs
    if matchCount is greater than or equal to ${cap} then exit repeat
    set subj to subject of m
    set sndr to sender of m
    if subj contains "${escapeAS(query)}" or sndr contains "${escapeAS(query)}" then
      set dt to date received of m as string
      set isRead to read status of m
      set mid to message id of m
      set tag to ""
      if isRead is false then set tag to "[UNREAD] "
      set output to output & tag & subj & " | " & sndr & " | " & dt & " | id:" & mid & "
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
// Mail: write/organise actions (AppleScript)
// ---------------------------------------------------------------------------

async function getMailMessage(
  messageId: string,
  account: string,
): Promise<string> {
  const script = `
tell application "Mail"
  set output to ""
  set boxNames to {"INBOX", "Sent Messages", "Drafts", "Archive", "Junk"}
  repeat with boxName in boxNames
    try
      set targetBox to mailbox boxName of account "${escapeAS(account)}"
      set allMsgs to (messages of targetBox whose message id is "${escapeAS(messageId)}")
      if (count of allMsgs) > 0 then
        set m to item 1 of allMsgs
        set subj to subject of m
        set sndr to sender of m
        set dt to date received of m as string
        set recips to ""
        repeat with r in to recipients of m
          if recips is not "" then set recips to recips & ", "
          set recips to recips & (address of r as string)
        end repeat
        set ccList to ""
        repeat with c in cc recipients of m
          if ccList is not "" then set ccList to ccList & ", "
          set ccList to ccList & (address of c as string)
        end repeat
        set bd to content of m
        set output to "Subject: " & subj & "
From: " & sndr & "
To: " & recips
        if ccList is not "" then set output to output & "
CC: " & ccList
        set output to output & "
Date: " & dt & "
Mailbox: " & boxName & "
" & "
" & bd
        return output
      end if
    end try
  end repeat
  return "Message not found with id: ${escapeAS(messageId)}"
end tell`;
  const result = await runAppleScript(script);
  // Truncate long message bodies
  if (result.length > 8000) {
    return result.slice(0, 8000) + "\n\n[... body truncated ...]";
  }
  return result;
}

async function replyToMail(
  messageId: string,
  body: string,
  replyAll: boolean,
  account: string,
): Promise<string> {
  const replyCmd = replyAll
    ? "set replyMsg to reply m with opening window and reply to all"
    : "set replyMsg to reply m with opening window";

  const script = `
tell application "Mail"
  set boxNames to {"INBOX", "Sent Messages", "Drafts", "Archive"}
  repeat with boxName in boxNames
    try
      set targetBox to mailbox boxName of account "${escapeAS(account)}"
      set allMsgs to (messages of targetBox whose message id is "${escapeAS(messageId)}")
      if (count of allMsgs) > 0 then
        set m to item 1 of allMsgs
        ${replyCmd}
        set content of replyMsg to "${escapeAS(body)}"
        send replyMsg
        return "Reply sent to: " & sender of m & " re: " & subject of m
      end if
    end try
  end repeat
  return "Message not found with id: ${escapeAS(messageId)}"
end tell`;
  return runAppleScript(script);
}

async function deleteMail(
  messageId: string,
  account: string,
): Promise<string> {
  const script = `
tell application "Mail"
  set boxNames to {"INBOX", "Sent Messages", "Drafts", "Archive", "Junk"}
  repeat with boxName in boxNames
    try
      set targetBox to mailbox boxName of account "${escapeAS(account)}"
      set allMsgs to (messages of targetBox whose message id is "${escapeAS(messageId)}")
      if (count of allMsgs) > 0 then
        set m to item 1 of allMsgs
        set subj to subject of m
        delete m
        return "Moved to Trash: " & subj
      end if
    end try
  end repeat
  return "Message not found with id: ${escapeAS(messageId)}"
end tell`;
  return runAppleScript(script);
}

async function moveMail(
  messageId: string,
  targetMailbox: string,
  account: string,
): Promise<string> {
  const script = `
tell application "Mail"
  set boxNames to {"INBOX", "Sent Messages", "Drafts", "Archive", "Junk"}
  repeat with boxName in boxNames
    try
      set srcBox to mailbox boxName of account "${escapeAS(account)}"
      set allMsgs to (messages of srcBox whose message id is "${escapeAS(messageId)}")
      if (count of allMsgs) > 0 then
        set m to item 1 of allMsgs
        set subj to subject of m
        set destBox to mailbox "${escapeAS(targetMailbox)}" of account "${escapeAS(account)}"
        move m to destBox
        return "Moved to ${escapeAS(targetMailbox)}: " & subj
      end if
    end try
  end repeat
  return "Message not found with id: ${escapeAS(messageId)}"
end tell`;
  return runAppleScript(script);
}

async function markMail(
  messageId: string,
  markAs: string,
  account: string,
): Promise<string> {
  let action: string;
  let label: string;
  switch (markAs) {
    case "read":
      action = "set read status of m to true";
      label = "Marked as read";
      break;
    case "unread":
      action = "set read status of m to false";
      label = "Marked as unread";
      break;
    case "flagged":
      action = "set flag index of m to 1";
      label = "Flagged";
      break;
    case "unflagged":
      action = "set flag index of m to -1";
      label = "Unflagged";
      break;
    default:
      return `Error: invalid mark_as value: ${markAs}. Use read, unread, flagged, or unflagged.`;
  }

  const script = `
tell application "Mail"
  set boxNames to {"INBOX", "Sent Messages", "Drafts", "Archive", "Junk"}
  repeat with boxName in boxNames
    try
      set targetBox to mailbox boxName of account "${escapeAS(account)}"
      set allMsgs to (messages of targetBox whose message id is "${escapeAS(messageId)}")
      if (count of allMsgs) > 0 then
        set m to item 1 of allMsgs
        set subj to subject of m
        ${action}
        return "${label}: " & subj
      end if
    end try
  end repeat
  return "Message not found with id: ${escapeAS(messageId)}"
end tell`;
  return runAppleScript(script);
}

async function listMailboxes(account: string): Promise<string> {
  const script = `
tell application "Mail"
  set output to ""
  set boxes to mailboxes of account "${escapeAS(account)}"
  repeat with b in boxes
    set output to output & name of b & "
"
  end repeat
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
    "Actions: list_calendars, get_events, add_event, update_event, delete_event, search_events. " +
    "Default calendar is 'Family'. Dates use YYYY-MM-DD or YYYY-MM-DD HH:MM format. " +
    "Update and delete by UID (preferred). Use search_events to find events by text across title/location/notes.",
  zodSchema: {
    action: z.enum(["list_calendars", "get_events", "add_event", "update_event", "delete_event", "search_events"]),
    calendar: z.string().optional(),
    title: z.string().optional(),
    uid: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
    all_day: z.boolean().optional(),
    query: z.string().optional(),
    clear_location: z.boolean().optional(),
    clear_notes: z.boolean().optional(),
    max_results: z.number().optional(),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["list_calendars", "get_events", "add_event", "update_event", "delete_event", "search_events"],
        description:
          "list_calendars: show all calendar names. " +
          "get_events: view events (requires start_date; end_date defaults to next day). " +
          "add_event: create event (requires title, start_date; end_date defaults to +1hr). " +
          "update_event: modify event by uid — change title, start/end time, location, notes, or all_day. " +
          "delete_event: remove event by uid (preferred) or by title + start_date. " +
          "search_events: find events by text query across title/location/notes (requires query).",
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
      all_day: { type: "boolean", description: "All-day event (for add_event, update_event). Set false to remove all-day status." },
      query: { type: "string", description: "Search text for search_events — matches title, location, and notes (case-insensitive)." },
      clear_location: { type: "boolean", description: "For update_event: set true to remove the location." },
      clear_notes: { type: "boolean", description: "For update_event: set true to remove the notes." },
      max_results: { type: "number", description: "Max events to return for search_events (default 20)." },
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
      query,
      clear_location,
      clear_notes,
      max_results,
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

        case "update_event": {
          if (!uid) return "Error: uid is required for update_event (use get_events or search_events to find UIDs)";
          const cmdArgs = ["update-event", cal, "--uid", uid];
          if (title) cmdArgs.push("--title", title);
          if (start_date) cmdArgs.push("--start", start_date);
          if (end_date) cmdArgs.push("--end", end_date);
          if (clear_location) {
            cmdArgs.push("--clear-location");
          } else if (location) {
            cmdArgs.push("--location", location);
          }
          if (clear_notes) {
            cmdArgs.push("--clear-notes");
          } else if (notes) {
            cmdArgs.push("--notes", notes);
          }
          if (all_day === true) cmdArgs.push("--allday");
          if (all_day === false) cmdArgs.push("--no-allday");
          const updateRaw = await runCalendar(cmdArgs);
          if (updateRaw.startsWith("Error:")) return updateRaw;
          // Format the returned updated event
          try {
            const parsed = JSON.parse(updateRaw);
            if (Array.isArray(parsed)) return "Event updated:\n" + formatEvents(updateRaw);
          } catch { /* not JSON, return as-is */ }
          return updateRaw;
        }

        case "search_events": {
          if (!query) return "Error: query is required for search_events";
          const cmdArgs = ["search-events", query];
          if (args.calendar) cmdArgs.push("--calendar", cal);
          if (start_date) cmdArgs.push("--from", start_date);
          if (end_date) cmdArgs.push("--to", end_date);
          if (max_results) cmdArgs.push("--max", String(max_results));
          const searchRaw = await runCalendar(cmdArgs);
          if (searchRaw.startsWith("Error:")) return searchRaw;
          try {
            const parsed = JSON.parse(searchRaw);
            if (Array.isArray(parsed) && parsed.length === 0) return "No events found matching: " + query;
            if (Array.isArray(parsed)) return formatEvents(searchRaw);
          } catch { /* not JSON, return as-is */ }
          return searchRaw;
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
    "Actions: summary, inbox, search, read, reply, delete, move, mark, list_mailboxes. " +
    "Inbox/search results include message IDs (id:...) for use with write actions. " +
    "Always confirm reply content with Chris before sending.",
  zodSchema: {
    action: z.enum(["summary", "inbox", "search", "read", "reply", "delete", "move", "mark", "list_mailboxes"]),
    count: z.number().optional(),
    unread_only: z.boolean().optional(),
    query: z.string().optional(),
    message_id: z.string().optional(),
    body: z.string().optional(),
    reply_all: z.boolean().optional(),
    mailbox: z.string().optional(),
    mark_as: z.string().optional(),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["summary", "inbox", "search", "read", "reply", "delete", "move", "mark", "list_mailboxes"],
        description:
          "summary: get total/unread message counts. " +
          "inbox: read recent messages (optional: count, unread_only, mailbox). " +
          "search: find messages by subject or sender (requires query). " +
          "read: get full message content (requires message_id). " +
          "reply: reply to a message (requires message_id, body). " +
          "delete: move message to trash (requires message_id). " +
          "move: move message to a mailbox (requires message_id, mailbox). " +
          "mark: mark as read/unread/flagged/unflagged (requires message_id, mark_as). " +
          "list_mailboxes: show available mailbox names.",
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
      message_id: {
        type: "string",
        description: "RFC Message-ID of the target message (from inbox/search output, the id:... field).",
      },
      body: {
        type: "string",
        description: "Reply body text. Required for reply action.",
      },
      reply_all: {
        type: "boolean",
        description: "If true, reply to all recipients. Default false.",
      },
      mailbox: {
        type: "string",
        description: "Mailbox name. For move: destination mailbox. For inbox/search: mailbox to query (default INBOX).",
      },
      mark_as: {
        type: "string",
        enum: ["read", "unread", "flagged", "unflagged"],
        description: "How to mark the message. Required for mark action.",
      },
    },
  },
  execute: async (args: any): Promise<string> => {
    const { action, count, unread_only, query, message_id, body, reply_all, mailbox, mark_as } = args;

    try {
      switch (action) {
        case "summary":
          return await getMailSummary(DEFAULT_MAIL_ACCOUNT);

        case "inbox":
          return await getInboxMessages(DEFAULT_MAIL_ACCOUNT, count ?? 5, unread_only ?? false, mailbox ?? "INBOX");

        case "search": {
          if (!query) return "Error: query is required for search action";
          return await searchMail(query, DEFAULT_MAIL_ACCOUNT, count ?? 10, mailbox ?? "INBOX");
        }

        case "read": {
          if (!message_id) return "Error: message_id is required for read action";
          return await getMailMessage(message_id, DEFAULT_MAIL_ACCOUNT);
        }

        case "reply": {
          if (!message_id) return "Error: message_id is required for reply action";
          if (!body) return "Error: body is required for reply action";
          return await replyToMail(message_id, body, reply_all ?? false, DEFAULT_MAIL_ACCOUNT);
        }

        case "delete": {
          if (!message_id) return "Error: message_id is required for delete action";
          return await deleteMail(message_id, DEFAULT_MAIL_ACCOUNT);
        }

        case "move": {
          if (!message_id) return "Error: message_id is required for move action";
          if (!mailbox) return "Error: mailbox is required for move action";
          return await moveMail(message_id, mailbox, DEFAULT_MAIL_ACCOUNT);
        }

        case "mark": {
          if (!message_id) return "Error: message_id is required for mark action";
          if (!mark_as) return "Error: mark_as is required for mark action";
          return await markMail(message_id, mark_as, DEFAULT_MAIL_ACCOUNT);
        }

        case "list_mailboxes":
          return await listMailboxes(DEFAULT_MAIL_ACCOUNT);

        default:
          return `Unknown action: ${action}.`;
      }
    } catch (err: any) {
      console.error("[macos_mail] Error:", err.message);
      return `Error: ${err.message}`;
    }
  },
});

// ---------------------------------------------------------------------------
// Reminders: Swift EventKit binary (fast, TCC-safe via .app bundle)
// ---------------------------------------------------------------------------

interface RemindersResult {
  ok: boolean;
  data?: any;
  error?: string;
}

async function runReminders(args: string[]): Promise<string> {
  if (!existsSync(REMINDERS_APP)) {
    return (
      `Error: Reminders helper not found at ${REMINDERS_APP}. ` +
      `Install it with: ${REMINDERS_SETUP_CMD}`
    );
  }

  const outFile = join(tmpdir(), `chris-rem-${randomBytes(4).toString("hex")}.json`);
  try {
    await execFileAsync(
      OPEN_BIN,
      ["-n", "-W", "--stdout", outFile, "--stderr", outFile, REMINDERS_APP, "--args", ...args],
      { timeout: REMINDERS_TIMEOUT },
    );

    const raw = readFileSync(outFile, "utf-8").trim();
    if (!raw) return "Error: Reminders helper produced no output";
    const result: RemindersResult = JSON.parse(raw);
    if (!result.ok) return `Error: ${result.error}`;
    return typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data, null, 2);
  } catch (err: any) {
    // Try to read output file for structured error
    try {
      const raw = readFileSync(outFile, "utf-8").trim();
      if (raw) {
        const result: RemindersResult = JSON.parse(raw);
        if (!result.ok) return `Error: ${result.error}`;
      }
    } catch { /* ignore */ }
    return `Error: ${err.message}`;
  } finally {
    try { unlinkSync(outFile); } catch { /* ignore */ }
  }
}

function formatReminders(json: string): string {
  try {
    const reminders = JSON.parse(json);
    if (!Array.isArray(reminders) || reminders.length === 0) return "No reminders found.";
    return reminders.map((r: any) => {
      let entry = r.completed ? "[DONE] " : "";
      entry += r.title;
      if (r.priority && r.priority !== "none") {
        const tag = r.priority === "high" ? " [!HIGH]" : r.priority === "medium" ? " [MEDIUM]" : " [LOW]";
        entry += tag;
      }
      if (r.list) entry += ` [${r.list}]`;
      if (r.dueDate) entry += ` | Due: ${r.dueDate}`;
      if (r.notes) entry += ` | Notes: ${r.notes}`;
      return entry;
    }).join("\n");
  } catch {
    return json;
  }
}

// ---------------------------------------------------------------------------
// Tool registration: Reminders (Swift binary)
// ---------------------------------------------------------------------------

registerTool({
  name: "macos_reminders",
  category: "always",
  description:
    `Manage Apple Reminders. ` +
    "Actions: list_lists, get_reminders, create_reminder, update_reminder, complete_reminder, search_reminders. " +
    `Default list is '${DEFAULT_REMINDERS_LIST}'. ` +
    "Use to create, track, and complete tasks and to-dos for Chris.",
  zodSchema: {
    action: z.enum(["list_lists", "get_reminders", "create_reminder", "update_reminder", "complete_reminder", "search_reminders"]),
    list: z.string().optional(),
    title: z.string().optional(),
    new_title: z.string().optional(),
    due_date: z.string().optional(),
    due_time: z.string().optional(),
    priority: z.string().optional(),
    notes: z.string().optional(),
    query: z.string().optional(),
    include_completed: z.boolean().optional(),
    clear_due_date: z.boolean().optional(),
    count: z.number().optional(),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["list_lists", "get_reminders", "create_reminder", "update_reminder", "complete_reminder", "search_reminders"],
        description:
          "list_lists: show all reminder list names. " +
          "get_reminders: view reminders from a list (default: incomplete only). " +
          "create_reminder: create a new reminder (requires title). " +
          "update_reminder: modify an existing reminder by title (requires title). " +
          "complete_reminder: mark a reminder as done (requires title). " +
          "search_reminders: find reminders by text across names and notes (requires query).",
      },
      list: {
        type: "string",
        description: `Reminder list name. Defaults to '${DEFAULT_REMINDERS_LIST}'.`,
      },
      title: {
        type: "string",
        description: "Reminder title. Required for create, update, and complete.",
      },
      new_title: {
        type: "string",
        description: "New title for update_reminder.",
      },
      due_date: {
        type: "string",
        description: "Due date in natural format the system can parse, e.g. 'March 15, 2026' or '3/15/2026'.",
      },
      due_time: {
        type: "string",
        description: "Due time, e.g. '2:00 PM' or '14:00'. Combined with due_date.",
      },
      priority: {
        type: "string",
        enum: ["none", "low", "medium", "high"],
        description: "Priority level. Default none.",
      },
      notes: {
        type: "string",
        description: "Notes/body text for the reminder.",
      },
      query: {
        type: "string",
        description: "Search text for search_reminders — matches name and notes.",
      },
      include_completed: {
        type: "boolean",
        description: "Include completed reminders in results. Default false.",
      },
      clear_due_date: {
        type: "boolean",
        description: "For update_reminder: remove the due date.",
      },
      count: {
        type: "number",
        description: "Max reminders to return (default 20, max 50).",
      },
    },
  },
  execute: async (args: any): Promise<string> => {
    const {
      action,
      title,
      new_title,
      due_date,
      due_time,
      priority,
      notes,
      query,
      include_completed,
      clear_due_date,
      count,
    } = args;
    const listName = args.list || DEFAULT_REMINDERS_LIST;

    try {
      switch (action) {
        case "list_lists":
          return await runReminders(["list-lists"]);

        case "get_reminders": {
          const cmdArgs = ["get-reminders", listName];
          if (include_completed) cmdArgs.push("--include-completed");
          if (count) cmdArgs.push("--count", String(count));
          const raw = await runReminders(cmdArgs);
          if (raw.startsWith("Error:")) return raw;
          return formatReminders(raw);
        }

        case "create_reminder": {
          if (!title) return "Error: title is required for create_reminder";
          const cmdArgs = ["create-reminder", listName, title];
          if (due_date) cmdArgs.push("--due-date", due_date);
          if (due_time) cmdArgs.push("--due-time", due_time);
          if (priority) cmdArgs.push("--priority", priority);
          if (notes) cmdArgs.push("--notes", notes);
          return await runReminders(cmdArgs);
        }

        case "update_reminder": {
          if (!title) return "Error: title is required for update_reminder (used to find the reminder)";
          const cmdArgs = ["update-reminder", listName, title];
          if (new_title) cmdArgs.push("--new-title", new_title);
          if (due_date) cmdArgs.push("--due-date", due_date);
          if (due_time) cmdArgs.push("--due-time", due_time);
          if (priority) cmdArgs.push("--priority", priority);
          if (notes) cmdArgs.push("--notes", notes);
          if (clear_due_date) cmdArgs.push("--clear-due-date");
          return await runReminders(cmdArgs);
        }

        case "complete_reminder": {
          if (!title) return "Error: title is required for complete_reminder";
          return await runReminders(["complete-reminder", listName, title]);
        }

        case "search_reminders": {
          if (!query) return "Error: query is required for search_reminders";
          const cmdArgs = ["search-reminders", query];
          if (args.list) cmdArgs.push("--list", listName);
          if (include_completed) cmdArgs.push("--include-completed");
          if (count) cmdArgs.push("--count", String(count));
          const raw = await runReminders(cmdArgs);
          if (raw.startsWith("Error:")) return raw;
          return formatReminders(raw);
        }

        default:
          return `Unknown action: ${action}`;
      }
    } catch (err: any) {
      console.error("[macos_reminders] Error:", err.message);
      return `Error: ${err.message}`;
    }
  },
});

console.log("[tools] macos_calendar registered");
console.log("[tools] macos_mail registered");
console.log("[tools] macos_reminders registered");
}
