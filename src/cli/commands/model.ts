import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  providerCapabilitiesForModel,
  providerCapabilitySummary,
  providerForModel,
} from "../../providers/model-routing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../..", ".env");

const DEFAULT_MODEL = "gpt-4o";

/** Well-known model IDs for quick reference */
const KNOWN_MODELS: Record<string, { id: string; provider: string }> = {
  // Claude
  "opus": { id: "claude-opus-4-7", provider: "claude" },
  "sonnet": { id: "claude-sonnet-4-6", provider: "claude" },
  "haiku": { id: "claude-haiku-4-5-20251001", provider: "claude" },
  "opus-4-6": { id: "claude-opus-4-6", provider: "claude" },
  "sonnet-4-5": { id: "claude-sonnet-4-5-20250929", provider: "claude" },
  // OpenAI — current recommended models
  "gpt5": { id: "gpt-5.5", provider: "openai" },
  "gpt54": { id: "gpt-5.4", provider: "openai" },
  "gpt54-mini": { id: "gpt-5.4-mini", provider: "openai" },
  "gpt54-nano": { id: "gpt-5.4-nano", provider: "openai" },
  "codex": { id: "gpt-5.3-codex", provider: "openai" },
  "codex-spark": { id: "gpt-5.3-codex-spark", provider: "openai" },
  "codex-agent": { id: "codex-agent-gpt-5.5", provider: "codex-agent" },
  "codex-agent-fast": { id: "codex-agent-gpt-5.4-mini", provider: "codex-agent" },
  "codex-agent-coding": { id: "codex-agent-gpt-5.3-codex", provider: "codex-agent" },
  // OpenAI — older reasoning models still accepted
  "o3": { id: "o3", provider: "openai" },
  "o4-mini": { id: "o4-mini", provider: "openai" },
  // OpenAI — previous gen
  "gpt52": { id: "gpt-5.2", provider: "openai" },
  "gpt4o": { id: "gpt-4o", provider: "openai" },
  "gpt41": { id: "gpt-4.1", provider: "openai" },
  // MiniMax
  "minimax": { id: "MiniMax-M2.7", provider: "minimax" },
  "minimax-fast": { id: "MiniMax-M2.7-highspeed", provider: "minimax" },
  "minimax-m25": { id: "MiniMax-M2.5", provider: "minimax" },
};

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
      const capabilities = providerCapabilitiesForModel(current);
      console.log("Current model: %s (%s)", current, provider);
      console.log("Best use: %s", capabilities.summary);
      console.log("");
      console.log(providerCapabilitySummary(current));
      console.log("");
      console.log("Shortcuts:");
      for (const [alias, info] of Object.entries(KNOWN_MODELS)) {
        const marker = info.id === current ? " ← active" : "";
        console.log("  %s %s %s%s", alias.padEnd(20), info.provider.padEnd(12), info.id, marker);
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
      const capabilities = providerCapabilitiesForModel(modelId);
      setModel(modelId);
      console.log("Model set to: %s (%s)", modelId, provider);
      console.log("Best use: %s", capabilities.summary);
      console.log('Run "chris restart" for this to take effect.');
    });

  /** All known models across providers for search */
  const ALL_MODELS: { id: string; provider: string; description: string }[] = [
    // Claude
    { id: "claude-opus-4-7", provider: "claude", description: "Most capable Claude model for complex reasoning and agentic coding" },
    { id: "claude-sonnet-4-6", provider: "claude", description: "Best Claude speed/intelligence balance" },
    { id: "claude-opus-4-6", provider: "claude", description: "Previous Opus generation" },
    { id: "claude-sonnet-4-5-20250929", provider: "claude", description: "Previous-gen Sonnet" },
    { id: "claude-haiku-4-5-20251001", provider: "claude", description: "Fast, lightweight Claude" },
    // OpenAI — GPT-5 series (current recommended)
    { id: "gpt-5.5", provider: "openai", description: "Current flagship for complex reasoning, coding, and professional work" },
    { id: "gpt-5.4", provider: "openai", description: "Affordable frontier model for coding and professional work" },
    { id: "gpt-5.4-mini", provider: "openai", description: "Strong mini model for coding, computer use, and subagents" },
    { id: "gpt-5.4-nano", provider: "openai", description: "Fastest, lowest-cost GPT-5.4 variant" },
    { id: "gpt-5.3-codex", provider: "openai", description: "Specialized coding model for complex software engineering" },
    { id: "gpt-5.3-codex-spark", provider: "openai", description: "Research preview for near-instant coding iteration" },
    { id: "gpt-5.2", provider: "openai", description: "Previous general-purpose model" },
    { id: "gpt-5.2-chat-latest", provider: "openai", description: "Previous ChatGPT-style GPT-5.2 model" },
    { id: "gpt-5.2-pro", provider: "openai", description: "Previous higher-compute GPT-5.2 model" },
    { id: "codex-agent-gpt-5.5", provider: "codex-agent", description: "Coding-focused Codex CLI agent on gpt-5.5" },
    { id: "codex-agent-gpt-5.4", provider: "codex-agent", description: "Coding-focused Codex CLI agent on gpt-5.4" },
    { id: "codex-agent-gpt-5.4-mini", provider: "codex-agent", description: "Fast coding-focused Codex CLI agent on gpt-5.4-mini" },
    { id: "codex-agent-gpt-5.3-codex", provider: "codex-agent", description: "Coding-focused Codex CLI agent on gpt-5.3-codex" },
    { id: "codex-agent-gpt-5.3-codex-spark", provider: "codex-agent", description: "Coding-focused Codex CLI agent on codex spark preview" },
    // OpenAI — o-series (reasoning)
    { id: "o3", provider: "openai", description: "Older powerful reasoning model" },
    { id: "o3-mini", provider: "openai", description: "Older lightweight reasoning model" },
    { id: "o3-pro", provider: "openai", description: "Older enhanced reasoning model" },
    { id: "o3-deep-research", provider: "openai", description: "Deep research variant of o3" },
    { id: "o4-mini", provider: "openai", description: "Older fast reasoning model" },
    { id: "o4-mini-deep-research", provider: "openai", description: "Deep research variant of o4-mini" },
    // OpenAI — GPT-4 series (previous gen)
    { id: "gpt-4o", provider: "openai", description: "Previous versatile GPT-4o model" },
    { id: "gpt-4o-mini", provider: "openai", description: "Small, fast, affordable" },
    { id: "gpt-4.1", provider: "openai", description: "Previous non-reasoning coding model" },
    { id: "gpt-4.1-mini", provider: "openai", description: "Previous smaller GPT-4.1 model" },
    { id: "gpt-4.1-nano", provider: "openai", description: "Previous fastest GPT-4.1 model" },
    // MiniMax
    { id: "MiniMax-M2.7", provider: "minimax", description: "Current MiniMax text generation model" },
    { id: "MiniMax-M2.7-highspeed", provider: "minimax", description: "Current MiniMax high-speed mode" },
    { id: "MiniMax-M2.5", provider: "minimax", description: "Previous MiniMax agentic model" },
    { id: "MiniMax-M2.5-highspeed", provider: "minimax", description: "Previous MiniMax fast mode" },
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
