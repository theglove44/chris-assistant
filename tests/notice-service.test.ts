import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalGapScanner } from "../src/domain/notice/journal-gap-scanner.js";
import { NoticeService } from "../src/domain/notice/notice-service.js";
import { createNoticeStateStore } from "../src/domain/notice/state.js";
import type { NoticeCandidate, NoticeScanner } from "../src/domain/notice/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function stateStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notice-state-"));
  tempDirs.push(dir);
  return createNoticeStateStore(path.join(dir, "state.json"));
}

function candidate(key: string, priority = 50): NoticeCandidate {
  return { key, priority, summary: `Summary ${key}`, evidence: `Evidence ${key}` };
}

function scanner(...candidates: NoticeCandidate[]): NoticeScanner {
  return { name: "test", scan: () => candidates };
}

function options(overrides: Partial<ConstructorParameters<typeof NoticeService>[0]> = {}) {
  return {
    enabled: true,
    intervalMs: 60 * 60 * 1000,
    quietStartHour: 22,
    quietEndHour: 8,
    minGapMs: 4 * 60 * 60 * 1000,
    dailyLimit: 2,
    ...overrides,
  };
}

describe("NoticeService", () => {
  it("delivers highest-priority candidate and persists evidence", async () => {
    const sent: string[] = [];
    const store = stateStore();
    const now = new Date(2026, 6, 6, 12, 0);
    const service = new NoticeService(
      options(),
      [scanner(candidate("low", 10), candidate("high", 90))],
      { async send(text) { sent.push(text); } },
      store,
      () => now,
    );

    await expect(service.runOnce()).resolves.toMatchObject({ key: "high" });
    expect(sent).toEqual(["Summary high\n\nEvidence high"]);
    expect(store.read().deliveries).toEqual([{ key: "high", sentAt: now.getTime() }]);
  });

  it("does not scan or deliver during overnight quiet hours", async () => {
    const scan = vi.fn(() => [candidate("quiet")]);
    const send = vi.fn(async () => {});
    const service = new NoticeService(
      options(),
      [{ name: "test", scan }],
      { send },
      stateStore(),
      () => new Date(2026, 6, 6, 23, 0),
    );

    await expect(service.runOnce()).resolves.toBeNull();
    expect(scan).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("enforces minimum gap and daily cap from persisted state", async () => {
    const store = stateStore();
    const first = new Date(2026, 6, 6, 9, 0);
    let now = first;
    const send = vi.fn(async () => {});
    const service = new NoticeService(
      options(),
      [{ name: "test", scan: (date) => [candidate(`at-${date.getHours()}`)] }],
      { send },
      store,
      () => now,
    );

    await service.runOnce();
    now = new Date(2026, 6, 6, 12, 59);
    await expect(service.runOnce()).resolves.toBeNull();
    now = new Date(2026, 6, 6, 13, 0);
    await service.runOnce();
    now = new Date(2026, 6, 6, 18, 0);
    await expect(service.runOnce()).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("isolates scanner failures", async () => {
    const send = vi.fn(async () => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new NoticeService(
      options(),
      [
        { name: "broken", scan: async () => { throw new Error("boom"); } },
        scanner(candidate("healthy")),
      ],
      { send },
      stateStore(),
      () => new Date(2026, 6, 6, 12, 0),
    );

    await expect(service.runOnce()).resolves.toMatchObject({ key: "healthy" });
    expect(send).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("stays inert when disabled", async () => {
    vi.useFakeTimers();
    const scan = vi.fn(() => [candidate("disabled")]);
    const service = new NoticeService(
      options({ enabled: false }),
      [{ name: "test", scan }],
      { send: vi.fn(async () => {}) },
      stateStore(),
    );

    service.start();
    await vi.runOnlyPendingTimersAsync();
    expect(scan).not.toHaveBeenCalled();
  });
});

describe("JournalGapScanner", () => {
  it("returns nothing when journal is recent", () => {
    const scanner = new JournalGapScanner(2, () => ["2026-07-05"]);
    expect(scanner.scan(new Date(2026, 6, 6, 12, 0))).toEqual([]);
  });

  it("reports stale journal with evidence", () => {
    const scanner = new JournalGapScanner(2, () => ["junk", "2026-07-02"]);
    expect(scanner.scan(new Date(2026, 6, 6, 12, 0))).toEqual([
      expect.objectContaining({
        key: "journal-gap:2026-07-06",
        summary: expect.stringContaining("4 days"),
        evidence: "Most recent journal entry: 2026-07-02.",
      }),
    ]);
  });
});
