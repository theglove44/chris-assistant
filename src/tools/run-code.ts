import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { z } from "zod";
import { registerTool } from "./registry.js";
import { getWorkspaceRoot } from "./files.js";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSX_BIN = resolve(__dirname, "../../node_modules/.bin/tsx");

const MAX_OUTPUT = 50_000;

// Allowlist of safe environment variables to pass to user-executed code.
// Using an allowlist rather than a blocklist ensures new secrets added to
// .env in the future won't accidentally leak to AI-generated code.
const SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "NODE_PATH",
  "NODE_NO_WARNINGS",
  "PYTHONPATH",
  "PYTHONDONTWRITEBYTECODE",
]);

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  // Always set NODE_NO_WARNINGS to suppress experimental warnings.
  env["NODE_NO_WARNINGS"] = "1";
  return env;
}

function buildCommand(
  language: string,
  code: string,
): { cmd: string; args: string[] } | null {
  switch (language) {
    case "javascript":
      return { cmd: "node", args: ["-e", code] };
    case "typescript":
      return { cmd: TSX_BIN, args: ["-e", code] };
    case "python":
      return { cmd: "python3", args: ["-c", code] };
    case "shell":
      return { cmd: "bash", args: ["-c", code] };
    default:
      return null;
  }
}

function truncate(s: string): string {
  if (s.length > MAX_OUTPUT) {
    return s.slice(0, MAX_OUTPUT) + "\n\n[... truncated ...]";
  }
  return s;
}

// Commands that could disrupt the bot's own process or system stability.
const DANGEROUS_PATTERNS = [
  /\bpm2\b/i,
  /\bkill\b.*chris-assistant/i,
  /\bsystemctl\b.*(restart|stop|disable)/i,
  /\breboot\b/,
  /\bshutdown\b/,
  /\brm\s+-rf\s+[/~]/,
];

function isDangerous(code: string): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return `Blocked: code matches dangerous pattern (${pattern.source}). The bot cannot restart or stop itself via code execution.`;
    }
  }
  return null;
}

registerTool({
  name: "run_code",
  category: "coding",
  description:
    "Execute a code snippet and return its output. Supports JavaScript, TypeScript, Python, and shell commands. Use this to test code, verify calculations, or run quick scripts. Has a 10-second timeout.",
  zodSchema: {
    language: z
      .enum(["javascript", "typescript", "python", "shell"])
      .describe("The programming language"),
    code: z.string().describe("The code to execute"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["language", "code"],
    properties: {
      language: {
        type: "string",
        enum: ["javascript", "typescript", "python", "shell"],
        description: "The programming language",
      },
      code: {
        type: "string",
        description: "The code to execute",
      },
    },
  },
  execute: async (args: { language: string; code: string }): Promise<string> => {
    const { language, code } = args;
    console.log(
      "[run-code] language=%s code=%s",
      language,
      code.slice(0, 100),
    );

    // Block dangerous commands that could disrupt the bot itself
    const blocked = isDangerous(code);
    if (blocked) {
      console.warn("[run-code] %s", blocked);
      return blocked;
    }

    const spec = buildCommand(language, code);
    if (!spec) {
      return `Unknown language: ${language}. Supported: javascript, typescript, python, shell.`;
    }

    const { cmd, args: cmdArgs } = spec;

    try {
      const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        env: sanitizedEnv(),
        cwd: getWorkspaceRoot(),
      });

      let result = "";
      if (stdout) result += stdout;
      if (stderr) result += (result ? "\n\nSTDERR:\n" : "STDERR:\n") + stderr;
      if (!result) result = "(no output)";

      return truncate(result);
    } catch (err: any) {
      if (err.killed) {
        return "Execution timed out after 10 seconds.";
      }

      // Non-zero exit code — err.stdout and err.stderr are populated
      let result = "";
      if (err.stdout) result += err.stdout;
      if (err.stderr)
        result += (result ? "\n\nSTDERR:\n" : "STDERR:\n") + err.stderr;
      if (!result) result = err.message;

      return truncate(result);
    }
  },
});

console.log("[tools] run_code registered");
