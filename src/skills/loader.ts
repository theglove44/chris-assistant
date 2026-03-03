import { readMemoryFile, writeMemoryFile } from "../memory/github.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInput {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
  default?: any;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  triggers: string[];
  tools: string[];
  inputs: Record<string, SkillInput>;
  instructions: string;
  outputFormat: string;
  state: Record<string, any>;
}

export interface SkillIndexEntry {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggers: string[];
}

// ---------------------------------------------------------------------------
// Index cache (5-minute TTL, same pattern as system prompt cache)
// ---------------------------------------------------------------------------

const INDEX_CACHE_TTL = 5 * 60 * 1000;
let cachedIndex: SkillIndexEntry[] | null = null;
let lastIndexLoad = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the skill index from GitHub. Returns cached version if fresh.
 * Returns [] on first use (no index file yet).
 */
export async function loadSkillIndex(): Promise<SkillIndexEntry[]> {
  const now = Date.now();
  if (cachedIndex && now - lastIndexLoad < INDEX_CACHE_TTL) {
    return cachedIndex;
  }

  const raw = await readMemoryFile("skills/_index.json");
  if (!raw) {
    cachedIndex = [];
    lastIndexLoad = now;
    return [];
  }

  try {
    cachedIndex = JSON.parse(raw) as SkillIndexEntry[];
  } catch {
    console.warn("[skills] Failed to parse _index.json, returning empty");
    cachedIndex = [];
  }
  lastIndexLoad = now;
  return cachedIndex;
}

/**
 * Load a full skill definition by ID. Returns null if not found.
 */
export async function loadSkill(id: string): Promise<Skill | null> {
  const raw = await readMemoryFile(`skills/${id}.json`);
  if (!raw || raw.trim() === "") return null;

  try {
    return JSON.parse(raw) as Skill;
  } catch {
    console.warn("[skills] Failed to parse skill %s", id);
    return null;
  }
}

/**
 * Save a skill definition and rebuild the index.
 */
export async function saveSkill(skill: Skill): Promise<void> {
  // Write the skill file
  await writeMemoryFile(
    `skills/${skill.id}.json`,
    JSON.stringify(skill, null, 2),
    `Update skill: ${skill.name}`,
  );

  // Rebuild index: load current, upsert this entry, write back
  const index = await loadSkillIndex();
  const entry: SkillIndexEntry = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled,
    triggers: skill.triggers,
  };

  const existing = index.findIndex((e) => e.id === skill.id);
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }

  await writeMemoryFile(
    "skills/_index.json",
    JSON.stringify(index, null, 2),
    `Rebuild skill index (${index.length} skills)`,
  );

  // Update cache
  cachedIndex = index;
  lastIndexLoad = Date.now();
}

/**
 * Delete a skill by removing it from the index and overwriting its file.
 */
export async function deleteSkill(id: string): Promise<void> {
  // Remove from index
  const index = await loadSkillIndex();
  const filtered = index.filter((e) => e.id !== id);

  if (filtered.length === index.length) {
    // Not found in index — nothing to do
    return;
  }

  await writeMemoryFile(
    "skills/_index.json",
    JSON.stringify(filtered, null, 2),
    `Remove skill ${id} from index`,
  );

  // Overwrite skill file with empty string to effectively delete it
  await writeMemoryFile(
    `skills/${id}.json`,
    "",
    `Delete skill: ${id}`,
  );

  // Update cache
  cachedIndex = filtered;
  lastIndexLoad = Date.now();
}

/** Invalidate the cached index so the next load fetches fresh from GitHub. */
export function invalidateSkillCache(): void {
  cachedIndex = null;
  lastIndexLoad = 0;
}
