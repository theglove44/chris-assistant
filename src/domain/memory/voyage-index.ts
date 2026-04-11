/**
 * Voyage AI embedding index for semantic memory recall.
 *
 * On boot, embeds all memory .md files using voyage-3-lite and stores the
 * resulting vectors in memory. At query time, the incoming message is embedded
 * and ranked by cosine similarity against the index — returning semantically
 * relevant memories even when the exact words don't match.
 *
 * Falls back gracefully to an empty result on any API failure, so the caller
 * can fall back to keyword scoring without disrupting the conversation.
 *
 * Usage:
 *   - Call buildVoyageIndex() once at boot (after ensureLocalMemoryDir)
 *   - Call updateVoyageEntry() after any update_memory write
 *   - Call semanticRecall() instead of the keyword scorer
 */

import { readFile } from "fs/promises";
import type { MemoryHeader } from "./memory-scan.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndexEntry {
  header: MemoryHeader;
  vector: number[];
}

// ---------------------------------------------------------------------------
// In-memory index
// ---------------------------------------------------------------------------

let index: IndexEntry[] = [];
let voyageApiKey: string | null = null;

/** Initialise the Voyage API key. Called once at boot. */
export function initVoyageKey(key: string): void {
  voyageApiKey = key;
}

/** Returns true if the index has been built and Voyage is configured. */
export function isVoyageReady(): boolean {
  return voyageApiKey !== null && index.length > 0;
}

/** Reset internal state — for testing only. */
export function _resetIndexForTesting(): void {
  index = [];
  voyageApiKey = null;
}

// ---------------------------------------------------------------------------
// Voyage API
// ---------------------------------------------------------------------------

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite";
const BATCH_SIZE = 20; // Voyage accepts up to 128 inputs per request

/**
 * Embed one or more texts via Voyage AI.
 * inputType: "document" for indexing, "query" for search queries.
 * Returns one vector per input text.
 */
async function embedTexts(
  texts: string[],
  inputType: "document" | "query",
): Promise<number[][]> {
  if (!voyageApiKey) throw new Error("Voyage API key not set");
  if (texts.length === 0) return [];

  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${voyageApiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Voyage API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    data: Array<{ index: number; embedding: number[] }>;
  };

  // Re-order by index to match input order
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

/**
 * Build the full index from a list of memory file headers.
 * Reads each file's content, batches embedding requests, and stores vectors.
 * Safe to call multiple times — replaces the existing index on each call.
 */
export async function buildVoyageIndex(headers: MemoryHeader[]): Promise<void> {
  if (!voyageApiKey || headers.length === 0) return;

  try {
    // Read all file contents
    const contents = await Promise.all(
      headers.map(async (h) => {
        try {
          return await readFile(h.filePath, "utf-8");
        } catch {
          return "";
        }
      }),
    );

    // Filter out files that failed to read
    const valid = headers
      .map((h, i) => ({ header: h, text: contents[i]! }))
      .filter((e) => e.text.length > 0);

    if (valid.length === 0) return;

    // Batch embed all documents
    const allVectors: number[][] = [];
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      const vectors = await embedTexts(
        batch.map((e) => e.text),
        "document",
      );
      allVectors.push(...vectors);
    }

    index = valid.map((e, i) => ({
      header: e.header,
      vector: allVectors[i]!,
    }));

    console.log("[voyage] Index built: %d documents", index.length);
  } catch (err) {
    console.warn(
      "[voyage] Failed to build index:",
      err instanceof Error ? err.message : err,
    );
    // Leave existing index intact — don't wipe it on transient failure
  }
}

/**
 * Update a single entry in the index after a memory file is written.
 * Adds if new, replaces if existing.
 */
export async function updateVoyageEntry(header: MemoryHeader): Promise<void> {
  if (!voyageApiKey) return;

  try {
    const text = await readFile(header.filePath, "utf-8");
    if (!text) return;

    const [vector] = await embedTexts([text], "document");
    if (!vector) return;

    const existingIdx = index.findIndex(
      (e) => e.header.filePath === header.filePath,
    );
    if (existingIdx >= 0) {
      index[existingIdx] = { header, vector };
    } else {
      index.push({ header, vector });
    }

    console.log("[voyage] Index entry updated: %s", header.filename);
  } catch (err) {
    console.warn(
      "[voyage] Failed to update entry %s:",
      header.filename,
      err instanceof Error ? err.message : err,
    );
  }
}

// ---------------------------------------------------------------------------
// Semantic recall
// ---------------------------------------------------------------------------

/** Cosine similarity between two vectors. Returns value in [-1, 1]. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Time-related query patterns — boost summaries files for temporal queries. */
const TIME_PATTERNS = [
  /\b(?:yesterday|last\s+week|last\s+month|ago|recent|previous|earlier|before)\b/i,
  /\b(?:what|when)\s+(?:did|were|was)\s+(?:we|i|you)\b/i,
  /\b(?:talked?\s+about|discussed?|worked?\s+on|happened)\b/i,
  /\b(?:couple|few)\s+(?:of\s+)?(?:days?|weeks?|months?)\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/,
];

/**
 * Find the most semantically relevant memory headers for a query.
 * Returns up to 5 results above the similarity threshold.
 * Returns [] on any failure — caller should fall back to keyword scoring.
 */
export async function semanticRecall(
  query: string,
  topK = 5,
  threshold = 0.5,
): Promise<MemoryHeader[]> {
  if (!voyageApiKey || index.length === 0) return [];

  try {
    const [queryVector] = await embedTexts([query], "query");
    if (!queryVector) return [];

    const isTimeQuery = TIME_PATTERNS.some((p) => p.test(query));

    const scored = index
      .map((entry) => {
        let score = cosineSimilarity(queryVector, entry.vector);
        // Boost summary files for time-related queries (mirrors keyword scorer)
        if (isTimeQuery && entry.header.filename.startsWith("summaries/")) {
          score += 0.05;
        }
        return { header: entry.header, score };
      })
      .filter((s) => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (scored.length > 0) {
      console.log(
        "[voyage] Semantic recall: %d results (top: %s @ %.3f)",
        scored.length,
        scored[0]!.header.filename,
        scored[0]!.score,
      );
    }

    return scored.map((s) => s.header);
  } catch (err) {
    console.warn(
      "[voyage] Semantic recall failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
