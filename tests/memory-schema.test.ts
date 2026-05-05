import { describe, expect, it } from "vitest";
import {
  IDENTITY_FILES,
  KNOWLEDGE_FILES,
  MEMORY_CATEGORY_FILES,
  MEMORY_DIRECTORIES,
  MEMORY_FILE_ALIASES,
  MEMORY_FILES,
  REQUIRED_MEMORY_FILES,
} from "../src/domain/memory/constants.js";

describe("canonical memory schema", () => {
  it("keeps required runtime files in prompt-loader order", () => {
    expect([...REQUIRED_MEMORY_FILES]).toEqual([
      ...IDENTITY_FILES,
      ...KNOWLEDGE_FILES,
      ...MEMORY_FILES,
    ]);
    expect([...REQUIRED_MEMORY_FILES]).toEqual([
      "SOUL.md",
      "IDENTITY.md",
      "USER.md",
      "memory/SUMMARY.md",
      "memory/DASHBOARD.md",
      "memory/learnings.md",
    ]);
  });

  it("uses runtime files for user-facing aliases", () => {
    expect(MEMORY_FILE_ALIASES).toEqual({
      soul: "SOUL.md",
      identity: "IDENTITY.md",
      user: "USER.md",
      summary: "memory/SUMMARY.md",
      dashboard: "memory/DASHBOARD.md",
      learnings: "memory/learnings.md",
    });
  });

  it("maps all update_memory categories to canonical runtime files", () => {
    expect(MEMORY_CATEGORY_FILES).toEqual({
      "about-chris": "USER.md",
      preferences: "USER.md",
      projects: "USER.md",
      people: "USER.md",
      decisions: "memory/learnings.md",
      learnings: "memory/learnings.md",
    });
  });

  it("documents expected memory directories", () => {
    expect([...MEMORY_DIRECTORIES]).toEqual([
      "journal/",
      "archive/",
      "conversations/summaries/",
      "skills/",
    ]);
  });
});

