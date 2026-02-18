import { Command } from "commander";
import { Octokit } from "@octokit/rest";
import { spawn } from "child_process";
import { writeFileSync, mkdtempSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/** All memory files and their shorthand aliases. */
const MEMORY_FILES: Record<string, string> = {
  "soul": "identity/SOUL.md",
  "rules": "identity/RULES.md",
  "voice": "identity/VOICE.md",
  "about-chris": "knowledge/about-chris.md",
  "preferences": "knowledge/preferences.md",
  "projects": "knowledge/projects.md",
  "people": "knowledge/people.md",
  "decisions": "memory/decisions.md",
  "learnings": "memory/learnings.md",
};

async function getOctokit(): Promise<{ octokit: Octokit; owner: string; repo: string }> {
  // Lazy-load dotenv so the CLI doesn't crash if other vars are missing
  await import("dotenv/config");
  const token = process.env.GITHUB_TOKEN;
  const memoryRepo = process.env.GITHUB_MEMORY_REPO;

  if (!token || !memoryRepo) {
    console.error("Missing GITHUB_TOKEN or GITHUB_MEMORY_REPO in .env");
    console.error('Run "chris setup" to configure.');
    process.exit(1);
  }

  const [owner, repo] = memoryRepo.split("/");
  return { octokit: new Octokit({ auth: token }), owner, repo };
}

function resolveFile(name: string): string | null {
  // Try exact match first
  if (MEMORY_FILES[name]) return MEMORY_FILES[name];
  // Try as a path
  const asPath = Object.values(MEMORY_FILES).find((p) => p === name || p.endsWith(`/${name}`));
  if (asPath) return asPath;
  return null;
}

export function registerMemoryCommand(program: Command) {
  const memory = program
    .command("memory")
    .description("View and manage assistant memory files");

  // chris memory status
  memory
    .command("status")
    .description("List all memory files with sizes and last-modified dates")
    .action(async () => {
      const { octokit, owner, repo } = await getOctokit();

      console.log("Memory files in %s/%s:\n", owner, repo);

      for (const [alias, path] of Object.entries(MEMORY_FILES)) {
        const label = alias.padEnd(16);
        try {
          const { data } = await octokit.repos.getContent({ owner, repo, path });
          if ("size" in data && data.type === "file") {
            const sizeKb = (data.size / 1024).toFixed(1);
            console.log("  %s %s (%s KB)", label, path, sizeKb);
          }
        } catch (err: any) {
          if (err.status === 404) {
            console.log("  %s %s (not found)", label, path);
          } else {
            console.log("  %s %s (error: %s)", label, path, err.message);
          }
        }
      }
    });

  // chris memory show <file>
  memory
    .command("show <file>")
    .description("Print a memory file (e.g. chris memory show about-chris)")
    .action(async (file: string) => {
      const path = resolveFile(file);
      if (!path) {
        console.error('Unknown memory file: "%s"', file);
        console.error("Available files:", Object.keys(MEMORY_FILES).join(", "));
        process.exit(1);
      }

      const { octokit, owner, repo } = await getOctokit();

      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path });
        if ("content" in data && data.type === "file") {
          const content = Buffer.from(data.content, "base64").toString("utf-8");
          console.log(content);
        }
      } catch (err: any) {
        if (err.status === 404) {
          console.error("File not found: %s", path);
        } else {
          console.error("Error: %s", err.message);
        }
        process.exit(1);
      }
    });

  // chris memory edit <file>
  memory
    .command("edit <file>")
    .description("Open a memory file in your $EDITOR, then push changes")
    .action(async (file: string) => {
      const path = resolveFile(file);
      if (!path) {
        console.error('Unknown memory file: "%s"', file);
        console.error("Available files:", Object.keys(MEMORY_FILES).join(", "));
        process.exit(1);
      }

      const editor = process.env.EDITOR || "nano";
      const { octokit, owner, repo } = await getOctokit();

      // Fetch current content and SHA
      let currentContent = "";
      let sha: string | undefined;
      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path });
        if ("content" in data && data.type === "file") {
          currentContent = Buffer.from(data.content, "base64").toString("utf-8");
          sha = data.sha;
        }
      } catch (err: any) {
        if (err.status !== 404) throw err;
      }

      // Write to temp file
      const tmpDir = mkdtempSync(join(tmpdir(), "chris-memory-"));
      const tmpFile = join(tmpDir, file.replace(/\//g, "_") + ".md");
      writeFileSync(tmpFile, currentContent);

      // Open in editor
      const child = spawn(editor, [tmpFile], { stdio: "inherit" });

      await new Promise<void>((resolve) => {
        child.on("exit", resolve);
      });

      // Read back
      const { readFileSync } = await import("fs");
      const newContent = readFileSync(tmpFile, "utf-8");

      // Clean up
      try { unlinkSync(tmpFile); } catch {}

      if (newContent === currentContent) {
        console.log("No changes made.");
        return;
      }

      // Push to GitHub
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `manual edit: ${path}`,
        content: Buffer.from(newContent).toString("base64"),
        ...(sha ? { sha } : {}),
      });

      console.log("Updated %s", path);
    });

  // chris memory search <query>
  memory
    .command("search <query>")
    .description("Search across all memory files")
    .action(async (query: string) => {
      const { octokit, owner, repo } = await getOctokit();
      const queryLower = query.toLowerCase();
      let found = false;

      for (const [alias, path] of Object.entries(MEMORY_FILES)) {
        try {
          const { data } = await octokit.repos.getContent({ owner, repo, path });
          if ("content" in data && data.type === "file") {
            const content = Buffer.from(data.content, "base64").toString("utf-8");
            const lines = content.split("\n");

            const matches = lines
              .map((line, i) => ({ line, num: i + 1 }))
              .filter(({ line }) => line.toLowerCase().includes(queryLower));

            if (matches.length > 0) {
              found = true;
              console.log("\x1b[1m%s\x1b[0m (%s):", alias, path);
              for (const { line, num } of matches) {
                // Highlight the match
                const highlighted = line.replace(
                  new RegExp(`(${query})`, "gi"),
                  "\x1b[33m$1\x1b[0m",
                );
                console.log("  %d: %s", num, highlighted);
              }
              console.log();
            }
          }
        } catch {
          // Skip files that don't exist
        }
      }

      if (!found) {
        console.log('No results for "%s"', query);
      }
    });
}
