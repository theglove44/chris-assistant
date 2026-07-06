import type { JsonStore } from "../../infra/storage/json-store.js";
import type {
  NoticeCandidate,
  NoticeDelivery,
  NoticeLoopOptions,
  NoticeScanner,
  NoticeState,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function formatNotice(candidate: NoticeCandidate): string {
  return candidate.evidence
    ? `${candidate.summary}\n\n${candidate.evidence}`
    : candidate.summary;
}

export class NoticeService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly options: NoticeLoopOptions,
    private readonly scanners: NoticeScanner[],
    private readonly delivery: NoticeDelivery,
    private readonly stateStore: JsonStore<NoticeState>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    if (!this.options.enabled) {
      console.log("[notice] Notice loop disabled");
      return;
    }
    if (this.timer !== null) return;

    console.log("[notice] Starting notice loop (every %d minutes)", this.options.intervalMs / 60_000);
    void this.runOnce();
    this.timer = setInterval(() => { void this.runOnce(); }, this.options.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[notice] Notice loop stopped");
    }
  }

  async runOnce(): Promise<NoticeCandidate | null> {
    if (!this.options.enabled || this.running) return null;
    this.running = true;

    try {
      const now = this.now();
      if (isQuietHour(now.getHours(), this.options.quietStartHour, this.options.quietEndHour)) {
        return null;
      }

      const nowMs = now.getTime();
      const state = this.stateStore.read();
      const recentDeliveries = state.deliveries.filter((entry) => nowMs - entry.sentAt < 7 * DAY_MS);
      const lastDelivery = recentDeliveries.at(-1);
      if (lastDelivery && nowMs - lastDelivery.sentAt < this.options.minGapMs) return null;

      const today = localDateKey(now);
      const sentToday = recentDeliveries.filter((entry) => localDateKey(new Date(entry.sentAt)) === today);
      if (sentToday.length >= this.options.dailyLimit) return null;

      const results = await Promise.allSettled(this.scanners.map((scanner) => scanner.scan(now)));
      const candidates: NoticeCandidate[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          candidates.push(...result.value);
        } else {
          console.error("[notice] Scanner %s failed: %s", this.scanners[index]?.name, result.reason?.message ?? result.reason);
        }
      });

      const selected = candidates
        .filter((candidate) => (state.suppressedUntil[candidate.key] ?? 0) <= nowMs)
        .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))[0];
      if (!selected) return null;

      await this.delivery.send(formatNotice(selected));
      this.stateStore.write({
        deliveries: [...recentDeliveries, { key: selected.key, sentAt: nowMs }],
        suppressedUntil: {
          ...state.suppressedUntil,
          [selected.key]: selected.suppressUntil ?? nowMs + DAY_MS,
        },
      });
      return selected;
    } finally {
      this.running = false;
    }
  }
}
