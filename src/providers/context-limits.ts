/**
 * Context window sizes and compaction thresholds for known models.
 * Compaction triggers at 70% of the context window to leave room for the
 * compaction summary + continued tool use.
 */

import { getModelContextWindow } from "./model-routing.js";

interface ModelLimits {
  contextWindow: number;
  compactionThreshold: number;
}

function limits(contextWindow: number): ModelLimits {
  return {
    contextWindow,
    compactionThreshold: Math.floor(contextWindow * 0.7),
  };
}

export function getModelLimits(model: string): ModelLimits {
  return limits(getModelContextWindow(model));
}
