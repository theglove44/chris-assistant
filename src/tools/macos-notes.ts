import { z } from "zod";
import { registerTool } from "./registry.js";
import {
  IS_DARWIN,
  NOTES_TIMEOUT,
  escapeAS,
  runAppleScript,
} from "./macos/shared.js";

// ---------------------------------------------------------------------------
// Notes: AppleScript (like Mail — no framework API alternative)
// ---------------------------------------------------------------------------

const runNotesAppleScript = (script: string) =>
  runAppleScript(script, NOTES_TIMEOUT, "chris-notes");

// Helper: AppleScript snippet to find a folder by name across all accounts.
// Apple Notes nests folders under accounts (e.g. iCloud, On My Mac).
// A bare `folder "X"` only hits top-level/local — this searches everywhere.
function findFolderAS(folderName: string): string {
  return `
-- Search every account for the target folder
set targetFolder to missing value
repeat with acct in accounts
  repeat with f in folders of acct
    if name of f is "${escapeAS(folderName)}" then
      set targetFolder to f
      exit repeat
    end if
  end repeat
  if targetFolder is not missing value then exit repeat
end repeat
if targetFolder is missing value then return "Error: folder '${escapeAS(folderName)}' not found. Use list_folders to see available folders."`;
}

async function listNoteFolders(): Promise<string> {
  const script = `
tell application "Notes"
  set output to ""
  repeat with acct in accounts
    set acctName to name of acct
    repeat with f in folders of acct
      set noteCount to count of notes of f
      set output to output & name of f & " [" & acctName & "] (" & noteCount & " notes)" & "
"
    end repeat
  end repeat
  return output
end tell`;
  return runNotesAppleScript(script);
}

async function listNotes(folder: string, count: number, offset: number): Promise<string> {
  const limit = Math.min(count, 50);
  const start = offset + 1; // AppleScript is 1-indexed
  const script = `
tell application "Notes"
  set output to ""
  ${findFolderAS(folder)}
  set allNotes to notes of targetFolder
  set noteCount to count of allNotes
  set startIdx to ${start}
  if startIdx > noteCount then return "No more notes (total: " & noteCount & ")."
  set endIdx to startIdx + ${limit} - 1
  if endIdx > noteCount then set endIdx to noteCount
  repeat with i from startIdx to endIdx
    set n to item i of allNotes
    set nName to name of n
    set nId to id of n
    set nDate to modification date of n as string
    set output to output & nName & " | modified:" & nDate & " | id:" & nId & "
"
  end repeat
  return "Showing " & startIdx & "-" & endIdx & " of " & noteCount & " notes in ${escapeAS(folder)}:" & "
" & output
end tell`;
  return runNotesAppleScript(script);
}

async function readNote(noteId: string): Promise<string> {
  const script = `
tell application "Notes"
  try
    set n to note id "${escapeAS(noteId)}"
    set nName to name of n
    set nBody to plaintext of n
    set nDate to modification date of n as string
    set nCreated to creation date of n as string
    -- container lookup can fail on iCloud notes; handle gracefully
    set nFolder to "unknown"
    try
      set nFolder to name of container of n
    end try
    return "Title: " & nName & "
Folder: " & nFolder & "
Created: " & nCreated & "
Modified: " & nDate & "
" & "
" & nBody
  on error errMsg
    return "Error: " & errMsg
  end try
end tell`;
  const result = await runNotesAppleScript(script);
  if (result.length > 8000) {
    return result.slice(0, 8000) + "\n\n[... body truncated ...]";
  }
  return result;
}

async function createNote(title: string, body: string, folder: string): Promise<string> {
  // Notes.app uses HTML for the body. Wrap plain text in basic HTML.
  // The title becomes the first line (h1) and body follows.
  const htmlBody = `<h1>${escapeAS(title)}</h1><br>${escapeAS(body).replace(/\n/g, "<br>")}`;
  const script = `
tell application "Notes"
  ${findFolderAS(folder)}
  set newNote to make new note at targetFolder with properties {body:"${escapeAS(htmlBody)}"}
  set nName to name of newNote
  set nId to id of newNote
  return "Created note: " & nName & " | id:" & nId & " in folder: ${escapeAS(folder)}"
end tell`;
  return runNotesAppleScript(script);
}

async function updateNote(noteId: string, title?: string, body?: string, appendBody?: string): Promise<string> {
  if (!title && body === undefined && !appendBody) {
    return "Error: provide title, body, or append_body to update";
  }

  // Build update logic as AppleScript lines
  let updateLines = "";
  if (title && body !== undefined) {
    // Both title and body: replace entire note content
    const htmlBody = `<h1>${escapeAS(title)}</h1><br>${escapeAS(body).replace(/\n/g, "<br>")}`;
    updateLines += `    set body of n to "${escapeAS(htmlBody)}"\n`;
  } else if (body !== undefined) {
    // Body only: keep current title, replace body
    const htmlBody = escapeAS(body).replace(/\n/g, "<br>");
    updateLines += `    set nTitle to name of n\n`;
    updateLines += `    set body of n to "<h1>" & nTitle & "</h1><br>${htmlBody}"\n`;
  } else if (title) {
    // Title only: rename the note
    updateLines += `    set name of n to "${escapeAS(title)}"\n`;
  }
  if (appendBody) {
    const htmlAppend = escapeAS(appendBody).replace(/\n/g, "<br>");
    updateLines += `    set body of n to (body of n) & "<br>${htmlAppend}"\n`;
  }

  const script = `
tell application "Notes"
  try
    set n to note id "${escapeAS(noteId)}"
${updateLines}    set nName to name of n
    return "Updated note: " & nName
  on error errMsg
    return "Error: " & errMsg
  end try
end tell`;
  return runNotesAppleScript(script);
}

async function searchNotes(query: string, folder?: string, count = 20): Promise<string> {
  const limit = Math.min(count, 50);
  // If a folder is specified, find it across all accounts first
  let folderSetup: string;
  if (folder) {
    folderSetup = `${findFolderAS(folder)}
  set searchNotes to notes of targetFolder`;
  } else {
    folderSetup = "set searchNotes to every note";
  }
  const script = `
tell application "Notes"
  set output to ""
  set matchCount to 0
  ${folderSetup}
  repeat with n in searchNotes
    if matchCount >= ${limit} then exit repeat
    set nName to name of n
    set nBody to plaintext of n
    if nName contains "${escapeAS(query)}" or nBody contains "${escapeAS(query)}" then
      set nId to id of n
      set nDate to modification date of n as string
      set nFolder to "unknown"
      try
        set nFolder to name of container of n
      end try
      -- excerpt: first 100 chars of body
      set excerpt to ""
      if length of nBody > 100 then
        set excerpt to text 1 thru 100 of nBody & "..."
      else
        set excerpt to nBody
      end if
      set output to output & nName & " [" & nFolder & "] | modified:" & nDate & " | id:" & nId & "
  " & excerpt & "
"
      set matchCount to matchCount + 1
    end if
  end repeat
  if matchCount = 0 then return "No notes found matching: ${escapeAS(query)}"
  return matchCount & " notes matching \\"${escapeAS(query)}\\":" & "
" & output
end tell`;
  return runNotesAppleScript(script);
}

async function deleteNote(noteId: string): Promise<string> {
  const script = `
tell application "Notes"
  try
    set n to note id "${escapeAS(noteId)}"
    set nName to name of n
    delete n
    return "Deleted note: " & nName
  on error errMsg
    return "Error: " & errMsg
  end try
end tell`;
  return runNotesAppleScript(script);
}

if (!IS_DARWIN) {
  console.log("[tools] skipping macos_notes registration (platform != darwin)");
} else {
  registerTool({
    name: "macos_notes",
    category: "always",
    description:
      "Interact with Apple Notes app. " +
      "Actions: list_folders, list_notes, read, create, update, search, delete. " +
      "Default folder is 'Notes'. Use to read, create, and manage notes for Chris.",
    zodSchema: {
      action: z.enum(["list_folders", "list_notes", "read", "create", "update", "search", "delete"]),
      folder: z.string().optional(),
      title: z.string().optional(),
      body: z.string().optional(),
      append_body: z.string().optional(),
      note_id: z.string().optional(),
      query: z.string().optional(),
      count: z.number().optional(),
      offset: z.number().optional(),
    },
    jsonSchemaParameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["list_folders", "list_notes", "read", "create", "update", "search", "delete"],
          description:
            "list_folders: show all note folders with note counts. " +
            "list_notes: view notes in a folder (optional: count, offset for pagination). " +
            "read: get full note content (requires note_id). " +
            "create: create a new note (requires title; optional: body, folder). " +
            "update: modify a note (requires note_id; optional: title, body to replace, append_body to append). " +
            "search: find notes by text across titles and body (requires query; optional: folder, count). " +
            "delete: delete a note (requires note_id). Always confirm with Chris before deleting.",
        },
        folder: {
          type: "string",
          description: "Folder name. Defaults to 'Notes'.",
        },
        title: {
          type: "string",
          description: "Note title. Required for create.",
        },
        body: {
          type: "string",
          description: "Note body text. For create: initial content. For update: replaces entire body.",
        },
        append_body: {
          type: "string",
          description: "Text to append to the end of an existing note. For update action only.",
        },
        note_id: {
          type: "string",
          description: "Note ID from list_notes or search output. Required for read, update, and delete.",
        },
        query: {
          type: "string",
          description: "Search text — matches across note titles and body content (case-insensitive).",
        },
        count: {
          type: "number",
          description: "Max notes to return (default 20, max 50).",
        },
        offset: {
          type: "number",
          description: "Number of notes to skip for pagination (default 0). For list_notes.",
        },
      },
    },
    execute: async (args: any): Promise<string> => {
      const { action, title, body, append_body, note_id, query, count, offset } = args;
      const folder = args.folder || "Notes";

      try {
        switch (action) {
          case "list_folders":
            return await listNoteFolders();

          case "list_notes":
            return await listNotes(folder, count ?? 20, offset ?? 0);

          case "read": {
            if (!note_id) return "Error: note_id is required for read action. Use list_notes or search to find note IDs.";
            return await readNote(note_id);
          }

          case "create": {
            if (!title) return "Error: title is required for create action";
            return await createNote(title, body ?? "", folder);
          }

          case "update": {
            if (!note_id) return "Error: note_id is required for update action";
            return await updateNote(note_id, title, body, append_body);
          }

          case "search": {
            if (!query) return "Error: query is required for search action";
            return await searchNotes(query, args.folder, count ?? 20);
          }

          case "delete": {
            if (!note_id) return "Error: note_id is required for delete action";
            return await deleteNote(note_id);
          }

          default:
            return `Unknown action: ${action}`;
        }
      } catch (err: any) {
        console.error("[macos_notes] Error:", err.message);
        return `Error: ${err.message}`;
      }
    },
  });

  console.log("[tools] macos_notes registered");
}
