import { describe, expect, it } from "vitest";
import {
  listCalendarEvents,
  listUpcomingCalendarEvents,
  parseCalendarEvents,
  type CalendarCommand,
} from "../src/tools/macos/calendar-client.js";

const event = {
  title: "Planning",
  start: "2026-07-09T10:00:00Z",
  end: "2026-07-09T11:00:00Z",
  allDay: false,
  location: null,
  notes: null,
  calendar: "Work",
  uid: "event-1",
};

describe("calendar client", () => {
  it("validates EventKit event payloads", () => {
    expect(parseCalendarEvents(JSON.stringify([event]))).toEqual([event]);
    expect(() => parseCalendarEvents("Error: denied")).toThrow("denied");
    expect(() => parseCalendarEvents(JSON.stringify([{ title: "missing fields" }]))).toThrow("incomplete");
  });

  it("loads events from every calendar", async () => {
    const calls: string[][] = [];
    const command: CalendarCommand = async (args) => {
      calls.push(args);
      if (args[0] === "list-calendars") return JSON.stringify(["Work", "Personal"]);
      return JSON.stringify([{ ...event, calendar: args[1], uid: `${args[1]}-1` }]);
    };

    await expect(listCalendarEvents("2026-07-09", "2026-07-11", command)).resolves.toEqual([
      { ...event, calendar: "Work", uid: "Work-1" },
      { ...event, calendar: "Personal", uid: "Personal-1" },
    ]);
    expect(calls).toEqual([
      ["list-calendars"],
      ["get-events", "Work", "2026-07-09", "2026-07-11"],
      ["get-events", "Personal", "2026-07-09", "2026-07-11"],
    ]);
  });

  it("queries today and tomorrow for proactive scans", async () => {
    const calls: string[][] = [];
    const command: CalendarCommand = async (args) => {
      calls.push(args);
      return args[0] === "list-calendars" ? JSON.stringify(["Work"]) : JSON.stringify([]);
    };

    await listUpcomingCalendarEvents(new Date(2026, 6, 9, 12, 0), command);
    expect(calls).toEqual([
      ["list-calendars"],
      ["get-events", "Work", "2026-07-09", "2026-07-11"],
    ]);
  });
});
