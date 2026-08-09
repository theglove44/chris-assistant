/** Authoritative model, provider, capability, and reasoning-effort registry. */

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type ProviderName = "openai" | "codex-agent" | "grok-agent" | "deepseek";

export interface ProviderCapabilities {
  mode: "personal-assistant" | "coding-agent" | "general-chat";
  summary: string;
  memoryRead: boolean;
  memoryWrite: boolean;
  semanticRecall: boolean;
  journal: boolean;
  nativeCodingTools: boolean;
  vision: boolean;
  schedulerSuitable: boolean;
}

interface ProviderDefinition {
  displayName: string;
  supportedPrefixes: readonly string[];
  matches: (model: string) => boolean;
  capabilities: ProviderCapabilities;
}

export interface ModelDefinition {
  id: string;
  provider: ProviderName;
  description: string;
  aliases?: readonly string[];
  contextWindow?: number;
  reasoning?: {
    defaultEffort: ReasoningEffort | null;
    supportedEfforts: readonly ReasoningEffort[];
  };
}

export interface ResolvedReasoningEffort {
  requested: ReasoningEffort | null;
  effective: ReasoningEffort | null;
  supported: readonly ReasoningEffort[];
}

export const DEFAULT_MODEL = "gpt-4o";
export const DEFAULT_CONTEXT_WINDOW = 128_000;

const FULL_GPT_56_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
const LUNA_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const GROK_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const DEEPSEEK_EFFORTS = ["high", "max"] as const;

export const PROVIDER_REGISTRY: Record<ProviderName, ProviderDefinition> = {
  "codex-agent": {
    displayName: "OpenAI Codex Agent",
    supportedPrefixes: ["codex-agent-"],
    matches: (model) => model.startsWith("codex-agent-"),
    capabilities: {
      mode: "coding-agent",
      summary: "Coding-focused Codex CLI agent with native workspace tools and injected memory context.",
      memoryRead: true, memoryWrite: false, semanticRecall: true, journal: false,
      nativeCodingTools: true, vision: false, schedulerSuitable: false,
    },
  },
  "grok-agent": {
    displayName: "Grok Agent",
    supportedPrefixes: ["grok-agent-"],
    matches: (model) => model.startsWith("grok-agent-"),
    capabilities: {
      mode: "coding-agent",
      summary: "OAuth-backed Grok CLI workspace agent with bounded native tools and no direct Chris memory or journal tools.",
      memoryRead: false, memoryWrite: false, semanticRecall: false, journal: false,
      nativeCodingTools: true, vision: false, schedulerSuitable: false,
    },
  },
  deepseek: {
    displayName: "DeepSeek",
    supportedPrefixes: ["deepseek-"],
    matches: (model) => model.startsWith("deepseek-"),
    capabilities: {
      mode: "personal-assistant",
      summary: "Text-only personal assistant path using the shared Chris tools, memory, recall, journal, and scheduler.",
      memoryRead: true, memoryWrite: true, semanticRecall: true, journal: true,
      nativeCodingTools: false, vision: false, schedulerSuitable: true,
    },
  },
  openai: {
    displayName: "OpenAI",
    supportedPrefixes: ["gpt-", "o3", "o4-"],
    matches: (model) => model.startsWith("gpt-") || model.startsWith("o3") || model.startsWith("o4-"),
    capabilities: {
      mode: "personal-assistant",
      summary: "Personal assistant path using the shared Chris tools, provider-wide memory recall, images, and schedules.",
      memoryRead: true, memoryWrite: true, semanticRecall: true, journal: true,
      nativeCodingTools: false, vision: true, schedulerSuitable: true,
    },
  },
};

const solReasoning = { defaultEffort: "low" as const, supportedEfforts: FULL_GPT_56_EFFORTS };
const terraReasoning = { defaultEffort: "medium" as const, supportedEfforts: FULL_GPT_56_EFFORTS };
const lunaReasoning = { defaultEffort: "medium" as const, supportedEfforts: LUNA_EFFORTS };

export const MODEL_REGISTRY: readonly ModelDefinition[] = [
  { id: "gpt-5.6", provider: "openai", aliases: ["gpt5", "gpt56"], contextWindow: 1_050_000, reasoning: solReasoning, description: "GPT-5.6 flagship" },
  { id: "gpt-5.6-sol", provider: "openai", aliases: ["gpt56-sol", "sol"], contextWindow: 1_050_000, reasoning: solReasoning, description: "GPT-5.6 Sol for demanding reasoning and coding" },
  { id: "gpt-5.6-terra", provider: "openai", aliases: ["gpt56-terra", "terra"], contextWindow: 1_050_000, reasoning: terraReasoning, description: "GPT-5.6 Terra balancing intelligence and cost" },
  { id: "gpt-5.6-luna", provider: "openai", aliases: ["gpt56-luna", "luna"], contextWindow: 1_050_000, reasoning: lunaReasoning, description: "GPT-5.6 Luna for efficient, high-volume work" },
  { id: "codex-agent-gpt-5.6", provider: "codex-agent", aliases: ["codex-agent"], reasoning: solReasoning, description: "Codex CLI agent on GPT-5.6 Sol" },
  { id: "codex-agent-gpt-5.6-sol", provider: "codex-agent", aliases: ["codex-sol"], reasoning: solReasoning, description: "Codex CLI agent on GPT-5.6 Sol" },
  { id: "codex-agent-gpt-5.6-terra", provider: "codex-agent", aliases: ["codex-agent-balanced", "codex-terra"], reasoning: terraReasoning, description: "Codex CLI agent on GPT-5.6 Terra" },
  { id: "codex-agent-gpt-5.6-luna", provider: "codex-agent", aliases: ["codex-agent-fast", "codex-luna"], reasoning: lunaReasoning, description: "Codex CLI agent on GPT-5.6 Luna" },
  { id: "grok-agent-grok-4.5", provider: "grok-agent", aliases: ["grok", "grok-agent"], reasoning: { defaultEffort: null, supportedEfforts: GROK_EFFORTS }, description: "OAuth-backed Grok 4.5 CLI workspace agent" },
  { id: "deepseek-v4-flash", provider: "deepseek", aliases: ["deepseek", "deepseek-flash"], reasoning: { defaultEffort: "high", supportedEfforts: DEEPSEEK_EFFORTS }, description: "DeepSeek V4 Flash text assistant" },
  { id: "deepseek-v4-pro", provider: "deepseek", aliases: ["deepseek-pro"], reasoning: { defaultEffort: "high", supportedEfforts: DEEPSEEK_EFFORTS }, description: "DeepSeek V4 Pro text assistant" },
  { id: "gpt-5.5", provider: "openai", aliases: ["gpt55"], contextWindow: 1_000_000, description: "Previous OpenAI flagship" },
  { id: "gpt-5.4", provider: "openai", aliases: ["gpt54"], contextWindow: 1_050_000, description: "Previous OpenAI frontier model" },
  { id: "gpt-5.4-mini", provider: "openai", aliases: ["gpt54-mini"], contextWindow: 400_000, description: "Compact GPT-5.4 model" },
  { id: "gpt-5.4-nano", provider: "openai", aliases: ["gpt54-nano"], contextWindow: 400_000, description: "Efficient GPT-5.4 model" },
  { id: "gpt-5.3-codex", provider: "openai", aliases: ["codex"], contextWindow: 400_000, description: "OpenAI Responses coding model" },
  { id: "gpt-5.3-codex-spark", provider: "openai", aliases: ["codex-spark"], description: "Low-latency Codex preview" },
  { id: "gpt-5.2", provider: "openai", aliases: ["gpt52"], contextWindow: 128_000, description: "Previous general-purpose model" },
  { id: "gpt-5.2-chat-latest", provider: "openai", contextWindow: 128_000, description: "Previous ChatGPT-style model" },
  { id: "gpt-5.2-pro", provider: "openai", contextWindow: 128_000, description: "Previous higher-compute model" },
  { id: "gpt-5.2-codex", provider: "openai", contextWindow: 400_000, description: "Previous Codex model" },
  { id: "gpt-5.1-codex-mini", provider: "openai", contextWindow: 400_000, description: "Previous compact Codex model" },
  { id: "o3", provider: "openai", contextWindow: 200_000, description: "Older reasoning model" },
  { id: "o3-mini", provider: "openai", contextWindow: 200_000, description: "Older compact reasoning model" },
  { id: "o3-pro", provider: "openai", contextWindow: 200_000, description: "Older enhanced reasoning model" },
  { id: "o3-deep-research", provider: "openai", contextWindow: 200_000, description: "Older deep-research model" },
  { id: "o4-mini", provider: "openai", contextWindow: 200_000, description: "Older fast reasoning model" },
  { id: "o4-mini-deep-research", provider: "openai", contextWindow: 200_000, description: "Older deep-research model" },
  { id: "gpt-4o", provider: "openai", aliases: ["gpt4o"], contextWindow: 128_000, description: "Previous multimodal model" },
  { id: "gpt-4o-mini", provider: "openai", contextWindow: 128_000, description: "Previous compact multimodal model" },
  { id: "gpt-4.1", provider: "openai", aliases: ["gpt41"], contextWindow: 1_000_000, description: "Previous coding model" },
  { id: "gpt-4.1-mini", provider: "openai", contextWindow: 1_000_000, description: "Previous compact GPT-4.1" },
  { id: "gpt-4.1-nano", provider: "openai", contextWindow: 1_000_000, description: "Previous efficient GPT-4.1" },
];

const PROVIDER_ORDER: readonly ProviderName[] = ["codex-agent", "grok-agent", "deepseek", "openai"];

export const SUPPORTED_PREFIXES = Object.fromEntries(
  PROVIDER_ORDER.map((provider) => [provider, PROVIDER_REGISTRY[provider].supportedPrefixes]),
) as Record<ProviderName, readonly string[]>;

export const PROVIDER_CAPABILITIES = Object.fromEntries(
  PROVIDER_ORDER.map((provider) => [provider, PROVIDER_REGISTRY[provider].capabilities]),
) as Record<ProviderName, ProviderCapabilities>;

export function providerForModel(model: string): ProviderName {
  const normalized = model.toLowerCase();
  const provider = PROVIDER_ORDER.find((name) => PROVIDER_REGISTRY[name].matches(normalized));
  if (provider) return provider;
  const prefixes = PROVIDER_ORDER.flatMap((name) => PROVIDER_REGISTRY[name].supportedPrefixes).join(", ");
  throw new Error(`Unknown model "${model}". Supported prefixes: ${prefixes}.`);
}

export const strictProviderForModel = providerForModel;
export const isCodexAgentModel = (model: string) => PROVIDER_REGISTRY["codex-agent"].matches(model.toLowerCase());
export const isGrokAgentModel = (model: string) => PROVIDER_REGISTRY["grok-agent"].matches(model.toLowerCase());
export const isDeepSeekModel = (model: string) => PROVIDER_REGISTRY.deepseek.matches(model.toLowerCase());
export const isOpenAiModel = (model: string) => PROVIDER_REGISTRY.openai.matches(model.toLowerCase());

export function providerDisplayName(model: string): string {
  return PROVIDER_REGISTRY[providerForModel(model)].displayName;
}

export function providerCapabilitiesForModel(model: string): ProviderCapabilities {
  return PROVIDER_REGISTRY[providerForModel(model)].capabilities;
}

export function providerCapabilitySummary(model: string): string {
  const capabilities = providerCapabilitiesForModel(model);
  const yesNo = (value: boolean) => value ? "yes" : "no";
  return [
    `Mode: ${capabilities.mode}`,
    `Memory read: ${yesNo(capabilities.memoryRead)}`,
    `Memory write: ${yesNo(capabilities.memoryWrite)}`,
    `Semantic recall: ${yesNo(capabilities.semanticRecall)}`,
    `Journal: ${yesNo(capabilities.journal)}`,
    `Native coding tools: ${yesNo(capabilities.nativeCodingTools)}`,
    `Vision: ${yesNo(capabilities.vision)}`,
    `Scheduler suitable: ${yesNo(capabilities.schedulerSuitable)}`,
  ].join("\n");
}

export function resolveModelAlias(input: string): string {
  const normalized = input.toLowerCase();
  return MODEL_REGISTRY.find((model) => model.aliases?.includes(normalized))?.id ?? input;
}

export function getModelContextWindow(model: string): number {
  return MODEL_REGISTRY.find((candidate) => candidate.id === model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

export function underlyingOpenAiModel(model: string): string {
  const underlying = model.replace(/^codex-agent-?/i, "").toLowerCase();
  return underlying === "gpt-5.6" ? "gpt-5.6-sol" : underlying;
}

export function resolveReasoningEffort(
  model: string,
  requested: ReasoningEffort | null | undefined,
): ResolvedReasoningEffort | null {
  const canonical = model.toLowerCase();
  const definition = MODEL_REGISTRY.find((candidate) => candidate.id === canonical)
    ?? MODEL_REGISTRY.find((candidate) => candidate.id === underlyingOpenAiModel(canonical));
  if (!definition?.reasoning) {
    if (requested) throw new Error(`Reasoning effort is not configured for model "${model}".`);
    return null;
  }
  if (requested && !definition.reasoning.supportedEfforts.includes(requested)) {
    throw new Error(
      `Reasoning effort "${requested}" is not supported by ${model}. `
      + `Supported efforts: ${definition.reasoning.supportedEfforts.join(", ")}.`,
    );
  }
  return {
    requested: requested ?? null,
    effective: requested ?? definition.reasoning.defaultEffort,
    supported: definition.reasoning.supportedEfforts,
  };
}

export function reasoningEffortReport(model: string, requested: ReasoningEffort | null | undefined): string | null {
  const resolved = resolveReasoningEffort(model, requested);
  if (!resolved) return null;
  return [
    `Requested effort: ${resolved.requested ?? "default"}`,
    `Effective effort: ${resolved.effective ?? "provider default"}`,
  ].join("\n");
}
