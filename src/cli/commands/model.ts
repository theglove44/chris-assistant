import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../..", ".env");

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/** Well-known model IDs for quick reference */
const KNOWN_MODELS: Record<string, string> = {
  "opus": "claude-opus-4-6",
  "sonnet": "claude-sonnet-4-6",
  "haiku": "claude-haiku-4-5-20251001",
  "sonnet-4-5": "claude-sonnet-4-5-20250929",
};

function getCurrentModel(): string {
  if (!existsSync(ENV_PATH)) return DEFAULT_MODEL;
  const content = readFileSync(ENV_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === "CLAUDE_MODEL") {
      return trimmed.slice(eq + 1).trim() || DEFAULT_MODEL;
    }
  }
  return DEFAULT_MODEL;
}

function setModel(modelId: string): void {
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, `CLAUDE_MODEL=${modelId}\n`);
    return;
  }

  const content = readFileSync(ENV_PATH, "utf-8");
  const lines = content.split("\n");
  let found = false;

  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    if (trimmed.slice(0, eq).trim() === "CLAUDE_MODEL") {
      found = true;
      return `CLAUDE_MODEL=${modelId}`;
    }
    return line;
  });

  if (!found) updated.push(`CLAUDE_MODEL=${modelId}`);
  writeFileSync(ENV_PATH, updated.join("\n"));
}

export function registerModelCommand(program: Command) {
  const model = program
    .command("model")
    .description("View or change the Claude model")
    .action(() => {
      const current = getCurrentModel();
      console.log("Current model: %s", current);
      console.log("");
      console.log("Shortcuts:");
      for (const [alias, id] of Object.entries(KNOWN_MODELS)) {
        const marker = id === current ? " ← active" : "";
        console.log("  %s %s%s", alias.padEnd(12), id, marker);
      }
      console.log("");
      console.log('Change with: chris model set <name-or-id>');
    });

  model
    .command("set <model>")
    .description("Set the Claude model (use a shortcut like 'opus' or a full model ID)")
    .action((input: string) => {
      const modelId = KNOWN_MODELS[input.toLowerCase()] || input;
      setModel(modelId);
      console.log("Model set to: %s", modelId);
      console.log('Run "chris restart" for this to take effect.');
    });
}
