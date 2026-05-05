import { describe, expect, it, vi } from "vitest";
import { REQUIRED_MEMORY_FILES } from "../src/domain/memory/constants.js";
import { checkMemoryHealth, type MemoryHealthClient } from "../src/domain/memory/health.js";

function contentResponse(content: string) {
  return {
    data: {
      type: "file",
      size: Buffer.byteLength(content, "utf-8"),
      content: Buffer.from(content).toString("base64"),
    },
  };
}

function client(args: {
  contents: Record<string, string | 404>;
  commits?: Record<string, string>;
}): MemoryHealthClient {
  return {
    repos: {
      getContent: vi.fn(async ({ path }) => {
        const value = args.contents[path];
        if (value === 404 || value === undefined) {
          const err: any = new Error("not found");
          err.status = 404;
          throw err;
        }
        return contentResponse(value);
      }),
      listCommits: vi.fn(async ({ path }) => ({
        data: args.commits?.[path]
          ? [{ commit: { committer: { date: args.commits[path] } } }]
          : [],
      })),
    },
  };
}

describe("checkMemoryHealth", () => {
  it("reports all canonical files present and non-stale", async () => {
    const contents = Object.fromEntries(REQUIRED_MEMORY_FILES.map((path) => [path, `# ${path}`]));
    const commits = Object.fromEntries(REQUIRED_MEMORY_FILES.map((path) => [path, "2026-05-01T00:00:00Z"]));

    const report = await checkMemoryHealth({
      client: client({ contents, commits }),
      owner: "owner",
      repo: "memory",
      now: new Date("2026-05-05T00:00:00Z"),
    });

    expect(report.ok).toBe(true);
    expect(report.missing).toHaveLength(0);
    expect(report.empty).toHaveLength(0);
    expect(report.stale).toHaveLength(0);
    expect(report.files.map((f) => f.path)).toEqual([...REQUIRED_MEMORY_FILES]);
  });

  it("fails missing and empty required runtime files", async () => {
    const contents = Object.fromEntries(REQUIRED_MEMORY_FILES.map((path) => [path, `# ${path}`]));
    contents["SOUL.md"] = 404;
    contents["USER.md"] = "   \n";

    const report = await checkMemoryHealth({
      client: client({ contents }),
      owner: "owner",
      repo: "memory",
      now: new Date("2026-05-05T00:00:00Z"),
    });

    expect(report.ok).toBe(false);
    expect(report.missing.map((f) => f.path)).toEqual(["SOUL.md"]);
    expect(report.empty.map((f) => f.path)).toEqual(["USER.md"]);
  });

  it("warns when refreshable memory files are older than 30 days", async () => {
    const contents = Object.fromEntries(REQUIRED_MEMORY_FILES.map((path) => [path, `# ${path}`]));
    const commits = Object.fromEntries(REQUIRED_MEMORY_FILES.map((path) => [path, "2026-03-01T00:00:00Z"]));

    const report = await checkMemoryHealth({
      client: client({ contents, commits }),
      owner: "owner",
      repo: "memory",
      now: new Date("2026-05-05T00:00:00Z"),
    });

    expect(report.ok).toBe(true);
    expect(report.stale.map((f) => f.path)).toEqual([
      "USER.md",
      "memory/SUMMARY.md",
      "memory/DASHBOARD.md",
      "memory/learnings.md",
    ]);
    expect(report.files.find((f) => f.path === "SOUL.md")?.status).toBe("present");
    expect(report.files.find((f) => f.path === "IDENTITY.md")?.status).toBe("present");
  });
});

