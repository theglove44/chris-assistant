import { mkdir, readFile, writeFile } from "fs/promises";
import * as path from "path";
import { appendToMemoryFile, writeMemoryFile } from "./repository.js";
import { MEMORY_CATEGORY_FILES } from "./constants.js";
import { LOCAL_MEMORY_DIR } from "./recall.js";

const CONTENT_MAX_CHARS = 2000;
const REPLACE_THROTTLE_MS = 5 * 60 * 1000;
const lastReplaceTime = new Map<string, number>();

// ---------------------------------------------------------------------------
// Global token bucket — guards against bursts across many distinct categories.
//
// Design: capacity=10, refill=1 token per 6 minutes → ~10 updates/hour max.
// Burst of 10 lets a normal session write several categories at conversation
// end without penalty; the 6-min refill rate prevents runaway accumulation.
//
// State is intentionally in-memory only (not persisted). A process restart
// clears the bucket — this is acceptable because the DoS scenario we're
// guarding against is within a single process lifetime.
// ---------------------------------------------------------------------------

const BUCKET_CAPACITY = 10;
// Exposed as a getter/setter for test time-mocking
let _bucketNow: () => number = () => Date.now();
let _bucketTokens = BUCKET_CAPACITY;
let _bucketLastRefill = _bucketNow();

/** Milliseconds per token refill (1 token per 6 minutes). */
const TOKEN_REFILL_INTERVAL_MS = 6 * 60 * 1000;

/**
 * Attempt to consume one token from the global bucket.
 * Returns `{ allowed: true }` or `{ allowed: false, retryInMs: number }`.
 */
function consumeGlobalToken(): { allowed: true } | { allowed: false; retryInMs: number } {
  const now = _bucketNow();
  const elapsed = now - _bucketLastRefill;
  const tokensToAdd = Math.floor(elapsed / TOKEN_REFILL_INTERVAL_MS);
  if (tokensToAdd > 0) {
    _bucketTokens = Math.min(BUCKET_CAPACITY, _bucketTokens + tokensToAdd);
    _bucketLastRefill = now - (elapsed % TOKEN_REFILL_INTERVAL_MS);
  }

  if (_bucketTokens >= 1) {
    _bucketTokens -= 1;
    return { allowed: true };
  }

  const retryInMs = TOKEN_REFILL_INTERVAL_MS - (now - _bucketLastRefill);
  return { allowed: false, retryInMs: Math.max(0, retryInMs) };
}

/** Count of updates since last reset (approximate — tracks tokens consumed from full bucket). */
function updatesInLastHour(): number {
  return BUCKET_CAPACITY - _bucketTokens;
}

/**
 * Reset the global bucket. Exposed for tests — do not call in production code.
 */
export function resetGlobalBucket(): void {
  _bucketTokens = BUCKET_CAPACITY;
  _bucketLastRefill = _bucketNow();
}

/**
 * Override the clock used by the bucket. Exposed for tests only.
 */
export function setGlobalBucketClock(fn: () => number): void {
  _bucketNow = fn;
  // Re-anchor last-refill so elapsed calculation starts from fake "now"
  _bucketLastRefill = fn();
}

type ValidationResult = { valid: true } | { valid: false; reason: string };

function validateMemoryContent(args: { category: string; action: "add" | "replace"; content: string }): ValidationResult {
  const { category, action, content } = args;
  const preview = content.slice(0, 100).replace(/\n/g, " ");

  // Global token bucket check — fast-fail before per-category checks.
  const bucketResult = consumeGlobalToken();
  if (!bucketResult.allowed) {
    const retryMins = Math.ceil(bucketResult.retryInMs / 60_000);
    const n = updatesInLastHour();
    const reason = `memory update rate limit exceeded (global) — ${n} updates in the last hour, try again in ${retryMins} minute${retryMins !== 1 ? "s" : ""}`;
    console.warn(`[memory-guard] WARN global-throttle — category="${category}" | preview: "${preview}"`);
    return { valid: false, reason };
  }

  if (content.length > CONTENT_MAX_CHARS) {
    const reason = `Content exceeds ${CONTENT_MAX_CHARS} character limit (got ${content.length})`;
    console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
    return { valid: false, reason };
  }

  if (action === "replace") {
    const last = lastReplaceTime.get(category);
    if (last !== undefined) {
      const elapsed = Date.now() - last;
      if (elapsed < REPLACE_THROTTLE_MS) {
        const remainingSecs = Math.ceil((REPLACE_THROTTLE_MS - elapsed) / 1000);
        const reason = `Replace action throttled for category "${category}" — try again in ${remainingSecs}s`;
        console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
        return { valid: false, reason };
      }
    }
  }

  const injectionPhrases = [
    /ignore\s+(all\s+)?previous/i,
    /disregard\s+(all\s+)?(previous|above|prior|instructions)/i,
    /override\s+(all\s+)?(previous|above|prior|instructions|rules)/i,
    /new\s+instructions/i,
    /system\s+prompt/i,
    /you\s+are\s+now/i,
    /forget\s+(all\s+)?(previous|above|prior|instructions)/i,
  ];
  for (const pattern of injectionPhrases) {
    if (pattern.test(content)) {
      const reason = `Content contains a suspected prompt injection phrase (matched: ${pattern.source})`;
      console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
      return { valid: false, reason };
    }
  }

  const shellBlockPattern = /```(?:bash|sh)\b[\s\S]*?```/gi;
  const dangerousCommands = /\b(?:rm|curl|wget|eval|exec)\b/;
  let match: RegExpExecArray | null;
  while ((match = shellBlockPattern.exec(content)) !== null) {
    if (dangerousCommands.test(match[0])) {
      const reason = "Content contains a shell code block with dangerous commands (rm/curl/wget/eval/exec)";
      console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
      return { valid: false, reason };
    }
  }

  if (/\.\.\//.test(content)) {
    const reason = "Content contains a path traversal sequence (../)";
    console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
    return { valid: false, reason };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Category → memory type mapping for local recall files
// ---------------------------------------------------------------------------

const CATEGORY_TO_TYPE: Record<string, string> = {
  "about-chris": "user",
  preferences: "feedback",
  projects: "project",
  people: "user",
  decisions: "project",
  learnings: "feedback",
};

/**
 * Generate a short slug from content for the filename.
 * Takes first ~40 chars, lowercases, strips non-alphanumeric, joins with dashes.
 */
function slugify(text: string): string {
  return text
    .slice(0, 60)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40) || "entry";
}

/**
 * Auto-generate a one-line description from content for the frontmatter.
 * Uses the first line/sentence, capped at 120 chars.
 */
function autoDescription(content: string, category: string): string {
  const firstLine = content.split("\n").find((l) => l.trim().length > 0) || content;
  // Strip markdown bullets, bold, comment tags
  const cleaned = firstLine
    .replace(/^<!--.*?-->\s*/g, "")
    .replace(/^[-*•]\s*/g, "")
    .replace(/\*\*/g, "")
    .trim();
  const capped = cleaned.length > 120 ? cleaned.slice(0, 117) + "..." : cleaned;
  return capped || `${category} memory update`;
}

/**
 * Dual-write: persist a local topic file in memory/ alongside the GitHub write.
 * Each update_memory call creates a new file so the recall system has granular
 * entries to select from. Fire-and-forget — failures are logged but don't block.
 */
async function writeLocalMemoryFile(
  category: string,
  content: string,
): Promise<void> {
  try {
    await mkdir(LOCAL_MEMORY_DIR, { recursive: true });
    const type = CATEGORY_TO_TYPE[category] || "reference";
    const timestamp = new Date().toISOString().split("T")[0];
    const slug = slugify(content);
    const filename = `${category}_${timestamp}_${slug}.md`;
    const filePath = path.join(LOCAL_MEMORY_DIR, filename);
    const description = autoDescription(content, category);

    const fileContent = `---
name: ${category} — ${slug.replace(/-/g, " ")}
description: ${description}
type: ${type}
---

${content}
`;
    await writeFile(filePath, fileContent, "utf-8");
    console.log("[memory] Local recall file written: %s", filename);
  } catch (err: any) {
    console.warn("[memory] Failed to write local recall file:", err.message);
  }
}

export async function executeMemoryTool(args: { category: string; action: "add" | "replace"; content: string }): Promise<string> {
  const validation = validateMemoryContent(args);
  if (!validation.valid) {
    return `Memory update rejected: ${validation.reason}`;
  }

  const { category, action, content } = args;
  const filePath = MEMORY_CATEGORY_FILES[category];
  if (!filePath) return `Unknown category: ${category}`;

  const timestamp = new Date().toISOString().split("T")[0];
  const entry = `<!-- Updated: ${timestamp} -->\n${content}`;

  try {
    if (action === "replace") {
      await writeMemoryFile(filePath, entry, `memory: replace ${category}`);
      lastReplaceTime.set(category, Date.now());
    } else {
      await appendToMemoryFile(filePath, entry, `memory: add to ${category}`);
    }

    // Dual-write: also persist as a local topic file for Sonnet recall.
    // Fire-and-forget — GitHub is the source of truth.
    writeLocalMemoryFile(category, content).catch(() => {});

    return `Memory updated (${category}/${action})`;
  } catch (error: any) {
    return `Failed to update memory: ${error.message}`;
  }
}
