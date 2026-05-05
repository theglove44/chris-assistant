import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const memory = {
    identity: "## SOUL.md\nChris Assistant is warm, direct, and continuous.",
    knowledge: "## USER.md\nChris prefers concise engineering updates.",
    memory: "## memory/learnings.md\nRemember that Chris values trust recovery work.",
    recentSummaries: "### 2026-05-04\nDiscussed recovery planning.",
    recentJournal: "### 2026-05-05 (today)\nNoted prompt contract work.",
    curatedSummary: "Chris is rebuilding confidence in his personal assistant.",
    skillIndex: "- **debug_self** - Inspect assistant runtime\n  Triggers: \"debug yourself\"",
  };

  const config = {
    model: "gpt-5.2",
  };

  return { memory, config };
});

vi.mock("../src/config.js", () => ({
  config: fixtures.config,
  repoOwner: "owner",
  repoName: "repo",
}));

vi.mock("../src/memory/loader.js", () => ({
  loadMemory: vi.fn(async () => fixtures.memory),
  buildSystemPrompt: vi.fn((memory: typeof fixtures.memory) => [
    memory.identity ? `# Identity\n\n${memory.identity}` : "",
    memory.curatedSummary ? `# Curated Memory\n\n${memory.curatedSummary}` : "",
    memory.knowledge ? `# Knowledge About Chris\n\n${memory.knowledge}` : "",
    memory.memory ? `# Memories & Learnings\n\n${memory.memory}` : "",
    memory.recentSummaries ? `# Recent Conversation History\n\n${memory.recentSummaries}` : "",
    memory.recentJournal ? `# Your Recent Journal\n\n${memory.recentJournal}` : "",
    memory.skillIndex ? `# Available Skills\n\n${memory.skillIndex}` : "",
  ].filter(Boolean).join("\n\n---\n\n")),
}));

vi.mock("../src/tools/files.js", () => ({
  getWorkspaceRoot: vi.fn(() => "/Users/christaylor/Projects/chris-assistant"),
  isProjectActive: vi.fn(() => true),
  setWorkspaceChangeCallback: vi.fn(),
}));

vi.mock("../src/tools/index.js", () => ({
  resetLoopDetection: vi.fn(),
}));

import {
  getClaudeAppendPrompt,
  getCodexSystemPrompt,
  getSystemPrompt,
  inspectPrompt,
  invalidatePromptCache,
} from "../src/providers/shared.js";

async function assembledPrompts(): Promise<string[]> {
  fixtures.config.model = "gpt-5.2";
  invalidatePromptCache();
  const openai = await getSystemPrompt();

  fixtures.config.model = "claude-sonnet-4-6";
  invalidatePromptCache();
  const claude = await getClaudeAppendPrompt();

  fixtures.config.model = "codex-agent-o4-mini";
  invalidatePromptCache();
  const codex = await getCodexSystemPrompt();

  return [openai, claude, codex];
}

describe("assistant runtime prompt contract", () => {
  beforeEach(() => {
    invalidatePromptCache();
    fixtures.config.model = "gpt-5.2";
  });

  it("identifies as Chris Assistant across provider prompts", async () => {
    for (const prompt of await assembledPrompts()) {
      expect(prompt).toContain("Chris Assistant");
      expect(prompt).toContain("not Claude Code");
      expect(prompt).toContain("not the Codex CLI");
      expect(prompt).toContain("not a generic");
    }
  });

  it("covers the issue #110 identity evaluation prompts in the contract", async () => {
    const prompt = await getSystemPrompt();

    expect(prompt).toContain('If Chris asks "who are you?"');
    expect(prompt).toContain('If Chris asks "where do you run?"');
    expect(prompt).toContain('If Chris asks "what memory/tools do you have?"');
    expect(prompt).toContain('If Chris asks "how are you different from Claude Code?"');
  });

  it("states local Telegram, macOS, and pm2 runtime context", async () => {
    for (const prompt of await assembledPrompts()) {
      expect(prompt).toContain("Telegram");
      expect(prompt).toContain("chris-assistant");
      expect(prompt).toContain("MacBook Pro");
      expect(prompt).toContain("pm2");
      expect(prompt).toContain("~/.chris-assistant/");
    }
  });

  it("keeps memory, journal, summaries, skills, and tool framing visible", async () => {
    const prompt = await getSystemPrompt();

    expect(prompt).toContain("persistent memory");
    expect(prompt).toContain("Recent Conversation History");
    expect(prompt).toContain("Your Recent Journal");
    expect(prompt).toContain("Available Skills");
    expect(prompt).toContain("Tools Available");
  });

  it("suppresses provider identity leakage for Claude and Codex agent modes", async () => {
    fixtures.config.model = "claude-sonnet-4-6";
    invalidatePromptCache();
    const claude = await getClaudeAppendPrompt();
    expect(claude).toContain("Claude Code is an execution substrate and tool runtime, not your identity");
    expect(claude).toContain("Do not introduce yourself as Claude Code");
    expect(claude).toContain("this Chris Assistant runtime contract takes priority");

    fixtures.config.model = "codex-agent-o4-mini";
    invalidatePromptCache();
    const codex = await getCodexSystemPrompt();
    expect(codex).toContain("Codex is an execution substrate and coding runtime, not your identity");
    expect(codex).toContain("Do not introduce yourself as Codex");
  });
});

describe("prompt inspection", () => {
  beforeEach(() => {
    invalidatePromptCache();
    fixtures.config.model = "gpt-5.2";
  });

  it("prints redacted section diagnostics without raw memory bodies", async () => {
    const report = await inspectPrompt();

    expect(report).toContain("Chris Assistant Prompt Inspection");
    expect(report).toContain("Active model: gpt-5.2");
    expect(report).toContain("Resolved provider: OpenAI");
    expect(report).toContain("Workspace root: /Users/christaylor/Projects/chris-assistant");

    for (const section of [
      "Assistant Runtime Contract",
      "Identity / Memory",
      "Runtime Context",
      "Provider Adapter",
      "Formatting",
      "Project Context",
    ]) {
      expect(report).toContain(section);
    }

    expect(report).toContain("identity: present");
    expect(report).toContain("skillIndex: present");
    expect(report).toContain("Raw memory bodies, tokens, and environment values are intentionally redacted.");
    expect(report).not.toContain("Chris prefers concise engineering updates.");
    expect(report).not.toContain("Discussed recovery planning.");
  });
});
