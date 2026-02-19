import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../..", ".env");

/** Secrets that should be redacted when displayed. */
const REDACTED_KEYS = new Set([
  "TELEGRAM_BOT_TOKEN",
  "GITHUB_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "BRAVE_SEARCH_API_KEY",
]);

function readEnv(): Map<string, string> {
  const env = new Map<string, string>();
  if (!existsSync(ENV_PATH)) return env;

  const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env.set(key, value);
  }
  return env;
}

function writeEnv(env: Map<string, string>): void {
  // Preserve comments and structure from existing file
  if (!existsSync(ENV_PATH)) {
    const lines = Array.from(env.entries()).map(([k, v]) => `${k}=${v}`);
    writeFileSync(ENV_PATH, lines.join("\n") + "\n");
    return;
  }

  const original = readFileSync(ENV_PATH, "utf-8");
  const lines = original.split("\n");
  const written = new Set<string>();

  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) return line;
    const key = trimmed.slice(0, eqIndex).trim();
    if (env.has(key)) {
      written.add(key);
      return `${key}=${env.get(key)}`;
    }
    return line;
  });

  // Append any new keys
  for (const [key, value] of env) {
    if (!written.has(key)) {
      updated.push(`${key}=${value}`);
    }
  }

  writeFileSync(ENV_PATH, updated.join("\n"));
}

function redact(key: string, value: string): string {
  if (REDACTED_KEYS.has(key)) {
    if (value.length <= 8) return "****";
    return value.slice(0, 4) + "..." + value.slice(-4);
  }
  return value;
}

export function registerConfigCommand(program: Command) {
  const config = program
    .command("config")
    .description("View and manage configuration")
    .action(() => {
      // Default: show all config
      const env = readEnv();
      if (env.size === 0) {
        console.log("No .env file found.");
        console.log('Run "chris setup" to create one.');
        return;
      }

      console.log("Configuration (%s):\n", ENV_PATH);
      for (const [key, value] of env) {
        console.log("  %s  %s", key.padEnd(30), redact(key, value));
      }
    });

  config
    .command("get <key>")
    .description("Get a specific config value")
    .action((key: string) => {
      const env = readEnv();
      const value = env.get(key) || env.get(key.toUpperCase());
      if (value === undefined) {
        console.error("Key not found: %s", key);
        process.exit(1);
      }
      console.log(value);
    });

  config
    .command("set <key> <value>")
    .description("Set a config value in .env")
    .action((key: string, value: string) => {
      const env = readEnv();
      env.set(key.toUpperCase(), value);
      writeEnv(env);
      console.log("Set %s", key.toUpperCase());
      console.log('Run "chris restart" for changes to take effect.');
    });
}
