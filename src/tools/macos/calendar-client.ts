import {
  CALENDAR_APP,
  CALENDAR_SETUP_CMD,
  CALENDAR_TIMEOUT,
  runSwiftHelper,
} from "./shared.js";

export interface CalendarEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  calendar: string;
  uid: string;
}

export type CalendarCommand = (args: string[]) => Promise<string>;

export async function runCalendarCommand(args: string[]): Promise<string> {
  return runSwiftHelper(CALENDAR_APP, args, {
    timeoutMs: CALENDAR_TIMEOUT,
    filePrefix: "chris-cal",
    notFoundMessage:
      `Error: Calendar helper not found at ${CALENDAR_APP}. ` +
      `Install it with: ${CALENDAR_SETUP_CMD}`,
  });
}

export function parseCalendarEvents(raw: string): CalendarEvent[] {
  if (raw.startsWith("Error:")) throw new Error(raw);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Calendar helper returned a non-array event payload");

  return parsed.map((event): CalendarEvent => {
    if (!event || typeof event !== "object") throw new Error("Calendar helper returned an invalid event");
    const value = event as Record<string, unknown>;
    if (typeof value.title !== "string" || typeof value.start !== "string" || typeof value.end !== "string"
      || typeof value.allDay !== "boolean" || typeof value.calendar !== "string" || typeof value.uid !== "string") {
      throw new Error("Calendar helper returned an incomplete event");
    }
    return {
      title: value.title,
      start: value.start,
      end: value.end,
      allDay: value.allDay,
      location: typeof value.location === "string" ? value.location : null,
      notes: typeof value.notes === "string" ? value.notes : null,
      calendar: value.calendar,
      uid: value.uid,
    };
  });
}

export async function listCalendarNames(command: CalendarCommand = runCalendarCommand): Promise<string[]> {
  const raw = await command(["list-calendars"]);
  if (raw.startsWith("Error:")) throw new Error(raw);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== "string")) {
    throw new Error("Calendar helper returned an invalid calendar list");
  }
  return parsed;
}

export async function listCalendarEvents(
  start: string,
  end: string,
  command: CalendarCommand = runCalendarCommand,
): Promise<CalendarEvent[]> {
  const calendars = await listCalendarNames(command);
  const results = await Promise.all(calendars.map(async (calendar) => {
    const raw = await command(["get-events", calendar, start, end]);
    return parseCalendarEvents(raw);
  }));
  return results.flat();
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export async function listUpcomingCalendarEvents(
  now = new Date(),
  command: CalendarCommand = runCalendarCommand,
): Promise<CalendarEvent[]> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  return listCalendarEvents(localDateKey(start), localDateKey(end), command);
}

export function formatCalendarEvents(events: CalendarEvent[]): string {
  if (events.length === 0) return "No events found.";
  return events.map((event) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const timeFmt = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const dateFmt = (date: Date) => date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    let line = event.allDay
      ? `${dateFmt(start)} (all day) — ${event.title}`
      : `${dateFmt(start)} ${timeFmt(start)}–${timeFmt(end)} — ${event.title}`;
    if (event.location) line += ` 📍 ${event.location}`;
    return line;
  }).join("\n");
}
