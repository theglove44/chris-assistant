import { Command } from "commander";
import { Octokit } from "@octokit/rest";
import { spawn } from "child_process";
import { writeFileSync, readFileSync, mkdtempSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SOUL_PATH = "identity/SOUL.md";

async function getOctokit(): Promise<{ octokit: Octokit; owner: string; repo: string }> {
  await import("dotenv/config");
  const token = process.env.GITHUB_TOKEN;
  const memoryRepo = process.env.GITHUB_MEMORY_REPO;

  if (!token || !memoryRepo) {
    console.error("Missing GITHUB_TOKEN or GITHUB_MEMORY_REPO in .env");
    process.exit(1);
  }

  const [owner, repo] = memoryRepo.split("/");
  return { octokit: new Octokit({ auth: token }), owner, repo };
}

export function registerIdentityCommand(program: Command) {
  const identity = program
    .command("identity")
    .description("View or edit the assistant's identity (SOUL.md)")
    .action(async () => {
      // Default action: show identity
      const { octokit, owner, repo } = await getOctokit();

      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path: SOUL_PATH,
        });
        if ("content" in data && data.type === "file") {
          console.log(Buffer.from(data.content, "base64").toString("utf-8"));
        }
      } catch (err: any) {
        console.error("Could not load SOUL.md: %s", err.message);
        process.exit(1);
      }
    });

  identity
    .command("edit")
    .description("Open SOUL.md in your $EDITOR and push changes")
    .action(async () => {
      const editor = process.env.EDITOR || "nano";
      const { octokit, owner, repo } = await getOctokit();

      // Fetch current
      let currentContent = "";
      let sha: string | undefined;
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path: SOUL_PATH,
        });
        if ("content" in data && data.type === "file") {
          currentContent = Buffer.from(data.content, "base64").toString("utf-8");
          sha = data.sha;
        }
      } catch (err: any) {
        if (err.status !== 404) throw err;
      }

      // Write to temp file
      const tmpDir = mkdtempSync(join(tmpdir(), "chris-identity-"));
      const tmpFile = join(tmpDir, "SOUL.md");
      writeFileSync(tmpFile, currentContent);

      // Open in editor
      const child = spawn(editor, [tmpFile], { stdio: "inherit" });
      await new Promise<void>((resolve) => child.on("exit", resolve));

      // Read back
      const newContent = readFileSync(tmpFile, "utf-8");
      try { unlinkSync(tmpFile); } catch {}

      if (newContent === currentContent) {
        console.log("No changes made.");
        return;
      }

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: SOUL_PATH,
        message: "manual edit: identity/SOUL.md",
        content: Buffer.from(newContent).toString("base64"),
        ...(sha ? { sha } : {}),
      });

      console.log("Identity updated. Changes will take effect within 5 minutes (or restart the bot).");
    });
}
