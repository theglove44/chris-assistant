import type { SkillIndexEntry } from "../../skills/loader.js";

// Telegram setMyCommands constraints: command names must match /^[a-z0-9_]{1,32}$/
// and descriptions must be 3-256 chars. We sanitize skill names accordingly.
const TELEGRAM_COMMAND_MAX_LEN = 32;
const TELEGRAM_DESCRIPTION_MAX_LEN = 256;
const TELEGRAM_DESCRIPTION_MIN_LEN = 3;

export interface TelegramCommandEntry {
  command: string;
  description: string;
}

/**
 * Convert an arbitrary skill name into a valid Telegram command name.
 * Returns null if the result would be empty (no valid characters).
 *
 * Rules: lowercase, replace runs of non-[a-z0-9_] with `_`, trim leading/trailing `_`,
 * truncate to 32 chars. Empty result -> null (caller should skip with a warning).
 */
export function sanitizeSkillCommand(name: string): string | null {
  if (typeof name !== "string") return null;
  const lowered = name.toLowerCase();
  const replaced = lowered.replace(/[^a-z0-9_]+/g, "_");
  const trimmed = replaced.replace(/^_+|_+$/g, "");
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, TELEGRAM_COMMAND_MAX_LEN);
}

/** Pad/truncate a description to fit Telegram's 3-256 char window. */
export function sanitizeSkillDescription(description: string, fallback: string): string {
  const raw = (description ?? "").trim() || fallback;
  if (raw.length >= TELEGRAM_DESCRIPTION_MIN_LEN) {
    return raw.slice(0, TELEGRAM_DESCRIPTION_MAX_LEN);
  }
  // Pad short descriptions so Telegram accepts them.
  return (raw + " — skill").slice(0, TELEGRAM_DESCRIPTION_MAX_LEN);
}

export interface SkillCommandPlan {
  /** Final list of `{command, description}` entries to register with Telegram. */
  entries: TelegramCommandEntry[];
  /** Skill id -> sanitized command name (for handler dispatch). */
  skillIdByCommand: Map<string, string>;
  /** Skills that were dropped, with reason. */
  skipped: Array<{ id: string; name: string; reason: string }>;
}

/**
 * Merge static commands with sanitized skill commands. Static commands win on
 * conflict; subsequent skill collisions are skipped.
 */
export function buildSkillCommandPlan(
  staticMenu: ReadonlyArray<TelegramCommandEntry>,
  skills: ReadonlyArray<SkillIndexEntry>,
): SkillCommandPlan {
  const taken = new Set(staticMenu.map((e) => e.command));
  const entries: TelegramCommandEntry[] = staticMenu.map((e) => ({ ...e }));
  const skillIdByCommand = new Map<string, string>();
  const skipped: SkillCommandPlan["skipped"] = [];

  for (const skill of skills) {
    if (!skill.enabled) {
      skipped.push({ id: skill.id, name: skill.name, reason: "disabled" });
      continue;
    }
    const command = sanitizeSkillCommand(skill.name) ?? sanitizeSkillCommand(skill.id);
    if (!command) {
      skipped.push({ id: skill.id, name: skill.name, reason: "name produces no valid characters" });
      continue;
    }
    if (taken.has(command)) {
      skipped.push({
        id: skill.id,
        name: skill.name,
        reason: `command "/${command}" collides with an existing entry`,
      });
      continue;
    }
    taken.add(command);
    skillIdByCommand.set(command, skill.id);
    entries.push({
      command,
      description: sanitizeSkillDescription(skill.description, skill.name),
    });
  }

  return { entries, skillIdByCommand, skipped };
}

