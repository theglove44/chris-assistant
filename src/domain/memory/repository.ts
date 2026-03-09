import { Octokit } from "@octokit/rest";
import { config, repoOwner, repoName } from "../../config.js";

const octokit = new Octokit({
  auth: config.github.token,
  log: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
});

export async function readMemoryFile(path: string): Promise<string | null> {
  try {
    const response = await octokit.repos.getContent({ owner: repoOwner, repo: repoName, path });
    if ("content" in response.data && response.data.type === "file") {
      return Buffer.from(response.data.content, "base64").toString("utf-8");
    }
    return null;
  } catch (error: any) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function writeMemoryFile(path: string, content: string, commitMessage: string): Promise<void> {
  let sha: string | undefined;

  try {
    const existing = await octokit.repos.getContent({ owner: repoOwner, repo: repoName, path });
    if ("sha" in existing.data) {
      sha = existing.data.sha;
    }
  } catch (error: any) {
    if (error.status !== 404) throw error;
  }

  await octokit.repos.createOrUpdateFileContents({
    owner: repoOwner,
    repo: repoName,
    path,
    message: commitMessage,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  });
}

export async function appendToMemoryFile(path: string, newContent: string, commitMessage: string): Promise<void> {
  const existing = await readMemoryFile(path);
  const updated = existing ? `${existing.trimEnd()}\n\n${newContent}` : newContent;
  await writeMemoryFile(path, updated, commitMessage);
}
