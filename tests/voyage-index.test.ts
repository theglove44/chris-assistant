/**
 * Tests for the Voyage AI embedding index.
 *
 * The Voyage API is mocked so tests run offline with no API key needed.
 * We verify: index build, single-entry updates, cosine similarity ranking,
 * the semantic recall threshold, time-query boosting, and graceful failure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemoryHeader } from "../src/domain/memory/memory-scan.js";

// ---------------------------------------------------------------------------
// Mock fetch globally before importing the module under test
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock fs/promises so readFile returns predictable content
vi.mock("fs/promises", () => ({
  readFile: vi.fn(async (filePath: string) => `content of ${filePath}`),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import {
  buildVoyageIndex,
  initVoyageKey,
  isVoyageReady,
  semanticRecall,
  updateVoyageEntry,
  _resetIndexForTesting,
} from "../src/domain/memory/voyage-index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function header(filename: string, filePath = `/tmp/${filename}`): MemoryHeader {
  return {
    filename,
    filePath,
    mtimeMs: Date.now(),
    description: `Description for ${filename}`,
    type: "reference",
  };
}

/**
 * Build a normalised one-hot vector of `dim` dimensions with a 1 at `hot`.
 * cos_similarity(oneHot(i), oneHot(j)) = 1 when i===j, 0 otherwise.
 */
function oneHot(hot: number, dim = 8): number[] {
  return Array.from({ length: dim }, (_, i) => (i === hot ? 1 : 0));
}

/** Make fetch return a Voyage-shaped embedding response for `vectors`. */
function mockEmbedResponse(vectors: number[][]): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: vectors.map((embedding, index) => ({ index, embedding })),
    }),
  } as Response);
}

/** Make fetch return an API error. */
function mockEmbedError(status = 500): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => "Internal Server Error",
  } as Response);
}

// ---------------------------------------------------------------------------
// Full reset before each test — clears index AND key, then reinitialises
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  _resetIndexForTesting();
  initVoyageKey("test-voyage-key");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isVoyageReady", () => {
  it("returns false before index is built", () => {
    expect(isVoyageReady()).toBe(false);
  });

  it("returns true after index is built with documents", async () => {
    mockEmbedResponse([oneHot(0)]);
    await buildVoyageIndex([header("test.md")]);
    expect(isVoyageReady()).toBe(true);
  });

  it("returns false when key is not set", async () => {
    _resetIndexForTesting(); // clears both index and key
    // buildVoyageIndex should be a no-op without key
    await buildVoyageIndex([header("test.md")]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(isVoyageReady()).toBe(false);
  });
});

describe("buildVoyageIndex", () => {
  it("embeds documents and populates the index", async () => {
    mockEmbedResponse([oneHot(0), oneHot(1)]);
    await buildVoyageIndex([header("a.md"), header("b.md")]);
    expect(isVoyageReady()).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does nothing when called with an empty list", async () => {
    await buildVoyageIndex([]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(isVoyageReady()).toBe(false);
  });

  it("does not wipe the existing index on API failure", async () => {
    // Build a valid index first
    mockEmbedResponse([oneHot(0)]);
    await buildVoyageIndex([header("good.md")]);
    expect(isVoyageReady()).toBe(true);

    // Attempt a rebuild that fails — old index should survive
    mockEmbedError();
    await buildVoyageIndex([header("bad.md")]);
    expect(isVoyageReady()).toBe(true);
  });
});

describe("updateVoyageEntry", () => {
  it("adds a new entry to the index", async () => {
    // Build initial index: existing.md at dim0
    mockEmbedResponse([oneHot(0)]);
    await buildVoyageIndex([header("existing.md")]);

    // Add new.md at dim1
    mockEmbedResponse([oneHot(1)]);
    await updateVoyageEntry(header("new.md", "/tmp/new.md"));

    // Query at dim1 — should find new.md (similarity=1) but not existing.md (similarity=0)
    mockEmbedResponse([oneHot(1)]);
    const results = await semanticRecall("query", 5, 0.5);
    expect(results.some((r) => r.filename === "new.md")).toBe(true);
    expect(results.some((r) => r.filename === "existing.md")).toBe(false);
  });

  it("replaces an existing entry without duplicating it", async () => {
    const h = header("updatable.md", "/tmp/updatable.md");

    // Index at dim0
    mockEmbedResponse([oneHot(0)]);
    await buildVoyageIndex([h]);

    // Update same file — re-embed at dim2
    mockEmbedResponse([oneHot(2)]);
    await updateVoyageEntry(h);

    // Query at dim2 — exactly one result for updatable.md
    mockEmbedResponse([oneHot(2)]);
    const results = await semanticRecall("query", 5, 0.5);
    const matches = results.filter((r) => r.filename === "updatable.md");
    expect(matches).toHaveLength(1);
  });
});

describe("semanticRecall", () => {
  it("returns the most similar document first", async () => {
    // trading=dim0, weather=dim1, cooking=dim2
    mockEmbedResponse([oneHot(0), oneHot(1), oneHot(2)]);
    await buildVoyageIndex([
      header("trading.md"),
      header("weather.md"),
      header("cooking.md"),
    ]);

    // Query at dim0 — trading should rank first with similarity=1
    mockEmbedResponse([oneHot(0)]);
    const results = await semanticRecall("trading options XSP", 5, 0.5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filename).toBe("trading.md");
  });

  it("filters out documents below the similarity threshold", async () => {
    // doc.md at dim0; query at dim1 — cosine similarity = 0
    mockEmbedResponse([oneHot(0)]);
    await buildVoyageIndex([header("doc.md")]);

    // Threshold 0.5, similarity 0 — should filter out
    mockEmbedResponse([oneHot(1)]);
    const results = await semanticRecall("unrelated query", 5, 0.5);
    expect(results).toHaveLength(0);
  });

  it("returns empty array gracefully on query API failure", async () => {
    mockEmbedResponse([oneHot(0)]);
    await buildVoyageIndex([header("doc.md")]);

    mockEmbedError();
    const results = await semanticRecall("any query");
    expect(results).toEqual([]);
  });

  it("returns empty array without calling API when index is empty", async () => {
    // No buildVoyageIndex call — isVoyageReady() = false
    const results = await semanticRecall("any query");
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("boosts summary files for time-related queries", async () => {
    // summary has slightly higher raw similarity + gets +0.05 time boost
    const summaryVec = [0.9, 0.1, 0, 0, 0, 0, 0, 0];
    const learningsVec = [0.85, 0.15, 0, 0, 0, 0, 0, 0];
    mockEmbedResponse([summaryVec, learningsVec]);
    await buildVoyageIndex([
      header("summaries/2026-04-10.md", "/tmp/summaries/2026-04-10.md"),
      header("learnings.md", "/tmp/learnings.md"),
    ]);

    // Time-query triggers the boost — summary should rank first
    mockEmbedResponse([[1, 0, 0, 0, 0, 0, 0, 0]]);
    const results = await semanticRecall("what did we discuss last week", 5, 0.5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filename).toBe("summaries/2026-04-10.md");
  });

  it("respects the topK limit", async () => {
    // 4 docs all at dim0 (identical vectors, similarity=1)
    mockEmbedResponse([oneHot(0), oneHot(0), oneHot(0), oneHot(0)]);
    await buildVoyageIndex([
      header("a.md"), header("b.md"), header("c.md"), header("d.md"),
    ]);

    mockEmbedResponse([oneHot(0)]);
    const results = await semanticRecall("query", 2, 0.5);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
