import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/domain/memory/voyage-index.js", () => ({
  buildVoyageIndex: vi.fn(),
  initVoyageKey: vi.fn(),
  isVoyageReady: vi.fn(() => false),
  semanticRecall: vi.fn(),
}));

import { findRelevantMemories } from "../src/domain/memory/recall.js";

let memoryDir: string | null = null;

async function makeMemoryDir(): Promise<string> {
  memoryDir = await mkdtemp(join(tmpdir(), "chris-memory-recall-"));
  return memoryDir;
}

async function writeMemory(relativePath: string, frontmatter: string, body: string): Promise<void> {
  if (!memoryDir) throw new Error("memory dir not created");
  const filePath = join(memoryDir, relativePath);
  await writeFile(filePath, `---\n${frontmatter}\n---\n\n${body}`);
}

afterEach(async () => {
  if (memoryDir) {
    await rm(memoryDir, { recursive: true, force: true });
    memoryDir = null;
  }
});

describe("memory recall gating", () => {
  it("does not inject project memories for generic technical questions", async () => {
    const dir = await makeMemoryDir();
    await writeMemory(
      "trading-agent.md",
      "type: project\ndescription: Trading Agent TypeScript service architecture and broker integration",
      "Chris is building My Trading Agent with TypeScript services.",
    );

    const memories = await findRelevantMemories("how should I structure a TypeScript service?", dir);

    expect(memories).toEqual([]);
  });

  it("allows project memories when the user asks for project continuity", async () => {
    const dir = await makeMemoryDir();
    await writeMemory(
      "trading-agent.md",
      "type: project\ndescription: Trading Agent TypeScript service architecture and broker integration",
      "Chris is building My Trading Agent with TypeScript services.",
    );

    const memories = await findRelevantMemories("what should you remember about my trading agent work?", dir);

    expect(memories).toHaveLength(1);
    expect(memories[0]!.content).toContain("My Trading Agent");
  });

  it("keeps personal preference recall available without broad project recall", async () => {
    const dir = await makeMemoryDir();
    await writeMemory(
      "concise-updates.md",
      "type: feedback\ndescription: Chris prefers concise engineering updates",
      "Chris prefers concise engineering updates.",
    );
    await writeMemory(
      "unrelated-project.md",
      "type: project\ndescription: Weather dashboard project and API work",
      "A separate weather dashboard project exists.",
    );

    const memories = await findRelevantMemories("what do you know about Chris preferences?", dir);

    expect(memories).toHaveLength(1);
    expect(memories[0]!.content).toContain("concise engineering updates");
  });
});
