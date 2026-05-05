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

export const REQUIRED_MEMORY_FILES = [
  ...IDENTITY_FILES,
  ...KNOWLEDGE_FILES,
  ...MEMORY_FILES,
] as const;

export const MEMORY_DIRECTORIES = [
  "journal/",
  "archive/",
  "conversations/summaries/",
  "skills/",
] as const;

export const STALE_MEMORY_FILES = [
  "USER.md",
  "memory/SUMMARY.md",
  "memory/DASHBOARD.md",
  "memory/learnings.md",
] as const;

export const MEMORY_STALE_AFTER_DAYS = 30;

export const MEMORY_FILE_ALIASES: Record<string, string> = {
  soul: "SOUL.md",
  identity: "IDENTITY.md",
  user: "USER.md",
  summary: "memory/SUMMARY.md",
  dashboard: "memory/DASHBOARD.md",
  learnings: "memory/learnings.md",
};

export const MEMORY_CATEGORY_FILES: Record<string, string> = {
  "about-chris": "USER.md",
  preferences: "USER.md",
  projects: "USER.md",
  people: "USER.md",
  decisions: "memory/learnings.md",
  learnings: "memory/learnings.md",
};
