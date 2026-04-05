#!/usr/bin/env npx tsx
/**
 * One-time backfill: pull existing data from the GitHub memory repo and
 * write local recall files so the Sonnet recall system has historical context.
 *
 * Backfills:
 *   1. All daily conversation summaries → memory/summaries/{date}.md
 *   2. Current knowledge files (USER.md) → memory/ topic files
 *   3. Current memory files (learnings.md) → memory/ topic files
 *
 * Safe to run multiple times — overwrites existing local files.
 *
 * Usage:
 *   npx tsx scripts/backfill-local-memory.ts
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";
import os from "os";
import { listMemoryDir, readMemoryFile } from "../src/domain/memory/repository.js";

const MEMORY_DIR = path.join(
  process.env.HOME || os.homedir(),
  "Projects/chris-assistant/memory",
);

const SUMMARIES_DIR = path.join(MEMORY_DIR, "summaries");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .slice(0, 60)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40) || "entry";
}

function firstLine(text: string): string {
  const line = text
    .split("\n")
    .find((l) => l.trim().length > 0 && !l.startsWith("#") && !l.startsWith("<!--"))
    || text.split("\n").find((l) => l.trim().length > 0)
    || "";
  const cleaned = line.replace(/^[-*•#]\s*/g, "").replace(/\*\*/g, "").trim();
  return cleaned.length > 120 ? cleaned.slice(0, 117) + "..." : cleaned;
}

async function writeLocalFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Backfill summaries
// ---------------------------------------------------------------------------

async function backfillSummaries(): Promise<number> {
  console.log("\n📦 Backfilling daily conversation summaries...");

  const files = await listMemoryDir("conversations/summaries");
  if (files.length === 0) {
    console.log("   No summaries found in repo.");
    return 0;
  }

  console.log("   Found %d summary files in GitHub repo", files.length);
  let count = 0;

  for (const repoPath of files) {
    const filename = path.basename(repoPath);
    const date = filename.replace(".md", "");

    const content = await readMemoryFile(repoPath);
    if (!content) continue;

    const description = firstLine(content.replace(/^#.*\n+/, ""));
    const localPath = path.join(SUMMARIES_DIR, filename);

    const fileContent = `---
name: conversation summary ${date}
description: ${description}
type: reference
---

${content}
`;
    await writeLocalFile(localPath, fileContent);
    count++;
    process.stdout.write(`   ✓ ${date}\n`);
  }

  console.log("   Wrote %d summary files", count);
  return count;
}

// ---------------------------------------------------------------------------
// Backfill knowledge files (USER.md → individual entries)
// ---------------------------------------------------------------------------

/**
 * Split a monolithic memory file (USER.md, learnings.md) into individual
 * topic files based on <!-- Updated: YYYY-MM-DD --> markers.
 */
function splitByTimestampMarkers(
  content: string,
  category: string,
  type: string,
): Array<{ filename: string; content: string }> {
  // Split on the timestamp comment markers that update_memory adds
  const chunks = content.split(/(?=<!-- Updated: \d{4}-\d{2}-\d{2} -->)/);
  const results: Array<{ filename: string; content: string }> = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed.length < 10) continue;

    // Extract date from marker if present
    const dateMatch = trimmed.match(/<!-- Updated: (\d{4}-\d{2}-\d{2}) -->/);
    const date = dateMatch ? dateMatch[1] : "unknown";

    // Content without the marker
    const body = trimmed.replace(/<!-- Updated: \d{4}-\d{2}-\d{2} -->\s*/, "").trim();
    if (!body) continue;

    const slug = slugify(body);
    const description = firstLine(body);
    const filename = `${category}_${date}_${slug}.md`;

    const fileContent = `---
name: ${category} — ${slug.replace(/-/g, " ")}
description: ${description}
type: ${type}
---

${body}
`;
    results.push({ filename, content: fileContent });
  }

  return results;
}

async function backfillKnowledgeFile(
  repoPath: string,
  category: string,
  type: string,
): Promise<number> {
  const content = await readMemoryFile(repoPath);
  if (!content) {
    console.log("   %s: not found in repo", repoPath);
    return 0;
  }

  const entries = splitByTimestampMarkers(content, category, type);
  if (entries.length === 0) {
    // No timestamp markers — write as single file
    const slug = slugify(content);
    const description = firstLine(content);
    const filename = `${category}_bulk_${slug}.md`;
    const localPath = path.join(MEMORY_DIR, filename);
    const fileContent = `---
name: ${category} — bulk import
description: ${description}
type: ${type}
---

${content}
`;
    await writeLocalFile(localPath, fileContent);
    console.log("   %s: wrote 1 bulk file (no timestamp markers found)", repoPath);
    return 1;
  }

  let count = 0;
  for (const entry of entries) {
    const localPath = path.join(MEMORY_DIR, entry.filename);
    await writeLocalFile(localPath, entry.content);
    count++;
  }
  console.log("   %s: wrote %d topic files", repoPath, count);
  return count;
}

async function backfillKnowledge(): Promise<number> {
  console.log("\n📦 Backfilling knowledge and memory files...");
  let total = 0;
  total += await backfillKnowledgeFile("USER.md", "about-chris", "user");
  total += await backfillKnowledgeFile("memory/learnings.md", "learnings", "feedback");
  return total;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("🔄 Backfilling local memory files for Sonnet recall");
  console.log("   Source: GitHub memory repo");
  console.log("   Target: %s", MEMORY_DIR);

  await mkdir(MEMORY_DIR, { recursive: true });
  await mkdir(SUMMARIES_DIR, { recursive: true });

  const summaryCount = await backfillSummaries();
  const knowledgeCount = await backfillKnowledge();

  console.log("\n✅ Backfill complete: %d summary files + %d knowledge files", summaryCount, knowledgeCount);
  console.log("   Sonnet recall will now have full historical context.");
}

main().catch((err) => {
  console.error("❌ Backfill failed:", err.message);
  process.exit(1);
});
