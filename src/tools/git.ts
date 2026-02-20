import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { registerTool } from "./registry.js";
import { getWorkspaceRoot } from "./files.js";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT = 50_000;

function truncate(s: string): string {
  if (s.length > MAX_OUTPUT) {
    return s.slice(0, MAX_OUTPUT) + "\n\n[... truncated ...]";
  }
  return s;
}

// ---------------------------------------------------------------------------
// git_status
// ---------------------------------------------------------------------------

registerTool({
  name: "git_status",
  category: "coding",
  description:
    "Show the git status of the active workspace. Returns staged, unstaged, and untracked file changes.",
  zodSchema: {},
  jsonSchemaParameters: {
    type: "object",
    required: [],
    properties: {},
  },
  execute: async (_args: Record<string, never>): Promise<string> => {
    const workspaceRoot = getWorkspaceRoot();
    console.log("[tools] git_status workspaceRoot=%s", workspaceRoot);

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", workspaceRoot, "status", "--short"],
        { timeout: 5_000, maxBuffer: 1024 * 1024 },
      );
      return stdout.trim() || "(nothing to report — working tree clean)";
    } catch (err: any) {
      if (err.killed) {
        return "Error: git_status timed out after 5 seconds.";
      }
      if (err.stderr && err.stderr.includes("not a git repository")) {
        return `Error: "${workspaceRoot}" is not a git repository.`;
      }
      const detail = err.stderr ? err.stderr.trim() : err.message;
      return `Error running git status: ${detail}`;
    }
  },
});

// ---------------------------------------------------------------------------
// git_diff
// ---------------------------------------------------------------------------

registerTool({
  name: "git_diff",
  category: "coding",
  description:
    "Show git diff of changes in the active workspace. Use staged=true to see only staged changes.",
  zodSchema: {
    staged: z
      .boolean()
      .optional()
      .describe("If true, show only staged (cached) changes. Defaults to false."),
  },
  jsonSchemaParameters: {
    type: "object",
    required: [],
    properties: {
      staged: {
        type: "boolean",
        description: "If true, show only staged (cached) changes. Defaults to false.",
      },
    },
  },
  execute: async (args: { staged?: boolean }): Promise<string> => {
    const workspaceRoot = getWorkspaceRoot();
    const staged = args.staged ?? false;
    console.log(
      "[tools] git_diff workspaceRoot=%s staged=%s",
      workspaceRoot,
      staged,
    );

    const diffArgs = ["-C", workspaceRoot, "diff", ...(staged ? ["--cached"] : [])];

    try {
      const { stdout } = await execFileAsync("git", diffArgs, {
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return truncate(stdout.trim() || "(no differences)");
    } catch (err: any) {
      if (err.killed) {
        return "Error: git_diff timed out after 10 seconds.";
      }
      if (err.stderr && err.stderr.includes("not a git repository")) {
        return `Error: "${workspaceRoot}" is not a git repository.`;
      }
      const detail = err.stderr ? err.stderr.trim() : err.message;
      return `Error running git diff: ${detail}`;
    }
  },
});

// ---------------------------------------------------------------------------
// git_commit
// ---------------------------------------------------------------------------

registerTool({
  name: "git_commit",
  category: "coding",
  description:
    "Create a git commit in the active workspace. Optionally stage specific files first. If no files specified, commits whatever is already staged.",
  zodSchema: {
    message: z.string().describe("The commit message"),
    files: z
      .array(z.string())
      .optional()
      .describe("Files to stage before committing"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["message"],
    properties: {
      message: {
        type: "string",
        description: "The commit message",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Files to stage before committing (relative to workspace root)",
      },
    },
  },
  execute: async (args: {
    message: string;
    files?: string[];
  }): Promise<string> => {
    const workspaceRoot = getWorkspaceRoot();
    console.log(
      "[tools] git_commit workspaceRoot=%s message=%s files=%s",
      workspaceRoot,
      args.message.slice(0, 80),
      args.files ? args.files.join(", ") : "(staged only)",
    );

    // Stage specified files first, if any were provided.
    if (args.files && args.files.length > 0) {
      try {
        await execFileAsync(
          "git",
          ["-C", workspaceRoot, "add", "--", ...args.files],
          { timeout: 10_000, maxBuffer: 1024 * 1024 },
        );
      } catch (err: any) {
        if (err.killed) {
          return "Error: git add timed out after 10 seconds.";
        }
        if (err.stderr && err.stderr.includes("not a git repository")) {
          return `Error: "${workspaceRoot}" is not a git repository.`;
        }
        const detail = err.stderr ? err.stderr.trim() : err.message;
        return `Error staging files: ${detail}`;
      }
    }

    // Create the commit.
    try {
      const { stdout, stderr } = await execFileAsync(
        "git",
        ["-C", workspaceRoot, "commit", "-m", args.message],
        { timeout: 10_000, maxBuffer: 1024 * 1024 },
      );
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      return output || "Commit created.";
    } catch (err: any) {
      if (err.killed) {
        return "Error: git commit timed out after 10 seconds.";
      }
      if (err.stderr && err.stderr.includes("not a git repository")) {
        return `Error: "${workspaceRoot}" is not a git repository.`;
      }
      // "nothing to commit" is a common non-fatal case — report it clearly.
      const stderr = err.stderr ?? "";
      const stdout = err.stdout ?? "";
      if (stderr.includes("nothing to commit") || stdout.includes("nothing to commit")) {
        return "Nothing to commit — the staging area is empty or all changes are already committed.";
      }
      const detail = stderr.trim() || stdout.trim() || err.message;
      return `Error running git commit: ${detail}`;
    }
  },
});

console.log("[tools] Git tools registered");
