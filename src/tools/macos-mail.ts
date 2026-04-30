import { z } from "zod";
import { registerTool } from "./registry.js";
import {
  DEFAULT_MAIL_ACCOUNT,
  IS_DARWIN,
  MAIL_TIMEOUT,
  escapeAS,
  runAppleScript,
} from "./macos/shared.js";

// ---------------------------------------------------------------------------
// Mail: AppleScript (no framework API alternative)
// ---------------------------------------------------------------------------

const runMailScript = (script: string) => runAppleScript(script, MAIL_TIMEOUT, "chris-as");

/**
 * Build the AppleScript snippets that constrain a `repeat with m in allMsgs`
 * loop by `since`/`before` dates. Returns the variable-setup block (placed
 * before the loop) and the per-iteration check that flips a `skip` flag.
 * The check assumes the loop body has `set skip to false` immediately before.
 */
function buildDateFilter(
  since: string | undefined,
  before: string | undefined,
  checkIndent: string,
): { dateSetup: string; dateCheck: string } {
  if (!since && !before) return { dateSetup: "", dateCheck: "" };
  const parts: string[] = [];
  let dateSetup = "";
  if (since) {
    dateSetup += `  set sinceDate to date "${escapeAS(since)}"\n`;
    parts.push("dt >= sinceDate");
  }
  if (before) {
    dateSetup += `  set beforeDate to date "${escapeAS(before)}"\n`;
    parts.push("dt <= beforeDate");
  }
  const dateCheck = `
${checkIndent}set dt to date received of m
${checkIndent}if not (${parts.join(" and ")}) then
${checkIndent}  set skip to true
${checkIndent}end if`;
  return { dateSetup, dateCheck };
}

async function getMailSummary(account: string): Promise<string> {
  const script = `
tell application "Mail"
  set inb to mailbox "INBOX" of account "${escapeAS(account)}"
  set mc to count of messages of inb
  set unrd to count of (messages of inb whose read status is false)
  return "${escapeAS(account)}: " & mc & " total, " & unrd & " unread"
end tell`;
  return runMailScript(script);
}

async function getInboxMessages(
  account: string,
  count: number,
  unreadOnly: boolean,
  mailbox = "INBOX",
  offset = 0,
): Promise<string> {
  const limit = Math.min(count, 50);
  const start = offset + 1; // AppleScript is 1-indexed
  const box = escapeAS(mailbox);

  if (unreadOnly) {
    const script = `
tell application "Mail"
  set output to ""
  set allMsgs to (messages of mailbox "${box}" of account "${escapeAS(account)}" whose read status is false)
  set msgCount to count of allMsgs
  set startIdx to ${start}
  if startIdx > msgCount then return "No more unread messages (total: " & msgCount & ")."
  set endIdx to startIdx + ${limit} - 1
  if endIdx > msgCount then set endIdx to msgCount
  repeat with i from startIdx to endIdx
    set m to item i of allMsgs
    set subj to subject of m
    set sndr to sender of m
    set dt to date received of m as string
    set mid to message id of m
    set output to output & "[UNREAD] " & subj & " | " & sndr & " | " & dt & " | id:" & mid & "
"
  end repeat
  if output = "" then return "No unread messages."
  return "Showing " & startIdx & "-" & endIdx & " of " & msgCount & " unread:" & "
" & output
end tell`;
    return runMailScript(script);
  }

  const script = `
tell application "Mail"
  set output to ""
  set allMsgs to messages of mailbox "${box}" of account "${escapeAS(account)}"
  set msgCount to count of allMsgs
  set startIdx to ${start}
  if startIdx > msgCount then return "No more messages (total: " & msgCount & ")."
  set endIdx to startIdx + ${limit} - 1
  if endIdx > msgCount then set endIdx to msgCount
  repeat with i from startIdx to endIdx
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
  return "Showing " & startIdx & "-" & endIdx & " of " & msgCount & " total:" & "
" & output
end tell`;
  return runMailScript(script);
}

async function searchMail(
  query: string,
  account: string,
  limit = 10,
  mailbox = "INBOX",
  since?: string,
  before?: string,
  offset = 0,
): Promise<string> {
  const cap = Math.min(limit, 50);
  const box = escapeAS(mailbox);

  const { dateSetup, dateCheck } = buildDateFilter(since, before, "    ");

  const script = `
tell application "Mail"
  set output to ""
  set matchCount to 0
  set skipCount to 0
  set totalMatches to 0
${dateSetup}  set allMsgs to messages of mailbox "${box}" of account "${escapeAS(account)}"
  repeat with m in allMsgs
    if matchCount is greater than or equal to ${cap} then exit repeat
    set skip to false${dateCheck}
    if not skip then
      set subj to subject of m
      set sndr to sender of m
      if subj contains "${escapeAS(query)}" or sndr contains "${escapeAS(query)}" then
        set totalMatches to totalMatches + 1
        if skipCount < ${offset} then
          set skipCount to skipCount + 1
        else
          set dt to date received of m as string
          set isRead to read status of m
          set mid to message id of m
          set tag to ""
          if isRead is false then set tag to "[UNREAD] "
          set output to output & tag & subj & " | " & sndr & " | " & dt & " | id:" & mid & "
"
          set matchCount to matchCount + 1
        end if
      end if
    end if
  end repeat
  if matchCount = 0 then return "No messages found matching: ${escapeAS(query)}"
  return "Showing matches ${offset + 1}-" & (${offset} + matchCount) & " (skipped ${offset}):" & "
" & output
end tell`;

  return runMailScript(script);
}

async function getMailMessage(messageId: string, account: string): Promise<string> {
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
  const result = await runMailScript(script);
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
  return runMailScript(script);
}

async function deleteMail(messageId: string, account: string): Promise<string> {
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
  return runMailScript(script);
}

async function countMatchingMail(
  query: string,
  account: string,
  mailbox = "INBOX",
  since?: string,
  before?: string,
): Promise<string> {
  const box = escapeAS(mailbox);

  const { dateSetup, dateCheck } = buildDateFilter(since, before, "      ");

  const script = `
tell application "Mail"
  set matchCount to 0
${dateSetup}  set allMsgs to messages of mailbox "${box}" of account "${escapeAS(account)}"
  repeat with m in allMsgs
    set skip to false${dateCheck}
    if not skip then
      set subj to subject of m
      set sndr to sender of m
      if subj contains "${escapeAS(query)}" or sndr contains "${escapeAS(query)}" then
        set matchCount to matchCount + 1
      end if
    end if
  end repeat
  return matchCount & " messages matching \\"${escapeAS(query)}\\" in ${box}"
end tell`;

  return runMailScript(script);
}

async function bulkDeleteMail(
  query: string,
  account: string,
  mailbox = "INBOX",
  since?: string,
  before?: string,
): Promise<string> {
  const box = escapeAS(mailbox);

  const { dateSetup, dateCheck } = buildDateFilter(since, before, "        ");

  // AppleScript: collect all matching messages, then delete in reverse to avoid index shifting
  const script = `
tell application "Mail"
  set toDelete to {}
${dateSetup}  set allMsgs to messages of mailbox "${box}" of account "${escapeAS(account)}"
  repeat with m in allMsgs
    set skip to false${dateCheck}
    if not skip then
      set subj to subject of m
      set sndr to sender of m
      if subj contains "${escapeAS(query)}" or sndr contains "${escapeAS(query)}" then
        set end of toDelete to m
      end if
    end if
  end repeat
  set deleteCount to count of toDelete
  if deleteCount = 0 then return "No messages found matching \\"${escapeAS(query)}\\" in ${box}"
  repeat with i from deleteCount to 1 by -1
    delete item i of toDelete
  end repeat
  return deleteCount & " messages matching \\"${escapeAS(query)}\\" deleted from ${box}"
end tell`;

  return runMailScript(script);
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
  return runMailScript(script);
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
  return runMailScript(script);
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
  return runMailScript(script);
}

if (!IS_DARWIN) {
  console.log("[tools] skipping macos_mail registration (platform != darwin)");
} else {
  registerTool({
    name: "macos_mail",
    category: "always",
    frequencyLimit: 250,
    description:
      `Interact with macOS Mail app (default account: ${DEFAULT_MAIL_ACCOUNT}). ` +
      "Actions: summary, inbox, search, count_matches, read, reply, delete, bulk_delete, move, mark, list_mailboxes. " +
      "Inbox/search results include message IDs (id:...) for use with write actions. " +
      "For counting or deleting many emails by sender/subject, prefer count_matches and bulk_delete — they handle the full mailbox in one call with no pagination needed. " +
      "Always confirm reply content with Chris before sending.",
    zodSchema: {
      action: z.enum(["summary", "inbox", "search", "count_matches", "read", "reply", "delete", "bulk_delete", "move", "mark", "list_mailboxes"]),
      count: z.number().optional(),
      offset: z.number().optional(),
      unread_only: z.boolean().optional(),
      query: z.string().optional(),
      since: z.string().optional(),
      before: z.string().optional(),
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
          enum: ["summary", "inbox", "search", "count_matches", "read", "reply", "delete", "bulk_delete", "move", "mark", "list_mailboxes"],
          description:
            "summary: get total/unread message counts. " +
            "inbox: read recent messages (optional: count, offset, unread_only, mailbox). Use offset to paginate. " +
            "search: find messages by subject or sender (requires query; optional: since, before for date range, offset for pagination). " +
            "count_matches: count ALL messages matching query (requires query; optional: since, before, mailbox). No pagination needed — scans entire mailbox. " +
            "read: get full message content (requires message_id). " +
            "reply: reply to a message (requires message_id, body). " +
            "delete: move single message to trash (requires message_id). " +
            "bulk_delete: delete ALL messages matching query in one operation (requires query; optional: since, before, mailbox). Use this instead of search+delete loops. " +
            "move: move message to a mailbox (requires message_id, mailbox). " +
            "mark: mark as read/unread/flagged/unflagged (requires message_id, mark_as). " +
            "list_mailboxes: show available mailbox names.",
        },
        count: {
          type: "number",
          description: "Number of messages to return (default 5, max 50).",
        },
        offset: {
          type: "number",
          description: "Number of messages to skip for pagination (default 0). Works with inbox and search. E.g. offset=50, count=50 returns the next page.",
        },
        unread_only: {
          type: "boolean",
          description: "If true, only return unread messages. Default false.",
        },
        query: {
          type: "string",
          description: "Search term — matches against subject and sender.",
        },
        since: {
          type: "string",
          description: "Only return messages received on or after this date (e.g. 'January 1, 2026'). For search action.",
        },
        before: {
          type: "string",
          description: "Only return messages received on or before this date (e.g. 'March 1, 2026'). For search action.",
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
      const { action, count, offset, unread_only, query, since, before, message_id, body, reply_all, mailbox, mark_as } = args;

      try {
        switch (action) {
          case "summary":
            return await getMailSummary(DEFAULT_MAIL_ACCOUNT);

          case "inbox":
            return await getInboxMessages(DEFAULT_MAIL_ACCOUNT, count ?? 5, unread_only ?? false, mailbox ?? "INBOX", offset ?? 0);

          case "search": {
            if (!query) return "Error: query is required for search action";
            return await searchMail(query, DEFAULT_MAIL_ACCOUNT, count ?? 10, mailbox ?? "INBOX", since, before, offset ?? 0);
          }

          case "count_matches": {
            if (!query) return "Error: query is required for count_matches action";
            return await countMatchingMail(query, DEFAULT_MAIL_ACCOUNT, mailbox ?? "INBOX", since, before);
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

          case "bulk_delete": {
            if (!query) return "Error: query is required for bulk_delete action";
            return await bulkDeleteMail(query, DEFAULT_MAIL_ACCOUNT, mailbox ?? "INBOX", since, before);
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

  console.log("[tools] macos_mail registered");
}
