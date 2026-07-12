import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/chat-service.js", () => ({
  chatService: { sendMessage: vi.fn() },
}));

vi.mock("../src/domain/memory/repository.js", () => ({
  writeMemoryFile: vi.fn(),
}));

import {
  RESPONSE_STYLE_LEARNINGS_PATH,
  buildReactionLearningPrompt,
  isReactionLearningDue,
  runReactionLearning,
} from "../src/domain/feedback/learning-service.js";
import type { ReactionFeedbackEvent } from "../src/domain/feedback/reaction-service.js";

const now = new Date("2026-07-12T23:10:00.000Z");

const event: ReactionFeedbackEvent = {
  chatId: 1,
  messageId: 2,
  userMessage: "Please keep updates short",
  assistantMessage: "A concise update",
  responseTs: now.getTime() - 1_000,
  ts: now.getTime(),
  reactionDelayMs: 1_000,
  previousReactions: [],
  reactions: ["👍"],
};

describe("reaction learning service", () => {
  it("runs throughout the scheduled minute window and retries an unfinished week", () => {
    const scheduled = new Date(2026, 6, 12, 23, 37);
    expect(isReactionLearningDue(scheduled, "")).toBe(true);
    expect(isReactionLearningDue(scheduled, "2026-07-12")).toBe(false);
    expect(isReactionLearningDue(new Date(2026, 6, 12, 22, 59), "")).toBe(false);
    expect(isReactionLearningDue(new Date(2026, 6, 13, 23, 37), "")).toBe(false);
  });

  it("writes an auditable no-feedback record without calling a model", async () => {
    const summarize = vi.fn();
    const writeLearnings = vi.fn(async () => {});

    await expect(runReactionLearning({ now, readEvents: () => [], summarize, writeLearnings })).resolves.toContain("Events reviewed: 0");
    expect(summarize).not.toHaveBeenCalled();
    expect(writeLearnings).toHaveBeenCalledWith(
      RESPONSE_STYLE_LEARNINGS_PATH,
      expect.stringContaining("No supported response-style changes this week."),
      expect.stringContaining("2026-07-12"),
    );
  });

  it("distills reaction events with guarded evidence requirements", async () => {
    const summarize = vi.fn(async () => `# Response Style Learnings

Last analyzed: 2026-07-12
Window: last 7 days
Events reviewed: 1

## Guardrails
- Keep safety intact.

## Learnings

No supported response-style changes this week.`);
    const writeLearnings = vi.fn(async () => {});

    await runReactionLearning({ now, readEvents: () => [event], summarize, writeLearnings });
    expect(summarize).toHaveBeenCalledWith(expect.stringContaining("untrusted observational data"));
    expect(summarize).toHaveBeenCalledWith(expect.stringContaining("- Why:"));
    expect(writeLearnings).toHaveBeenCalledWith(RESPONSE_STYLE_LEARNINGS_PATH, expect.stringContaining("# Response Style Learnings"), expect.any(String));
  });

  it("builds a prompt that rejects single ambiguous reactions and raw transcript output", () => {
    const prompt = buildReactionLearningPrompt([event], now);
    expect(prompt).toContain("Do not infer a preference from one ambiguous event");
    expect(prompt).toContain("no quotes or raw message content");
  });
});
