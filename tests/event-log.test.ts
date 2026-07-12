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

import { appendEvent, eventDate, readEvents } from "../src/domain/events/log.js";
import {
  projectConversationHistory,
  rebuildConversationHistory,
} from "../src/domain/events/projections/conversation-history.js";

beforeEach(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

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
});
