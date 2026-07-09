import type { CalendarEvent } from "../../tools/macos/calendar-client.js";
import type { NoticeCandidate, NoticeScanner } from "./types.js";

const BACK_TO_BACK_WINDOW_MS = 15 * 60 * 1000;

function formatTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function candidateKey(prefix: string, first: CalendarEvent, second: CalendarEvent): string {
  return `${prefix}:${[first.uid, second.uid].sort().join(":")}:${first.start}:${second.start}`;
}

export class CalendarConflictScanner implements NoticeScanner {
  readonly name = "calendar-conflict";

  constructor(private readonly getEvents: (now: Date) => Promise<CalendarEvent[]>) {}

  async scan(now: Date): Promise<NoticeCandidate[]> {
    const events = (await this.getEvents(now))
      .filter((event) => !event.allDay && new Date(event.end).getTime() > now.getTime())
      .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
    const candidates: NoticeCandidate[] = [];

    for (let index = 0; index < events.length - 1; index += 1) {
      const first = events[index]!;
      const firstEnd = new Date(first.end).getTime();
      for (let following = index + 1; following < events.length; following += 1) {
        const second = events[following]!;
        const secondStart = new Date(second.start).getTime();
        if (secondStart >= firstEnd) break;
        candidates.push({
          key: candidateKey("calendar-overlap", first, second),
          priority: 90,
          summary: `Calendar conflict: “${first.title}” overlaps “${second.title}”.`,
          evidence: `${formatTime(new Date(first.start))}–${formatTime(new Date(first.end))} (${first.calendar}) and ${formatTime(new Date(second.start))}–${formatTime(new Date(second.end))} (${second.calendar}).`,
          suppressUntil: now.getTime() + 24 * 60 * 60 * 1000,
        });
      }

      const second = events[index + 1]!;
      const gap = new Date(second.start).getTime() - firstEnd;
      if (gap >= 0 && gap <= BACK_TO_BACK_WINDOW_MS) {
        const gapMinutes = Math.round(gap / 60_000);
        candidates.push({
          key: candidateKey("calendar-back-to-back", first, second),
          priority: 70,
          summary: gapMinutes === 0
            ? `Back-to-back meetings: “${first.title}” then “${second.title}”.`
            : `Tight calendar gap: ${gapMinutes} minutes between “${first.title}” and “${second.title}”.`,
          evidence: `${formatTime(new Date(first.end))} to ${formatTime(new Date(second.start))}.`,
          suppressUntil: now.getTime() + 24 * 60 * 60 * 1000,
        });
      }
    }

    return candidates;
  }
}
