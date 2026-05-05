import {
  MEMORY_STALE_AFTER_DAYS,
  REQUIRED_MEMORY_FILES,
  STALE_MEMORY_FILES,
} from "./constants.js";

type GitHubContent = {
  type?: string;
  size?: number;
  content?: string;
};

type GitHubCommit = {
  commit?: {
    committer?: {
      date?: string | null;
    } | null;
    author?: {
      date?: string | null;
    } | null;
  };
};

export interface MemoryHealthClient {
  repos: {
    getContent(args: { owner: string; repo: string; path: string }): Promise<{ data: GitHubContent | GitHubContent[] }>;
    listCommits(args: { owner: string; repo: string; path: string; per_page: number }): Promise<{ data: GitHubCommit[] }>;
  };
}

export type MemoryHealthStatus = "present" | "missing" | "empty" | "stale";

export interface MemoryHealthFile {
  path: string;
  status: MemoryHealthStatus;
  size: number | null;
  lastCommitAt: string | null;
  stale: boolean;
}

export interface MemoryHealthReport {
  files: MemoryHealthFile[];
  missing: MemoryHealthFile[];
  empty: MemoryHealthFile[];
  stale: MemoryHealthFile[];
  ok: boolean;
}

const STALE_FILE_SET = new Set<string>(STALE_MEMORY_FILES);

function daysSince(dateIso: string, now: Date): number {
  return (now.getTime() - new Date(dateIso).getTime()) / 86_400_000;
}

async function lastCommitDate(
  client: MemoryHealthClient,
  owner: string,
  repo: string,
  path: string,
): Promise<string | null> {
  try {
    const response = await client.repos.listCommits({ owner, repo, path, per_page: 1 });
    const commit = response.data[0]?.commit;
    return commit?.committer?.date ?? commit?.author?.date ?? null;
  } catch {
    return null;
  }
}

export async function checkMemoryHealth(args: {
  client: MemoryHealthClient;
  owner: string;
  repo: string;
  now?: Date;
}): Promise<MemoryHealthReport> {
  const now = args.now ?? new Date();
  const files = await Promise.all(
    REQUIRED_MEMORY_FILES.map(async (path): Promise<MemoryHealthFile> => {
      try {
        const response = await args.client.repos.getContent({
          owner: args.owner,
          repo: args.repo,
          path,
        });
        const data = response.data;
        if (Array.isArray(data) || data.type !== "file") {
          return { path, status: "missing", size: null, lastCommitAt: null, stale: false };
        }

        const size = typeof data.size === "number"
          ? data.size
          : data.content
            ? Buffer.byteLength(Buffer.from(data.content, "base64").toString("utf-8"), "utf-8")
            : 0;
        const lastCommitAt = await lastCommitDate(args.client, args.owner, args.repo, path);
        const empty = size === 0 || (data.content ? Buffer.from(data.content, "base64").toString("utf-8").trim().length === 0 : false);
        const stale = !empty
          && lastCommitAt !== null
          && STALE_FILE_SET.has(path)
          && daysSince(lastCommitAt, now) > MEMORY_STALE_AFTER_DAYS;

        return {
          path,
          status: empty ? "empty" : stale ? "stale" : "present",
          size,
          lastCommitAt,
          stale,
        };
      } catch (err: any) {
        if (err?.status === 404) {
          return { path, status: "missing", size: null, lastCommitAt: null, stale: false };
        }
        throw err;
      }
    }),
  );

  const missing = files.filter((f) => f.status === "missing");
  const empty = files.filter((f) => f.status === "empty");
  const stale = files.filter((f) => f.status === "stale");

  return {
    files,
    missing,
    empty,
    stale,
    ok: missing.length === 0 && empty.length === 0,
  };
}

