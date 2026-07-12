import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { root } = vi.hoisted(() => ({
  root: "/tmp/chris-assistant-event-log-test",
}));

vi.mock("../src/infra/storage/paths.js", () => ({
  APP_DATA_DIR: root,
  appDataPath: (...parts: string[]) => path.join(root, ...parts),
}));

import {
  appendEvent,
  EVENTS_DIR,
  eventDate,
  eventFilePath,
  readEvents,
  redactEventEntries,
} from "../src/domain/events/log.js";
import { withEventContext } from "../src/domain/events/context.js";
import { recordMessageEvent } from "../src/domain/events/message-events.js";
import { recordToolCompleted } from "../src/domain/events/tool-events.js";
import {
  projectConversationHistory,
  rebuildConversationHistory,
} from "../src/domain/events/projections/conversation-history.js";

beforeEach(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("event log", () => {
  it("appends JSONL events and replays conversation history after restart", async () => {
    const ts = Date.UTC(2026, 6, 12, 10, 0, 0);
    await appendEvent({
      type: "message.received",
      chatId: 42,
      correlationId: "turn-1",
      ts,
      payload: { role: "user", content: "hello" },
    });
    await appendEvent({
      type: "message.sent",
      chatId: 42,
      correlationId: "turn-1",
      ts: ts + 1,
      payload: { role: "assistant", content: "hi" },
    });

    const persisted = await readEvents(eventDate(ts));
    expect(persisted).toHaveLength(2);
    const replayed = await rebuildConversationHistory();

    expect(replayed.get(42)).toEqual([
      { role: "user", content: "hello", timestamp: ts },
      { role: "assistant", content: "hi", timestamp: ts + 1 },
    ]);
  });

  it("supports time-travel projection up to a timestamp", async () => {
    const events = [
      { id: "1", correlationId: "a", ts: 100, type: "message.received" as const, chatId: 7, payload: { role: "user", content: "before" } },
      { id: "2", correlationId: "a", ts: 200, type: "message.sent" as const, chatId: 7, payload: { role: "assistant", content: "after" } },
    ];

    expect(projectConversationHistory(events, { until: 150 }).get(7)).toEqual([
      { role: "user", content: "before", timestamp: 100 },
    ]);
  });

  it("returns no events when a day has no shard", async () => {
    await expect(readEvents("2026-01-01")).resolves.toEqual([]);
  });

  it("correlates a turn and stores only safe tool metadata", async () => {
    const ts = Date.UTC(2026, 6, 12, 11, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(ts);

    await withEventContext(42, async () => {
      await recordMessageEvent({ chatId: 42, role: "user", content: "hello", ts });
      await recordToolCompleted({
        name: "ssh",
        provider: "claude",
        args: { command: "echo secret-token" },
        result: "secret-output",
      });
      await recordMessageEvent({ chatId: 42, role: "assistant", content: "done", ts: ts + 1 });
    });

    const events = await readEvents(eventDate(ts));
    expect([...new Set(events.map((event) => event.correlationId))]).toHaveLength(1);
    const tool = events.find((event) => event.type === "tool.completed")!;
    expect(tool.payload).toMatchObject({ name: "ssh", provider: "claude", isError: false });
    expect(JSON.stringify(tool.payload)).not.toContain("secret");
  });

  it("creates private event storage permissions", async () => {
    const ts = Date.UTC(2026, 6, 12, 12, 0, 0);
    await appendEvent({ type: "message.received", chatId: 1, ts, payload: { role: "user", content: "hi" } });

    expect(fs.statSync(EVENTS_DIR).mode & 0o777).toBe(0o700);
    expect(fs.statSync(eventFilePath(eventDate(ts))).mode & 0o777).toBe(0o600);
  });

  it("ignores corrupt records without losing later valid events", async () => {
    const ts = Date.UTC(2026, 6, 12, 13, 0, 0);
    const date = eventDate(ts);
    await appendEvent({ type: "message.received", chatId: 1, ts, payload: { role: "user", content: "before" } });
    fs.appendFileSync(eventFilePath(date), "{truncated\n");
    await appendEvent({ type: "message.sent", chatId: 1, ts: ts + 1, payload: { role: "assistant", content: "after" } });

    await expect(readEvents(date)).resolves.toHaveLength(2);
  });

  it("redacts one chat while preserving other chats and corrupt records", async () => {
    const ts = Date.UTC(2026, 6, 12, 14, 0, 0);
    const date = eventDate(ts);
    await appendEvent({ type: "message.received", chatId: 42, ts, payload: { role: "user", content: "remove" } });
    await appendEvent({ type: "tool.completed", chatId: 42, ts: ts + 1, payload: { name: "x", provider: "test", argsBytes: 1, resultBytes: 1, isError: false } });
    await appendEvent({ type: "message.received", chatId: 7, ts: ts + 2, payload: { role: "user", content: "keep" } });
    fs.appendFileSync(eventFilePath(date), "{corrupt\n");

    await expect(redactEventEntries(42, date)).resolves.toBe(2);
    const raw = fs.readFileSync(eventFilePath(date), "utf-8");
    expect(raw).toContain("{corrupt");
    const events = await readEvents(date);
    expect(events).toHaveLength(1);
    expect(events[0]?.chatId).toBe(7);
  });
});
