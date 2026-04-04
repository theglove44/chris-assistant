/**
 * Sonnet-powered memory recall.
 *
 * On every user message, scans the local memory/ directory for .md file
 * headers, sends them + the user query to Sonnet 4.6 via the Agent SDK,
 * and returns the content of the top 5 most relevant files for injection
 * into context.
 *
 * Uses the Agent SDK's query() for the side-call so it shares the same
 * OAuth auth as the main conversation — no separate API key needed.
 *
 * The side-call is cheap: ~500 tokens in, ~50 tokens out per query.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readFile } from "fs/promises";
import * as path from "path";
import { memoryFreshnessText } from "./memory-age.js";
import {
  type MemoryHeader,
  formatMemoryManifest,
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
// Selector prompt
// ---------------------------------------------------------------------------

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to an AI assistant as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return ONLY a JSON object with a "selected_memories" array of filenames for the memories that will clearly be useful (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful, do not include it.
- If no memories are clearly useful, return an empty array.
- Be selective and discerning.
- Return raw JSON only, no markdown fences or extra text.`;

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
 * Find memory files relevant to a query by scanning memory file headers
 * and asking Sonnet to select the most relevant ones.
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

  const selectedFilenames = await selectRelevantMemories(query, memories);
  const byFilename = new Map(memories.map((m) => [m.filename, m]));

  const selected = selectedFilenames
    .map((filename) => byFilename.get(filename))
    .filter((m): m is MemoryHeader => m !== undefined);

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
// Internals
// ---------------------------------------------------------------------------

async function selectRelevantMemories(
  queryText: string,
  memories: MemoryHeader[],
): Promise<string[]> {
  const validFilenames = new Set(memories.map((m) => m.filename));
  const manifest = formatMemoryManifest(memories);

  try {
    const userPrompt = `Query: ${queryText}\n\nAvailable memories:\n${manifest}`;

    let resultText = "";
    const conversation = query({
      prompt: userPrompt,
      options: {
        model: "claude-sonnet-4-6-20250514",
        systemPrompt: SELECT_MEMORIES_SYSTEM_PROMPT,
        maxTurns: 1,
        tools: [],
        allowedTools: [],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        persistSession: false,
      },
    });

    for await (const message of conversation) {
      if (message.type === "result" && message.subtype === "success") {
        resultText = message.result;
      }
    }

    if (!resultText) return [];

    // Strip markdown fences if present
    const cleaned = resultText.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
    const parsed: { selected_memories: string[] } = JSON.parse(cleaned);
    return parsed.selected_memories.filter((f) => validFilenames.has(f));
  } catch (e) {
    console.warn("[recall] selectRelevantMemories failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
