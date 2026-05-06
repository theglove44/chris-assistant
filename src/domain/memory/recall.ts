/**
 * Memory recall — selects relevant memory files per user query.
 *
 * On every user message, scans the local memory/ directory for .md files
 * with YAML frontmatter, scores them against the query and returns the top 5
 * most relevant files for context injection.
 *
 * Primary path: Voyage AI semantic embeddings (voyage-3-lite) — requires
 * VOYAGE_API_KEY. Understands meaning, not just word overlap.
 *
 * Fallback path: Local keyword scoring — zero latency, zero cost, no auth.
 * Used automatically when Voyage is unavailable or returns no results.
 */

import { mkdir, readFile } from "fs/promises";
import * as path from "path";
import { memoryFreshnessText } from "./memory-age.js";
import {
  type MemoryHeader,
  scanMemoryFiles,
} from "./memory-scan.js";
import {
  buildVoyageIndex,
  initVoyageKey,
  isVoyageReady,
  semanticRecall,
} from "./voyage-index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelevantMemory {
  path: string;
  mtimeMs: number;
  content: string;
}

type RecallIntent = "none" | "personal" | "project";

// ---------------------------------------------------------------------------
// Memory directory
// ---------------------------------------------------------------------------

export const LOCAL_MEMORY_DIR = path.join(
  process.env.HOME || "/Users/christaylor",
  "Projects/chris-assistant/memory",
);

/**
 * Ensure the local memory directory exists and initialise the Voyage index.
 * Called once on boot. Voyage index build is fire-and-forget — any failure
 * is logged and the system falls back to keyword scoring automatically.
 */
export async function ensureLocalMemoryDir(): Promise<void> {
  await mkdir(LOCAL_MEMORY_DIR, { recursive: true });
  console.log("[recall] Local memory dir ready: %s", LOCAL_MEMORY_DIR);

  const voyageKey = process.env.VOYAGE_API_KEY;
  if (voyageKey) {
    initVoyageKey(voyageKey);
    // Build index in background — don't block boot
    scanMemoryFiles(LOCAL_MEMORY_DIR)
      .then((headers) => buildVoyageIndex(headers))
      .catch((e) => console.warn("[recall] Voyage index build failed:", e instanceof Error ? e.message : e));
  } else {
    console.log("[recall] No VOYAGE_API_KEY — using keyword scoring");
  }
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Find memory files relevant to a query.
 *
 * Uses Voyage AI semantic embeddings when available (VOYAGE_API_KEY set and
 * index built). Falls back to keyword scoring if Voyage is not ready or
 * returns no results above threshold.
 *
 * Returns up to 5 relevant memories with their content read from disk.
 * Gracefully returns [] on any failure — never blocks the conversation.
 */
export async function findRelevantMemories(
  query: string,
  memoryDir: string = LOCAL_MEMORY_DIR,
): Promise<RelevantMemory[]> {
  const intent = recallIntent(query);
  if (intent === "none") {
    return [];
  }

  const memories = await scanMemoryFiles(memoryDir);
  if (memories.length === 0) {
    return [];
  }

  // Try semantic recall first; fall back to keyword scoring if unavailable
  let selected: MemoryHeader[];
  if (isVoyageReady()) {
    selected = await semanticRecall(query);
    selected = filterMemoriesByIntent(query, selected, intent);
    if (selected.length === 0) {
      // Voyage returned nothing usable for this turn — fall back to keyword scorer.
      console.log("[recall] Semantic recall yielded no relevant results, falling back to keyword scoring");
      selected = selectRelevantMemories(query, memories, intent);
    }
  } else {
    selected = selectRelevantMemories(query, memories, intent);
  }

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

const EXPLICIT_MEMORY_PATTERNS = [
  /\b(?:remember|recall|memory|memories|know about me|about me)\b/i,
  /\b(?:what|who)\s+(?:do|did)\s+you\s+(?:remember|know)\b/i,
  /\b(?:what|when)\s+(?:did|were|was)\s+(?:we|i|you)\b/i,
  /\b(?:talked?\s+about|discussed?|worked?\s+on|happened)\b/i,
  /\b(?:yesterday|last\s+week|last\s+month|recently|previously|earlier)\b/i,
  /\bdebug yourself\b/i,
];

const PROJECT_CONTEXT_PATTERNS = [
  /\b(?:my|our|this|the)\s+(?:project|repo|repository|codebase|app|agent|assistant|bot)\b/i,
  /\b(?:project|repo|repository|codebase|issue|pr|pull request|branch|sprint)\s+(?:we|i|you|chris)\b/i,
  /\bchris-assistant\b/i,
  /\btrading agent\b/i,
];

const GENERIC_HELP_PATTERNS = [
  /^(?:what|how|why|when|where|can|could|should|would|is|are|does|do)\b/i,
  /\b(?:explain|define|summarize|compare|recommend|help me|show me|tell me)\b/i,
];

function recallIntent(query: string): RecallIntent {
  const normalized = query.trim();
  if (!normalized) return "none";

  const wantsMemory = EXPLICIT_MEMORY_PATTERNS.some((p) => p.test(normalized));
  const wantsProject = PROJECT_CONTEXT_PATTERNS.some((p) => p.test(normalized));
  if (wantsProject) return "project";
  if (wantsMemory) return "personal";

  const tokens = tokenize(normalized);
  if (tokens.length < 4) return "none";

  // General help questions should not pull project memories just because an
  // embedding or keyword overlaps with one remembered project.
  if (GENERIC_HELP_PATTERNS.some((p) => p.test(normalized))) {
    return "none";
  }

  return "personal";
}

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
function scoreMemory(query: string, queryTokens: string[], memory: MemoryHeader, intent: RecallIntent): number {
  if (!memoryAllowedForIntent(query, memory, intent)) return 0;

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
  intent: RecallIntent,
): MemoryHeader[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    // Generic query (e.g. "hey") — return nothing rather than guessing
    return [];
  }

  const scored = memories
    .map((m) => ({ memory: m, score: scoreMemory(query, queryTokens, m, intent) }))
    .filter((s) => s.score > 0.3) // Minimum relevance threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, intent === "project" ? 3 : 2);

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

function filterMemoriesByIntent(query: string, memories: MemoryHeader[], intent: RecallIntent): MemoryHeader[] {
  return memories
    .filter((memory) => memoryAllowedForIntent(query, memory, intent))
    .slice(0, intent === "project" ? 3 : 2);
}

function memoryAllowedForIntent(query: string, memory: MemoryHeader, intent: RecallIntent): boolean {
  if (intent === "none") return false;
  if (intent === "project") return true;

  if (memory.type === "project" || memory.type === "reference") {
    return hasDirectMemoryNameOverlap(query, memory);
  }

  return true;
}

function hasDirectMemoryNameOverlap(query: string, memory: MemoryHeader): boolean {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return false;

  const memoryTokens = tokenize([memory.filename, memory.description || ""].join(" "));
  return memoryTokens.some((token) => queryTokens.has(token));
}
