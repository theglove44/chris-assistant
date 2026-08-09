import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_MODEL,
  MODEL_REGISTRY,
  REASONING_EFFORTS,
  providerCapabilitiesForModel,
  providerCapabilitySummary,
  providerForModel,
  reasoningEffortReport,
  resolveModelAlias,
  resolveReasoningEffort,
  strictProviderForModel,
  type ReasoningEffort,
} from "../../providers/model-routing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(process.env.CHRIS_ASSISTANT_ENV_FILE || resolve(__dirname, "../../..", ".env"));

const KNOWN_MODELS = MODEL_REGISTRY.flatMap((model) =>
  (model.aliases ?? []).map((alias) => ({ alias, id: model.id, provider: model.provider })),
);

function readSetting(key: string): string | null {
  if (!existsSync(ENV_PATH)) return null;
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator !== -1 && trimmed.slice(0, separator).trim() === key) {
      return trimmed.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function currentModel(): string {
  return readSetting("AI_MODEL") ?? DEFAULT_MODEL;
}

function currentEffort(): ReasoningEffort | null {
  const value = readSetting("AI_REASONING_EFFORT");
  return value && REASONING_EFFORTS.includes(value as ReasoningEffort) ? value as ReasoningEffort : null;
}

function writeSelection(modelId: string, effort: ReasoningEffort | null): void {
  const original = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";
  let sawModel = false;
  const updated = original.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");
    const key = separator === -1 ? "" : trimmed.slice(0, separator).trim();
    if (key === "AI_REASONING_EFFORT") return [];
    if (key === "AI_MODEL") {
      sawModel = true;
      return [`AI_MODEL=${modelId}`];
    }
    return [line];
  });
  if (!sawModel) updated.push(`AI_MODEL=${modelId}`);
  if (effort) updated.push(`AI_REASONING_EFFORT=${effort}`);
  writeFileSync(ENV_PATH, updated.join("\n").replace(/^\n+/, "") + (updated.at(-1) === "" ? "" : "\n"));
}

function parseEffort(value: string | undefined): ReasoningEffort | null {
  if (!value) return null;
  const normalized = value.toLowerCase() as ReasoningEffort;
  if (!REASONING_EFFORTS.includes(normalized)) {
    throw new Error(`Unknown reasoning effort "${value}". Use: ${REASONING_EFFORTS.join(", ")}.`);
  }
  return normalized;
}

export function registerModelCommand(program: Command): void {
  const model = program.command("model").description("View or change the AI model and provider").action(() => {
    const selected = currentModel();
    const provider = providerForModel(selected);
    const capabilities = providerCapabilitiesForModel(selected);
    const report = reasoningEffortReport(selected, currentEffort());
    console.log("Current model: %s (%s)", selected, provider);
    if (report) console.log(report);
    console.log("Best use: %s\n", capabilities.summary);
    console.log(providerCapabilitySummary(selected));
    console.log("\nShortcuts:");
    for (const info of KNOWN_MODELS) {
      const marker = info.id === selected ? " ← active" : "";
      console.log("  %s %s %s%s", info.alias.padEnd(20), info.provider.padEnd(12), info.id, marker);
    }
    console.log("\nChange with: chris model set <name-or-id> [--effort <level>]");
  });

  model.command("set <model>")
    .description("Set the AI model and optional provider-valid reasoning effort")
    .option("--effort <effort>", "Requested reasoning effort")
    .action((input: string, options: { effort?: string }) => {
      const modelId = resolveModelAlias(input);
      const provider = strictProviderForModel(modelId);
      const requested = parseEffort(options.effort);
      resolveReasoningEffort(modelId, requested);
      writeSelection(modelId, requested);
      console.log("Model set to: %s (%s)", modelId, provider);
      const report = reasoningEffortReport(modelId, requested);
      if (report) console.log(report);
      console.log("Best use: %s", providerCapabilitiesForModel(modelId).summary);
      console.log('Run "chris restart" for this to take effect.');
    });

  model.command("search [query]").description("Search available models across all providers").action((query?: string) => {
    const needle = query?.toLowerCase();
    const filtered = needle
      ? MODEL_REGISTRY.filter((entry) => entry.id.includes(needle) || entry.provider.includes(needle) || entry.description.toLowerCase().includes(needle))
      : MODEL_REGISTRY;
    if (filtered.length === 0) {
      console.log('No models found matching "%s".', query);
      return;
    }
    console.log("Available models%s (%d):\n", query ? ` matching "${query}"` : "", filtered.length);
    for (const entry of filtered) {
      console.log("  %s  %s  %s", entry.id.padEnd(32), entry.provider.padEnd(12), entry.description);
    }
    console.log("\nUse: chris model set <model-id> [--effort <level>]");
  });
}
