import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

export const CODEX_HOME = path.join(os.homedir(), ".codex");
export const CODEX_AUTH_FILE = path.join(CODEX_HOME, "auth.json");

export interface CodexStatus {
  binaryPath: string | null;
  version: string | null;
  authFile: string;
  authenticated: boolean;
  accountId: string | null;
  appServerAvailable: boolean;
  errors: string[];
}

function candidateCodexPaths(): string[] {
  const candidates = [
    process.env.CODEX_BIN,
    path.join(PROJECT_ROOT, "node_modules", ".bin", "codex"),
  ];

  try {
    const resolved = execFileSync("sh", ["-lc", "command -v codex"], { encoding: "utf-8" }).trim();
    candidates.push(resolved);
  } catch {
    // Fall through — explicit candidates already cover local/project installs.
  }

  return candidates.filter((value): value is string => !!value && value.trim().length > 0);
}

export function resolveCodexBinary(): string | null {
  for (const candidate of candidateCodexPaths()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

interface CodexAuthFile {
  tokens?: {
    account_id?: string;
    access_token?: string;
    refresh_token?: string;
  };
}

export function readCodexAuthFile(): CodexAuthFile | null {
  try {
    return JSON.parse(fs.readFileSync(CODEX_AUTH_FILE, "utf-8")) as CodexAuthFile;
  } catch {
    return null;
  }
}

export function getCodexStatus(): CodexStatus {
  const binaryPath = resolveCodexBinary();
  const errors: string[] = [];
  let version: string | null = null;
  let appServerAvailable = false;

  if (!binaryPath) {
    errors.push("codex binary not found");
  } else {
    try {
      version = execFileSync(binaryPath, ["--version"], { encoding: "utf-8" }).trim();
    } catch (err: any) {
      errors.push(`failed to read codex version: ${err.message}`);
    }

    try {
      execFileSync(binaryPath, ["app-server", "--help"], { encoding: "utf-8" });
      appServerAvailable = true;
    } catch (err: any) {
      errors.push(`codex app-server unavailable: ${err.message}`);
    }
  }

  const auth = readCodexAuthFile();
  const authenticated = !!auth?.tokens?.access_token && !!auth?.tokens?.refresh_token;

  if (!authenticated) {
    errors.push(`auth file missing or incomplete at ${CODEX_AUTH_FILE}`);
  }

  return {
    binaryPath,
    version,
    authFile: CODEX_AUTH_FILE,
    authenticated,
    accountId: auth?.tokens?.account_id ?? null,
    appServerAvailable,
    errors,
  };
}
