/**
 * Memory recall — selects relevant memory files per user query.
 *
 * On every user message, scans the local memory/ directory for .md files
 * with YAML frontmatter, scores them against the query using keyword
 * matching, and returns the top 5 most relevant files for context injection.
 *
 * Uses local keyword scoring (zero latency, zero cost, no auth needed).
 * Can be upgraded to a Sonnet side-call when an ANTHROPIC_API_KEY is available.
 */

import { mkdir, readFile } from "fs/promises";
import * as path from "path";
import { memoryFreshnessText } from "./memory-age.js";
import {
  type MemoryHeader,
  scanMemoryFiles,
} from "./memory-scan.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelevantMemory {
  path: string;
  mtimeMs: number;
  content: string;
}

// ---------------------------------------------------------------------------
// Memory directory
// ---------------------------------------------------------------------------

export const LOCAL_MEMORY_DIR = path.join(
  process.env.HOME || "/Users/christaylor",
  "Projects/chris-assistant/memory",
);

/** Ensure the local memory directory exists. Called once on boot. */
export async function ensureLocalMemoryDir(): Promise<void> {
  await mkdir(LOCAL_MEMORY_DIR, { recursive: true });
  console.log("[recall] Local memory dir ready: %s", LOCAL_MEMORY_DIR);
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Find memory files relevant to a query by scanning headers and scoring
 * them against the query using keyword matching.
 *
 * Returns up to 5 relevant memories with their content read from disk.
 * Gracefully returns [] on any failure — never blocks the conversation.
 */
export async function findRelevantMemories(
  query: string,
  memoryDir: string = LOCAL_MEMORY_DIR,
): Promise<RelevantMemory[]> {
  const memories = await scanMemoryFiles(memoryDir);
  if (memories.length === 0) {
    return [];
  }

  const selected = selectRelevantMemories(query, memories);
  if (selected.length === 0) {
    return [];
  }

  // Read full content of selected files
  const results = await Promise.allSettled(
    selected.map(async (m): Promise<RelevantMemory> => {
      const content = await readFile(m.filePath, "utf-8");
      return { path: m.filePath, mtimeMs: m.mtimeMs, content };
    }),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<RelevantMemory> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);
}

/**
 * Format recalled memories into a context block for prompt injection.
 * Includes staleness caveats for memories >1 day old.
 */
export function formatRecalledMemories(memories: RelevantMemory[]): string {
  if (memories.length === 0) return "";

  const parts = memories.map((m) => {
    const filename = path.basename(m.path);
    const freshness = memoryFreshnessText(m.mtimeMs);
    const header = freshness
      ? `### ${filename}\n> ${freshness}\n`
      : `### ${filename}\n`;
    return header + m.content;
  });

  return `# Recalled Memories\n\nThe following memories were selected as relevant to this query.\n\n${parts.join("\n\n---\n\n")}`;
}

// ---------------------------------------------------------------------------
// Keyword-based relevance scoring
// ---------------------------------------------------------------------------

/** Common words to ignore when scoring. */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "neither", "each", "every", "all", "any", "few", "more", "most",
  "other", "some", "such", "no", "only", "own", "same", "than", "too",
  "very", "just", "about", "above", "after", "again", "against", "at",
  "before", "below", "between", "by", "down", "during", "for", "from",
  "in", "into", "of", "off", "on", "out", "over", "through", "to",
  "under", "until", "up", "with", "what", "which", "who", "whom",
  "this", "that", "these", "those", "i", "me", "my", "we", "our",
  "you", "your", "he", "him", "his", "she", "her", "it", "its",
  "they", "them", "their", "how", "when", "where", "why",
]);

/** Time-related query patterns that should boost summary files. */
const TIME_PATTERNS = [
  /\b(?:yesterday|last\s+week|last\s+month|ago|recent|previous|earlier|before)\b/i,
  /\b(?:what|when)\s+(?:did|were|was)\s+(?:we|i|you)\b/i,
  /\b(?:talked?\s+about|discussed?|worked?\s+on|happened)\b/i,
  /\b(?:couple|few)\s+(?:of\s+)?(?:days?|weeks?|months?)\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/,
];

/**
 * Extract meaningful tokens from text for scoring.
 * Lowercases, strips punctuation, removes stop words.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Score a memory against a query using keyword overlap + bonuses.
 */
function scoreMemory(query: string, queryTokens: string[], memory: MemoryHeader): number {
  // Build searchable text from filename + description
  const memText = [memory.filename, memory.description || ""].join(" ");
  const memTokens = new Set(tokenize(memText));

  // Base score: proportion of query tokens found in memory text
  let matchCount = 0;
  for (const token of queryTokens) {
    if (memTokens.has(token)) {
      matchCount++;
    }
    // Also check for partial matches (e.g. "project" matches "projects")
    else {
      for (const memToken of memTokens) {
        if (memToken.startsWith(token) || token.startsWith(memToken)) {
          matchCount += 0.5;
          break;
        }
      }
    }
  }

  if (matchCount === 0) return 0;

  let score = matchCount / queryTokens.length;

  // Boost summaries for time-related queries
  const isTimeQuery = TIME_PATTERNS.some((p) => p.test(query));
  if (isTimeQuery && memory.filename.startsWith("summaries/")) {
    score += 0.3;
  }

  // Slight recency boost (newer files score marginally higher)
  const ageInDays = (Date.now() - memory.mtimeMs) / 86_400_000;
  if (ageInDays < 7) score += 0.1;
  else if (ageInDays < 30) score += 0.05;

  return score;
}

/**
 * Select the most relevant memories using keyword scoring.
 * Returns up to 5 memories with a minimum relevance threshold.
 */
function selectRelevantMemories(
  query: string,
  memories: MemoryHeader[],
): MemoryHeader[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    // Generic query (e.g. "hey") — return nothing rather than guessing
    return [];
  }

  const scored = memories
    .map((m) => ({ memory: m, score: scoreMemory(query, queryTokens, m) }))
    .filter((s) => s.score > 0.15) // Minimum relevance threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (scored.length > 0) {
    console.log(
      "[recall] Selected %d memories (top: %s @ %.2f)",
      scored.length,
      scored[0].memory.filename,
      scored[0].score,
    );
  }

  return scored.map((s) => s.memory);
}
