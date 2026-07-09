import { describe, expect, it } from "vitest";
import { CalendarConflictScanner } from "../src/domain/notice/calendar-conflict-scanner.js";
import type { CalendarEvent } from "../src/tools/macos/calendar-client.js";

const now = new Date("2026-07-09T09:00:00.000Z");

function event(
  uid: string,
  title: string,
  start: string,
  end: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    uid,
    title,
    start,
    end,
    allDay: false,
    location: null,
    notes: null,
    calendar: "Work",
    ...overrides,
  };
}

describe("CalendarConflictScanner", () => {
  it("reports overlapping events at highest priority", async () => {
    const scanner = new CalendarConflictScanner(async () => [
      event("one", "Planning", "2026-07-09T10:00:00.000Z", "2026-07-09T11:00:00.000Z"),
      event("two", "Review", "2026-07-09T10:30:00.000Z", "2026-07-09T11:30:00.000Z", { calendar: "Personal" }),
    ]);

    await expect(scanner.scan(now)).resolves.toEqual([
      expect.objectContaining({
        key: expect.stringContaining("calendar-overlap"),
        priority: 90,
        summary: "Calendar conflict: “Planning” overlaps “Review”.",
        evidence: expect.stringContaining("Work"),
      }),
    ]);
  });

  it("finds every overlap when a long event spans shorter ones", async () => {
    const scanner = new CalendarConflictScanner(async () => [
      event("long", "Workshop", "2026-07-09T10:00:00.000Z", "2026-07-09T12:00:00.000Z"),
      event("short", "Standup", "2026-07-09T10:30:00.000Z", "2026-07-09T10:45:00.000Z"),
      event("later", "Review", "2026-07-09T11:00:00.000Z", "2026-07-09T11:30:00.000Z"),
    ]);

    const candidates = await scanner.scan(now);
    expect(candidates.filter((candidate) => candidate.key.startsWith("calendar-overlap"))).toHaveLength(2);
  });

  it("reports back-to-back and tight-gap events", async () => {
    const scanner = new CalendarConflictScanner(async () => [
      event("one", "Standup", "2026-07-09T10:00:00.000Z", "2026-07-09T10:30:00.000Z"),
      event("two", "One-to-one", "2026-07-09T10:30:00.000Z", "2026-07-09T11:00:00.000Z"),
      event("three", "Design", "2026-07-09T11:15:00.000Z", "2026-07-09T12:00:00.000Z"),
    ]);

    const candidates = await scanner.scan(now);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ priority: 70, summary: expect.stringContaining("Back-to-back") });
    expect(candidates[1]).toMatchObject({ priority: 70, summary: expect.stringContaining("15 minutes") });
  });

  it("ignores all-day and already-ended events", async () => {
    const scanner = new CalendarConflictScanner(async () => [
      event("old", "Old", "2026-07-09T07:00:00.000Z", "2026-07-09T08:00:00.000Z"),
      event("all-day", "Holiday", "2026-07-09T00:00:00.000Z", "2026-07-10T00:00:00.000Z", { allDay: true }),
      event("next", "Next", "2026-07-09T10:00:00.000Z", "2026-07-09T11:00:00.000Z"),
    ]);

    await expect(scanner.scan(now)).resolves.toEqual([]);
  });
});
