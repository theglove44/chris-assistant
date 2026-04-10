/**
 * Tests for token-aware history formatting in history-service.ts.
 *
 * The MAX_HISTORY_TOKENS cap (8000 tokens) ensures that long messages
 * (email digests, code dumps) don't bloat context on new session starts.
 * Newest messages are preserved when the budget is exceeded.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConversationMessage } from "../src/domain/conversations/types.js";

// ---- module mocks (must be declared before dynamic import) ----

// Prevent archive writes hitting the filesystem
vi.mock("../src/domain/conversations/archive-service.js", () => ({
  archiveMessage: vi.fn(),
}));

// Prevent dream trigger firing during tests
vi.mock("../src/domain/memory/dream-service.js", () => ({
  tryDream: vi.fn().mockResolvedValue(undefined),
}));

// We'll inject history via this mock
let mockHistory: Map<number, ConversationMessage[]> = new Map();

vi.mock("../src/domain/conversations/store.js", () => ({
  ensureConversationStoreLoaded: vi.fn(() => Promise.resolve(mockHistory)),
  saveConversationStore: vi.fn(() => Promise.resolve()),
}));

// Prevent config/env loading
process.env.TELEGRAM_BOT_TOKEN = "test";
process.env.TELEGRAM_ALLOWED_USER_ID = "12345";
process.env.GITHUB_TOKEN = "test-github-token";
process.env.GITHUB_MEMORY_REPO = "test/repo";

vi.mock("../src/infra/storage/paths.js", () => ({
  APP_DATA_DIR: "/tmp/test",
  appDataPath: (...parts: string[]) => `/tmp/test/${parts.join("/")}`,
}));

import { formatHistoryForPrompt } from "../src/domain/conversations/history-service.js";

// ---- helpers ----

function msg(role: "user" | "assistant", content: string, ts = Date.now()): ConversationMessage {
  return { role, content, timestamp: ts };
}

/** Build a string of approximately targetTokens tokens (3.5 chars/token). */
function longContent(targetTokens: number): string {
  return "x".repeat(Math.ceil(targetTokens * 3.5));
}

const CHAT_ID = 1;

beforeEach(() => {
  mockHistory = new Map();
});

// ---- tests ----

describe("formatHistoryForPrompt", () => {
  it("returns empty string when no history", async () => {
    mockHistory.set(CHAT_ID, []);
    const result = await formatHistoryForPrompt(CHAT_ID);
    expect(result).toBe("");
  });

  it("returns empty string for unknown chatId", async () => {
    const result = await formatHistoryForPrompt(9999);
    expect(result).toBe("");
  });

  it("formats a simple exchange correctly", async () => {
    mockHistory.set(CHAT_ID, [
      msg("user", "Hello"),
      msg("assistant", "Hi there"),
    ]);
    const result = await formatHistoryForPrompt(CHAT_ID);
    expect(result).toContain("Chris: Hello");
    expect(result).toContain("Assistant: Hi there");
    expect(result).toContain("# Recent Conversation");
    expect(result).toContain("Chris's latest message follows:");
  });

  it("keeps all messages when well under the token budget", async () => {
    const messages = [
      msg("user", "Short message 1"),
      msg("assistant", "Short reply 1"),
      msg("user", "Short message 2"),
      msg("assistant", "Short reply 2"),
    ];
    mockHistory.set(CHAT_ID, messages);
    const result = await formatHistoryForPrompt(CHAT_ID);
    expect(result).toContain("Short message 1");
    expect(result).toContain("Short reply 1");
    expect(result).toContain("Short message 2");
    expect(result).toContain("Short reply 2");
  });

  it("drops oldest messages when history exceeds the token budget", async () => {
    // Create messages: old short ones + new long ones that together exceed 8k tokens
    // Each ~3000-token message takes ~10,500 chars
    const oldMessage = msg("user", "This is an old short message", Date.now() - 10000);
    const recentLarge1 = msg("user", longContent(4000), Date.now() - 2000);
    const recentLarge2 = msg("assistant", longContent(4000), Date.now() - 1000);

    mockHistory.set(CHAT_ID, [oldMessage, recentLarge1, recentLarge2]);
    const result = await formatHistoryForPrompt(CHAT_ID);

    // Old short message should be dropped (budget exceeded by large recent messages)
    expect(result).not.toContain("This is an old short message");
    // Recent messages should be present (newest-first selection)
    expect(result).toContain("x".repeat(50)); // content of the large messages
  });

  it("preserves the most recent messages when budget is exceeded", async () => {
    // 5 messages of ~2000 tokens each — total ~10k, exceeds 8k budget
    const messages = Array.from({ length: 5 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", longContent(2000) + `_marker_${i}`, Date.now() + i)
    );
    mockHistory.set(CHAT_ID, messages);
    const result = await formatHistoryForPrompt(CHAT_ID);

    // The newest message (marker_4) must always be included
    expect(result).toContain("_marker_4");
    // The oldest message (marker_0) should have been dropped
    expect(result).not.toContain("_marker_0");
  });

  it("returns empty string when a single message exceeds the token budget", async () => {
    // One enormous message — nothing fits within 8k tokens
    const messages = [msg("user", longContent(9000))];
    mockHistory.set(CHAT_ID, messages);
    const result = await formatHistoryForPrompt(CHAT_ID);
    // A single over-budget message results in no history injected
    expect(result).toBe("");
  });

  it("includes the section header and separator", async () => {
    mockHistory.set(CHAT_ID, [msg("user", "test")]);
    const result = await formatHistoryForPrompt(CHAT_ID);
    expect(result.startsWith("# Recent Conversation")).toBe(true);
    expect(result).toContain("---");
  });
});
