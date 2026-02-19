import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../..", ".env");

const DEFAULT_MODEL = "gpt-4o";

/** Well-known model IDs for quick reference */
const KNOWN_MODELS: Record<string, { id: string; provider: string }> = {
  // Claude
  "opus": { id: "claude-opus-4-6", provider: "claude" },
  "sonnet": { id: "claude-sonnet-4-6", provider: "claude" },
  "haiku": { id: "claude-haiku-4-5-20251001", provider: "claude" },
  "sonnet-4-5": { id: "claude-sonnet-4-5-20250929", provider: "claude" },
  // OpenAI — current flagship
  "gpt5": { id: "gpt-5.2", provider: "openai" },
  "codex": { id: "GPT-5.3-Codex", provider: "openai" },
  "o3": { id: "o3", provider: "openai" },
  "o4-mini": { id: "o4-mini", provider: "openai" },
  // OpenAI — previous gen
  "gpt4o": { id: "gpt-4o", provider: "openai" },
  "gpt41": { id: "gpt-4.1", provider: "openai" },
  // MiniMax
  "minimax": { id: "MiniMax-M2.5", provider: "minimax" },
  "minimax-fast": { id: "MiniMax-M2.5-highspeed", provider: "minimax" },
};

function providerForModel(model: string): string {
  if (isOpenAiModel(model)) return "openai";
  if (model.startsWith("MiniMax")) return "minimax";
  return "claude";
}

function isOpenAiModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-");
}

function getCurrentModel(): string {
  if (!existsSync(ENV_PATH)) return DEFAULT_MODEL;
  const content = readFileSync(ENV_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key === "AI_MODEL" || key === "CLAUDE_MODEL") {
      return trimmed.slice(eq + 1).trim() || DEFAULT_MODEL;
    }
  }
  return DEFAULT_MODEL;
}

function setModel(modelId: string): void {
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, `AI_MODEL=${modelId}\n`);
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
    const key = trimmed.slice(0, eq).trim();
    if (key === "AI_MODEL" || key === "CLAUDE_MODEL") {
      found = true;
      return `AI_MODEL=${modelId}`;
    }
    return line;
  });

  if (!found) updated.push(`AI_MODEL=${modelId}`);
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

  /** All known models across providers for search */
  const ALL_MODELS: { id: string; provider: string; description: string }[] = [
    // Claude
    { id: "claude-opus-4-6", provider: "claude", description: "Most capable Claude model" },
    { id: "claude-sonnet-4-6", provider: "claude", description: "Balanced Claude model" },
    { id: "claude-sonnet-4-5-20250929", provider: "claude", description: "Previous-gen Sonnet" },
    { id: "claude-haiku-4-5-20251001", provider: "claude", description: "Fast, lightweight Claude" },
    // OpenAI — GPT-5 series (current flagship)
    { id: "gpt-5.2", provider: "openai", description: "Current flagship, professional knowledge work" },
    { id: "gpt-5.2-chat-latest", provider: "openai", description: "Instant version of GPT-5.2" },
    { id: "gpt-5.2-pro", provider: "openai", description: "More compute for harder reasoning" },
    { id: "GPT-5.3-Codex", provider: "openai", description: "Most advanced agentic coding model" },
    { id: "GPT-5.2-Codex", provider: "openai", description: "Previous Codex coding model" },
    { id: "GPT-5.1-Codex-Mini", provider: "openai", description: "Smaller, cost-effective Codex" },
    // OpenAI — o-series (reasoning)
    { id: "o3", provider: "openai", description: "Powerful reasoning (math, science, code)" },
    { id: "o3-mini", provider: "openai", description: "Lightweight reasoning" },
    { id: "o3-pro", provider: "openai", description: "Enhanced reasoning, more compute" },
    { id: "o3-deep-research", provider: "openai", description: "Deep research variant of o3" },
    { id: "o4-mini", provider: "openai", description: "Fast reasoning model" },
    { id: "o4-mini-deep-research", provider: "openai", description: "Deep research variant of o4-mini" },
    // OpenAI — GPT-4 series (previous gen)
    { id: "gpt-4o", provider: "openai", description: "Versatile flagship (text + vision)" },
    { id: "gpt-4o-mini", provider: "openai", description: "Small, fast, affordable" },
    { id: "gpt-4.1", provider: "openai", description: "Coding-optimized, 1M context" },
    { id: "gpt-4.1-mini", provider: "openai", description: "Smaller coding model" },
    { id: "gpt-4.1-nano", provider: "openai", description: "Fastest coding model" },
    // MiniMax
    { id: "MiniMax-M2.5", provider: "minimax", description: "MiniMax flagship" },
    { id: "MiniMax-M2.5-highspeed", provider: "minimax", description: "MiniMax fast mode" },
  ];

  model
    .command("search [query]")
    .description("Search available models across all providers")
    .action((query?: string) => {
      const filtered = query
        ? ALL_MODELS.filter(
            (m) =>
              m.id.toLowerCase().includes(query.toLowerCase()) ||
              m.provider.toLowerCase().includes(query.toLowerCase()) ||
              m.description.toLowerCase().includes(query.toLowerCase()),
          )
        : ALL_MODELS;

      if (filtered.length === 0) {
        console.log("No models found matching \"%s\".", query);
        return;
      }

      console.log("Available models%s (%d):\n", query ? ` matching "${query}"` : "", filtered.length);
      for (const m of filtered) {
        console.log("  %s  %s  %s", m.id.padEnd(32), m.provider.padEnd(8), m.description);
      }
      console.log('\nUse: chris model set <model-id>');
    });
}
