/**
 * Memory-directory scanning primitives.
 *
 * Scans a local memory/ directory for .md files, reads their YAML
 * frontmatter headers, and returns a manifest for the recall selector.
 *
 * Adapted from Claude Code's memoryScan.ts blueprint.
 */

import { readdir, stat, readFile } from "fs/promises";
import { basename, join } from "path";
import { parse as parseYaml } from "yaml";

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryHeader {
  filename: string;
  filePath: string;
  mtimeMs: number;
  description: string | null;
  type: MemoryType | undefined;
}

const MAX_MEMORY_FILES = 200;
const FRONTMATTER_BYTES = 2048; // read first 2KB — enough for any frontmatter

const VALID_TYPES = new Set<MemoryType>(["user", "feedback", "project", "reference"]);

function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== "string") return undefined;
  return VALID_TYPES.has(raw as MemoryType) ? (raw as MemoryType) : undefined;
}

/**
 * Parse YAML frontmatter from the beginning of a markdown file.
 * Returns name, description, and type if present.
 */
function parseFrontmatter(content: string): { description?: string; type?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    const parsed = parseYaml(match[1]);
    if (typeof parsed !== "object" || parsed === null) return {};
    return {
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      type: typeof parsed.type === "string" ? parsed.type : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Scan a memory directory for .md files, read their frontmatter, and return
 * a header list sorted newest-first (capped at MAX_MEMORY_FILES).
 * Skips MEMORY.md (the index file).
 */
export async function scanMemoryFiles(memoryDir: string): Promise<MemoryHeader[]> {
  try {
    const entries = await readdir(memoryDir, { recursive: true });
    const mdFiles = entries.filter(
      (f) => f.endsWith(".md") && basename(f) !== "MEMORY.md",
    );

    const headerResults = await Promise.allSettled(
      mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
        const filePath = join(memoryDir, relativePath);
        const [fileStat, buffer] = await Promise.all([
          stat(filePath),
          readFile(filePath, { encoding: "utf-8", flag: "r" }).then((s) =>
            s.slice(0, FRONTMATTER_BYTES),
          ),
        ]);
        const fm = parseFrontmatter(buffer);
        return {
          filename: relativePath,
          filePath,
          mtimeMs: fileStat.mtimeMs,
          description: fm.description || null,
          type: parseMemoryType(fm.type),
        };
      }),
    );

    return headerResults
      .filter(
        (r): r is PromiseFulfilledResult<MemoryHeader> => r.status === "fulfilled",
      )
      .map((r) => r.value)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_MEMORY_FILES);
  } catch {
    return [];
  }
}

/**
 * Format memory headers as a text manifest for the recall selector prompt.
 * One line per file: [type] filename (timestamp): description
 */
export function formatMemoryManifest(memories: MemoryHeader[]): string {
  return memories
    .map((m) => {
      const tag = m.type ? `[${m.type}] ` : "";
      const ts = new Date(m.mtimeMs).toISOString();
      return m.description
        ? `- ${tag}${m.filename} (${ts}): ${m.description}`
        : `- ${tag}${m.filename} (${ts})`;
    })
    .join("\n");
}
