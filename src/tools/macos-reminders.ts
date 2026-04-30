import { z } from "zod";
import { registerTool } from "./registry.js";
import {
  DEFAULT_REMINDERS_LIST,
  IS_DARWIN,
  REMINDERS_APP,
  REMINDERS_SETUP_CMD,
  REMINDERS_TIMEOUT,
  runSwiftHelper,
} from "./macos/shared.js";

// ---------------------------------------------------------------------------
// Reminders: Swift EventKit binary (fast, TCC-safe via .app bundle)
// ---------------------------------------------------------------------------

async function runReminders(args: string[]): Promise<string> {
  return runSwiftHelper(REMINDERS_APP, args, {
    timeoutMs: REMINDERS_TIMEOUT,
    filePrefix: "chris-rem",
    notFoundMessage:
      `Error: Reminders helper not found at ${REMINDERS_APP}. ` +
      `Install it with: ${REMINDERS_SETUP_CMD}`,
  });
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

if (!IS_DARWIN) {
  console.log("[tools] skipping macos_reminders registration (platform != darwin)");
} else {
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

  console.log("[tools] macos_reminders registered");
}
