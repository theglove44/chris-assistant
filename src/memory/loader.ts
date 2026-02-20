import { readMemoryFile } from "./github.js";

/** Files that are ALWAYS loaded into the system prompt */
const IDENTITY_FILES = [
  "identity/SOUL.md",
  "identity/RULES.md",
  "identity/VOICE.md",
];

/** Knowledge files loaded into context for every conversation */
const KNOWLEDGE_FILES = [
  "knowledge/about-chris.md",
  "knowledge/preferences.md",
  "knowledge/projects.md",
  "knowledge/people.md",
];

/** Memory files loaded for deeper context */
const MEMORY_FILES = [
  "memory/decisions.md",
  "memory/learnings.md",
];

interface LoadedMemory {
  identity: string;
  knowledge: string;
  memory: string;
}

/**
 * Load all memory files from GitHub and assemble them into
 * structured sections for the system prompt.
 */
export async function loadMemory(): Promise<LoadedMemory> {
  // Load all files in parallel
  const [identityResults, knowledgeResults, memoryResults] = await Promise.all([
    Promise.all(IDENTITY_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
    Promise.all(KNOWLEDGE_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
    Promise.all(MEMORY_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
  ]);

  const formatSection = (files: { path: string; content: string | null }[]) =>
    files
      .filter((f) => f.content)
      .map((f) => `## ${f.path}\n${f.content}`)
      .join("\n\n");

  return {
    identity: formatSection(identityResults),
    knowledge: formatSection(knowledgeResults),
    memory: formatSection(memoryResults),
  };
}

/**
 * Build the full system prompt from loaded memory.
 */
export function buildSystemPrompt(memory: LoadedMemory): string {
  const parts: string[] = [];

  if (memory.identity) {
    parts.push(`# Identity\n\n${memory.identity}`);
  }

  if (memory.knowledge) {
    parts.push(`# Knowledge About Chris\n\n${memory.knowledge}`);
  }

  if (memory.memory) {
    parts.push(`# Memories & Learnings\n\n${memory.memory}`);
  }

  return parts.join("\n\n---\n\n");
}
