export const IDENTITY_FILES = [
  "identity/SOUL.md",
  "identity/RULES.md",
  "identity/VOICE.md",
] as const;

export const KNOWLEDGE_FILES = [
  "knowledge/about-chris.md",
  "knowledge/preferences.md",
  "knowledge/projects.md",
  "knowledge/people.md",
] as const;

export const MEMORY_FILES = [
  "memory/decisions.md",
  "memory/learnings.md",
] as const;

export const CURATED_SUMMARY_PATH = "memory/SUMMARY.md";

export const MEMORY_CATEGORY_FILES: Record<string, string> = {
  "about-chris": "knowledge/about-chris.md",
  preferences: "knowledge/preferences.md",
  projects: "knowledge/projects.md",
  people: "knowledge/people.md",
  decisions: "memory/decisions.md",
  learnings: "memory/learnings.md",
};
