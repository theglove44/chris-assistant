import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { registerTool } from "./registry.js";

const execFileAsync = promisify(execFile);

const WORKSPACE_ROOT =
  process.env.WORKSPACE_ROOT || path.join(os.homedir(), "Projects");

const MAX_OUTPUT = 50_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a user-supplied relative path against the workspace root and
 * verifies it stays within that root. Returns null if the path escapes.
 */
function resolveSafePath(userPath: string): string | null {
  const resolved = path.resolve(WORKSPACE_ROOT, userPath);
  if (
    !resolved.startsWith(WORKSPACE_ROOT + path.sep) &&
    resolved !== WORKSPACE_ROOT
  ) {
    return null;
  }
  return resolved;
}

function truncate(s: string): string {
  if (s.length > MAX_OUTPUT) {
    return s.slice(0, MAX_OUTPUT) + "\n\n[... truncated ...]";
  }
  return s;
}

/** Count non-overlapping occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

registerTool({
  name: "read_file",
  description:
    "Read a file from the workspace. Returns the file contents. Path is relative to the workspace root.",
  zodSchema: {
    path: z.string().describe("Path to the file, relative to workspace root"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "Path to the file, relative to workspace root",
      },
    },
  },
  execute: async (args: { path: string }): Promise<string> => {
    console.log("[tools] read_file path=%s", args.path);

    const resolved = resolveSafePath(args.path);
    if (!resolved) {
      return `Error: path "${args.path}" escapes the workspace root — access denied.`;
    }

    try {
      const contents = fs.readFileSync(resolved, "utf-8");
      return truncate(contents);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return `Error: file not found: ${args.path}`;
      }
      return `Error reading file "${args.path}": ${err.message}`;
    }
  },
});


// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

registerTool({
  name: "write_file",
  description:
    "Create or overwrite a file in the workspace. Creates parent directories if needed. Path is relative to the workspace root.",
  zodSchema: {
    path: z.string().describe("Path to the file, relative to workspace root"),
    content: z.string().describe("Content to write to the file"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: {
        type: "string",
        description: "Path to the file, relative to workspace root",
      },
      content: {
        type: "string",
        description: "Content to write to the file",
      },
    },
  },
  execute: async (args: { path: string; content: string }): Promise<string> => {
    console.log("[tools] write_file path=%s bytes=%d", args.path, args.content.length);

    const resolved = resolveSafePath(args.path);
    if (!resolved) {
      return `Error: path "${args.path}" escapes the workspace root — access denied.`;
    }

    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, args.content, "utf-8");
      return `Written ${args.content.length} bytes to ${args.path}`;
    } catch (err: any) {
      return `Error writing file "${args.path}": ${err.message}`;
    }
  },
});


// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------

registerTool({
  name: "edit_file",
  description:
    "Make a targeted edit to a file by replacing an exact string match. The old_string must appear exactly once in the file. Path is relative to the workspace root.",
  zodSchema: {
    path: z.string().describe("Path to the file, relative to workspace root"),
    old_string: z.string().describe("The exact string to find and replace — must appear exactly once"),
    new_string: z.string().describe("The replacement string"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["path", "old_string", "new_string"],
    properties: {
      path: {
        type: "string",
        description: "Path to the file, relative to workspace root",
      },
      old_string: {
        type: "string",
        description:
          "The exact string to find and replace — must appear exactly once",
      },
      new_string: {
        type: "string",
        description: "The replacement string",
      },
    },
  },
  execute: async (args: {
    path: string;
    old_string: string;
    new_string: string;
  }): Promise<string> => {
    console.log("[tools] edit_file path=%s", args.path);

    const resolved = resolveSafePath(args.path);
    if (!resolved) {
      return `Error: path "${args.path}" escapes the workspace root — access denied.`;
    }

    let contents: string;
    try {
      contents = fs.readFileSync(resolved, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return `Error: file not found: ${args.path}`;
      }
      return `Error reading file "${args.path}": ${err.message}`;
    }

    const count = countOccurrences(contents, args.old_string);
    if (count === 0) {
      return `Error: old_string not found in file "${args.path}".`;
    }
    if (count > 1) {
      return `Error: old_string appears ${count} times in "${args.path}" — provide more context to make it unique.`;
    }

    const updated = contents.replace(args.old_string, args.new_string);

    try {
      fs.writeFileSync(resolved, updated, "utf-8");
      return `Edited ${args.path}: replaced 1 occurrence.`;
    } catch (err: any) {
      return `Error writing file "${args.path}": ${err.message}`;
    }
  },
});


// ---------------------------------------------------------------------------
// list_files
// ---------------------------------------------------------------------------

registerTool({
  name: "list_files",
  description:
    "List files matching a glob pattern in the workspace. Path is relative to the workspace root. Pattern supports globs like '**/*.ts'. Returns file paths relative to the workspace root.",
  zodSchema: {
    pattern: z
      .string()
      .optional()
      .describe("Glob pattern to match filenames (default: '*')"),
    path: z
      .string()
      .optional()
      .describe("Directory to search in, relative to workspace root (default: '.')"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: [],
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match filenames (default: '*')",
      },
      path: {
        type: "string",
        description:
          "Directory to search in, relative to workspace root (default: '.')",
      },
    },
  },
  execute: async (args: {
    pattern?: string;
    path?: string;
  }): Promise<string> => {
    const userPattern = args.pattern || "*";
    const userPath = args.path || ".";

    console.log(
      "[tools] list_files path=%s pattern=%s",
      userPath,
      userPattern,
    );

    const resolvedDir = resolveSafePath(userPath);
    if (!resolvedDir) {
      return `Error: path "${userPath}" escapes the workspace root — access denied.`;
    }

    // Verify directory exists
    try {
      const stat = fs.statSync(resolvedDir);
      if (!stat.isDirectory()) {
        return `Error: "${userPath}" is not a directory.`;
      }
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return `Error: directory not found: ${userPath}`;
      }
      return `Error: ${err.message}`;
    }

    // For patterns like "**/*.ts" or "*.ts", extract the filename glob part.
    // "**/*.ts" → namePattern = "*.ts"
    // "*.ts"    → namePattern = "*.ts"
    // "*"       → namePattern = "*"
    const namePattern = userPattern.includes("/")
      ? userPattern.slice(userPattern.lastIndexOf("/") + 1)
      : userPattern;

    try {
      const { stdout } = await execFileAsync(
        "find",
        [
          resolvedDir,
          "-type", "d", "(", "-name", "node_modules", "-o", "-name", ".git", ")", "-prune",
          "-o", "-type", "f", "-name", namePattern, "-print",
        ],
        { timeout: 5_000, maxBuffer: 1024 * 1024 },
      );

      const lines = stdout
        .split("\n")
        .filter(Boolean)
        .slice(0, 200)
        .map((absPath) => path.relative(WORKSPACE_ROOT, absPath));

      if (lines.length === 0) {
        return "(no files found)";
      }

      return lines.join("\n");
    } catch (err: any) {
      if (err.killed) {
        return "Error: list_files timed out after 5 seconds.";
      }
      return `Error listing files: ${err.message}`;
    }
  },
});


// ---------------------------------------------------------------------------
// search_files
// ---------------------------------------------------------------------------

registerTool({
  name: "search_files",
  description:
    "Search file contents for a regex pattern. Returns matching lines with file paths and line numbers. Path is relative to the workspace root.",
  zodSchema: {
    pattern: z.string().describe("Regex pattern to search for"),
    path: z
      .string()
      .optional()
      .describe("Directory to search in, relative to workspace root (default: '.')"),
    glob: z
      .string()
      .optional()
      .describe("Filter to files matching this glob, e.g. '*.ts'"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern to search for",
      },
      path: {
        type: "string",
        description:
          "Directory to search in, relative to workspace root (default: '.')",
      },
      glob: {
        type: "string",
        description: "Filter to files matching this glob, e.g. '*.ts'",
      },
    },
  },
  execute: async (args: {
    pattern: string;
    path?: string;
    glob?: string;
  }): Promise<string> => {
    const userPath = args.path || ".";
    console.log(
      "[tools] search_files path=%s pattern=%s glob=%s",
      userPath,
      args.pattern,
      args.glob || "(none)",
    );

    const resolvedDir = resolveSafePath(userPath);
    if (!resolvedDir) {
      return `Error: path "${userPath}" escapes the workspace root — access denied.`;
    }

    // Build grep args: grep -rn [-m 100] [--include=<glob>] <pattern> <dir>
    const grepArgs: string[] = ["-rn", "-m", "100"];
    if (args.glob) {
      grepArgs.push(`--include=${args.glob}`);
    }
    grepArgs.push(args.pattern, resolvedDir);

    try {
      const { stdout } = await execFileAsync("grep", grepArgs, {
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
      });

      // Rewrite absolute paths to be relative to workspace root
      const output = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          // grep output: /abs/path/to/file:linenum:content
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) return line;
          const absFilePath = line.slice(0, colonIdx);
          const rest = line.slice(colonIdx);
          const rel = path.relative(WORKSPACE_ROOT, absFilePath);
          return rel + rest;
        })
        .join("\n");

      return truncate(output || "(no matches)");
    } catch (err: any) {
      if (err.killed) {
        return "Error: search_files timed out after 10 seconds.";
      }
      // grep exits with code 1 when no matches — not a real error
      if (err.code === 1 && !err.stderr) {
        return "(no matches)";
      }
      if (err.stderr) {
        return `Error running grep: ${err.stderr.trim()}`;
      }
      return `Error: ${err.message}`;
    }
  },
});

console.log("[tools] File tools registered (workspace: %s)", WORKSPACE_ROOT);
