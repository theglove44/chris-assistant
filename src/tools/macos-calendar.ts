import { z } from "zod";
import { registerTool } from "./registry.js";
import {
  CALENDAR_APP,
  CALENDAR_TIMEOUT,
  CALENDAR_SETUP_CMD,
  DEFAULT_CALENDAR,
  IS_DARWIN,
  runSwiftHelper,
} from "./macos/shared.js";

// ---------------------------------------------------------------------------
// Calendar: Swift EventKit binary (fast, <1s)
// ---------------------------------------------------------------------------

async function runCalendar(args: string[]): Promise<string> {
  return runSwiftHelper(CALENDAR_APP, args, {
    timeoutMs: CALENDAR_TIMEOUT,
    filePrefix: "chris-cal",
    notFoundMessage:
      `Error: Calendar helper not found at ${CALENDAR_APP}. ` +
      `Install it with: ${CALENDAR_SETUP_CMD}`,
  });
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

if (!IS_DARWIN) {
  console.log("[tools] skipping macos_calendar registration (platform != darwin)");
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

  console.log("[tools] macos_calendar registered");
}
