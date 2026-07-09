import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  archiveReactionFeedback,
  createReactionContextStore,
  recordAssistantMessage,
  recordReaction,
  type ReactionFeedbackEvent,
} from "../src/domain/feedback/reaction-service.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reaction-feedback-"));
  dirs.push(dir);
  return dir;
}

describe("reaction feedback", () => {
  it("links a reaction to assistant and preceding user context", () => {
    const dir = tempDir();
    const store = createReactionContextStore(path.join(dir, "contexts.json"));
    recordAssistantMessage({
      chatId: 42,
      messageId: 99,
      userMessage: "What changed?",
      assistantMessage: "The calendar helper is ready.",
      responseTs: 1_000,
    }, store);
    const archived: ReactionFeedbackEvent[] = [];

    const event = recordReaction(
      { ts: 2_000, previousReactions: [], reactions: ["👍"] },
      42,
      99,
      store,
      (value) => archived.push(value),
    );

    expect(event).toMatchObject({
      chatId: 42,
      messageId: 99,
      userMessage: "What changed?",
      assistantMessage: "The calendar helper is ready.",
      reactions: ["👍"],
    });
    expect(archived).toHaveLength(1);
  });

  it("ignores reactions to messages without assistant context", () => {
    const store = createReactionContextStore(path.join(tempDir(), "contexts.json"));
    expect(recordReaction({ ts: 2_000, previousReactions: [], reactions: ["👎"] }, 42, 99, store)).toBeNull();
  });

  it("archives feedback as daily JSONL", () => {
    const dir = tempDir();
    const event: ReactionFeedbackEvent = {
      chatId: 42,
      messageId: 99,
      userMessage: "Question",
      assistantMessage: "Answer",
      responseTs: 1_000,
      ts: new Date(2026, 6, 9, 12, 0).getTime(),
      previousReactions: [],
      reactions: ["🎯"],
    };
    archiveReactionFeedback(event, dir);
    expect(fs.readFileSync(path.join(dir, "2026-07-09.jsonl"), "utf-8")).toBe(`${JSON.stringify(event)}\n`);
  });
});
