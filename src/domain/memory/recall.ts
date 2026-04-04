/**
 * Sonnet-powered memory recall.
 *
 * On every user message, scans the local memory/ directory for .md file
 * headers, sends them + the user query to Sonnet 4.6, and returns the
 * content of the top 5 most relevant files for injection into context.
 *
 * The side-call is cheap: ~500 tokens in, ~50 tokens out per query.
 *
 * Adapted from Claude Code's findRelevantMemories.ts blueprint.
 */

import Anthropic from "@anthropic-ai/sdk";
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
// Sonnet client (lazy singleton)
// ---------------------------------------------------------------------------

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    // The project uses OAuth (CLAUDE_CODE_OAUTH_TOKEN) for the Agent SDK,
    // not a standard API key. Pass it as authToken for the Messages API.
    const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (oauthToken) {
      client = new Anthropic({ authToken: oauthToken });
    } else {
      // Falls back to ANTHROPIC_API_KEY if set
      client = new Anthropic();
    }
  }
  return client;
}

// ---------------------------------------------------------------------------
// Selector prompt
// ---------------------------------------------------------------------------

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to an AI assistant as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a JSON object with a "selected_memories" array of filenames for the memories that will clearly be useful (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful, do not include it.
- If no memories are clearly useful, return an empty array.
- Be selective and discerning.`;

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
  query: string,
  memories: MemoryHeader[],
): Promise<string[]> {
  const validFilenames = new Set(memories.map((m) => m.filename));
  const manifest = formatMemoryManifest(memories);

  try {
    const response = await getClient().messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 256,
      system: SELECT_MEMORIES_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Query: ${query}\n\nAvailable memories:\n${manifest}`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return [];
    }

    const parsed: { selected_memories: string[] } = JSON.parse(textBlock.text);
    return parsed.selected_memories.filter((f) => validFilenames.has(f));
  } catch (e) {
    console.warn("[recall] selectRelevantMemories failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
