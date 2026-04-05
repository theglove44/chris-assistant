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
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let sha: string | undefined;

    try {
      const existing = await octokit.repos.getContent({ owner: repoOwner, repo: repoName, path });
      if ("sha" in existing.data) {
        sha = existing.data.sha;
      }
    } catch (error: any) {
      if (error.status !== 404) throw error;
    }

    try {
      await octokit.repos.createOrUpdateFileContents({
        owner: repoOwner,
        repo: repoName,
        path,
        message: commitMessage,
        content: Buffer.from(content).toString("base64"),
        ...(sha ? { sha } : {}),
      });
      return;
    } catch (error: any) {
      if (error.status === 409 && attempt < maxRetries) {
        console.warn("[memory] SHA conflict on %s, retrying (%d/%d)", path, attempt, maxRetries);
        continue;
      }
      throw error;
    }
  }
}

/**
 * List files in a directory in the memory repo.
 * Returns relative paths (e.g. "conversations/summaries/2026-03-15.md").
 */
export async function listMemoryDir(dirPath: string): Promise<string[]> {
  try {
    const response = await octokit.repos.getContent({ owner: repoOwner, repo: repoName, path: dirPath });
    if (!Array.isArray(response.data)) return [];
    return response.data
      .filter((item: any) => item.type === "file")
      .map((item: any) => item.path as string);
  } catch (error: any) {
    if (error.status === 404) return [];
    throw error;
  }
}

export async function appendToMemoryFile(path: string, newContent: string, commitMessage: string): Promise<void> {
  const existing = await readMemoryFile(path);
  const updated = existing ? `${existing.trimEnd()}\n\n${newContent}` : newContent;
  await writeMemoryFile(path, updated, commitMessage);
}
