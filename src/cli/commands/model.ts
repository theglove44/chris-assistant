import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../..", ".env");

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/** Well-known model IDs for quick reference */
const KNOWN_MODELS: Record<string, { id: string; provider: string }> = {
  "opus": { id: "claude-opus-4-6", provider: "claude" },
  "sonnet": { id: "claude-sonnet-4-6", provider: "claude" },
  "haiku": { id: "claude-haiku-4-5-20251001", provider: "claude" },
  "sonnet-4-5": { id: "claude-sonnet-4-5-20250929", provider: "claude" },
  "minimax": { id: "MiniMax-M2.5", provider: "minimax" },
  "minimax-fast": { id: "MiniMax-M2.5-highspeed", provider: "minimax" },
};

function providerForModel(model: string): string {
  if (model.startsWith("MiniMax")) return "minimax";
  return "claude";
}

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
    .description("View or change the AI model and provider")
    .action(() => {
      const current = getCurrentModel();
      const provider = providerForModel(current);
      console.log("Current model: %s (%s)", current, provider);
      console.log("");
      console.log("Shortcuts:");
      for (const [alias, info] of Object.entries(KNOWN_MODELS)) {
        const marker = info.id === current ? " ← active" : "";
        console.log("  %s %s %s%s", alias.padEnd(14), info.provider.padEnd(8), info.id, marker);
      }
      console.log("");
      console.log('Change with: chris model set <name-or-id>');
    });

  model
    .command("set <model>")
    .description("Set the AI model (use a shortcut like 'minimax' or a full model ID)")
    .action((input: string) => {
      const known = KNOWN_MODELS[input.toLowerCase()];
      const modelId = known ? known.id : input;
      const provider = providerForModel(modelId);
      setModel(modelId);
      console.log("Model set to: %s (%s)", modelId, provider);
      console.log('Run "chris restart" for this to take effect.');
    });
}
