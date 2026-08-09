import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const DEFAULT_GROK_BINARY = path.join(os.homedir(), ".grok", "bin", "grok");

export interface GrokStatus {
  binaryPath: string | null;
  version: string | null;
  authenticated: boolean;
  models: string[];
  defaultModel: string | null;
  reasoningEffortFlagAvailable: boolean;
  errors: string[];
}

export function resolveGrokBinary(): string | null {
  const candidates = [process.env.GROK_BIN, DEFAULT_GROK_BINARY]
    .filter((value): value is string => !!value && value.trim().length > 0);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function parseGrokModelsOutput(output: string): {
  authenticated: boolean;
  models: string[];
  defaultModel: string | null;
} {
  const defaultModel = output.match(/^Default model:\s*(\S+)/m)?.[1] ?? null;
  const models = [...output.matchAll(/^\s*\*?\s+([\w.-]+)(?:\s+\(default\))?\s*$/gm)]
    .map((match) => match[1])
    .filter((model) => model.startsWith("grok-"));
  return {
    authenticated: /You are logged in with grok\.com\./i.test(output),
    models: [...new Set(models)],
    defaultModel,
  };
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw
    .replaceAll(os.homedir(), "~")
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/(authorization|bearer|token|secret|cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 300);
  if (/not logged in|authentication|login required/i.test(redacted)) return "authentication required";
  if (/permission denied|operation not permitted/i.test(redacted)) return "permission denied";
  return "diagnostic output redacted";
}

export function getGrokStatus(): GrokStatus {
  const binaryPath = resolveGrokBinary();
  const errors: string[] = [];
  let version: string | null = null;
  let authenticated = false;
  let models: string[] = [];
  let defaultModel: string | null = null;
  let reasoningEffortFlagAvailable = false;

  if (!binaryPath) {
    errors.push("grok binary not found");
    return { binaryPath, version, authenticated, models, defaultModel, reasoningEffortFlagAvailable, errors };
  }

  try {
    version = execFileSync(binaryPath, ["--version"], {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    errors.push(`failed to read grok version: ${safeDiagnostic(error)}`);
  }

  try {
    const help = execFileSync(binaryPath, ["--help"], {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    reasoningEffortFlagAvailable = help.includes("--reasoning-effort");
  } catch (error) {
    errors.push(`failed to inspect grok capabilities: ${safeDiagnostic(error)}`);
  }

  try {
    const output = execFileSync(binaryPath, ["models"], {
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    ({ authenticated, models, defaultModel } = parseGrokModelsOutput(output));
    if (!authenticated) errors.push("grok models did not confirm authentication");
    if (models.length === 0) errors.push("grok models returned no available models");
  } catch (error) {
    errors.push(`failed to list grok models: ${safeDiagnostic(error)}`);
  }

  return { binaryPath, version, authenticated, models, defaultModel, reasoningEffortFlagAvailable, errors };
}
