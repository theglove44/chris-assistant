/**
 * Context window sizes and compaction thresholds for known models.
 * Compaction triggers at 70% of the context window to leave room for the
 * compaction summary + continued tool use.
 */

interface ModelLimits {
  contextWindow: number;
  compactionThreshold: number;
}

const MODEL_LIMITS: Record<string, ModelLimits> = {
  // Claude
  "claude-opus-4-6": limits(200_000),
  "claude-sonnet-4-6": limits(200_000),
  "claude-sonnet-4-5-20250929": limits(200_000),
  "claude-haiku-4-5-20251001": limits(200_000),
  // OpenAI — GPT-5 series
  "gpt-5.2": limits(128_000),
  "gpt-5.2-chat-latest": limits(128_000),
  "gpt-5.2-pro": limits(128_000),
  "GPT-5.3-Codex": limits(192_000),
  "GPT-5.2-Codex": limits(192_000),
  "GPT-5.1-Codex-Mini": limits(192_000),
  // OpenAI — o-series
  "o3": limits(200_000),
  "o3-mini": limits(200_000),
  "o3-pro": limits(200_000),
  "o3-deep-research": limits(200_000),
  "o4-mini": limits(200_000),
  "o4-mini-deep-research": limits(200_000),
  // OpenAI — GPT-4 series
  "gpt-4o": limits(128_000),
  "gpt-4o-mini": limits(128_000),
  "gpt-4.1": limits(1_000_000),
  "gpt-4.1-mini": limits(1_000_000),
  "gpt-4.1-nano": limits(1_000_000),
  // MiniMax
  "MiniMax-M2.5": limits(1_000_000),
  "MiniMax-M2.5-highspeed": limits(1_000_000),
};

function limits(contextWindow: number): ModelLimits {
  return {
    contextWindow,
    compactionThreshold: Math.floor(contextWindow * 0.7),
  };
}

const DEFAULT_LIMITS = limits(128_000);

export function getModelLimits(model: string): ModelLimits {
  return MODEL_LIMITS[model] || DEFAULT_LIMITS;
}
