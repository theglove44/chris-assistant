/**
 * Memory staleness detection.
 *
 * Provides human-readable age strings and freshness caveats for memory
 * files. Models are poor at date arithmetic — "47 days ago" triggers
 * staleness reasoning better than a raw ISO timestamp.
 *
 * Adapted from Claude Code's memoryAge.ts blueprint.
 */

/** Days elapsed since mtime. Floor-rounded, clamped to 0. */
export function memoryAgeDays(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000));
}

/** Human-readable age string. */
export function memoryAge(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/**
 * Staleness caveat for memories >1 day old.
 * Returns empty string for fresh (today/yesterday) memories.
 */
export function memoryFreshnessText(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs);
  if (d <= 1) return "";
  return (
    `This memory is ${d} days old. ` +
    `Memories are point-in-time observations, not live state — ` +
    `claims about code behavior or file:line citations may be outdated. ` +
    `Verify against current code before asserting as fact.`
  );
}
