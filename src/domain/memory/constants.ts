export const IDENTITY_FILES = [
  "SOUL.md",
  "IDENTITY.md",
] as const;

export const KNOWLEDGE_FILES = [
  "USER.md",
] as const;

export const MEMORY_FILES = [
  "memory/SUMMARY.md",
  "memory/DASHBOARD.md",
  "memory/learnings.md",
] as const;

export const CURATED_SUMMARY_PATH = "memory/SUMMARY.md";

export const MEMORY_CATEGORY_FILES: Record<string, string> = {
  "about-chris": "USER.md",
  preferences: "USER.md",
  projects: "USER.md",
  people: "USER.md",
  decisions: "memory/learnings.md",
  learnings: "memory/learnings.md",
};
