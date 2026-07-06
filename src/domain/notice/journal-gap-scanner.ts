import type { NoticeCandidate, NoticeScanner } from "./types.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export class JournalGapScanner implements NoticeScanner {
  readonly name = "journal-gap";

  constructor(
    private readonly gapDays: number,
    private readonly listDates: () => string[],
  ) {}

  scan(now: Date): NoticeCandidate[] {
    const today = localDateKey(now);
    const dates = this.listDates().filter((date) => DATE_PATTERN.test(date)).sort();
    const latest = dates.at(-1);
    const gap = latest ? Math.max(0, dayNumber(today) - dayNumber(latest)) : null;

    if (gap !== null && gap < this.gapDays) return [];

    const summary = gap === null
      ? "Your journal has no entries yet. Worth capturing what changed today?"
      : `Your journal has been quiet for ${gap} days. Worth capturing what changed?`;
    const evidence = latest ? `Most recent journal entry: ${latest}.` : "No dated journal files found.";

    return [{
      key: `journal-gap:${today}`,
      priority: 50,
      summary,
      evidence,
      suppressUntil: now.getTime() + 24 * 60 * 60 * 1000,
    }];
  }
}
