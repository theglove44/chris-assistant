/**
 * Token usage tracker — records per-call token usage to daily JSONL files.
 *
 * Each provider calls `recordUsage()` as a side-effect after receiving a
 * response. Data is appended to ~/.chris-assistant/usage/YYYY-MM-DD.jsonl.
 *
 * Pricing is loaded from ~/.chris-assistant/token-pricing.json (editable
 * without rebuild). Falls back to built-in defaults if the file is missing.
 */

import * as fs from "fs";
import * as path from "path";
import { appDataPath } from "./infra/storage/paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: "claude" | "openai" | "minimax" | "codex-agent";
}

interface UsageRecord {
  ts: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

interface ModelPricing {
  /** Cost per 1M input tokens in USD */
  input: number;
  /** Cost per 1M output tokens in USD */
  output: number;
}

export interface DailyUsageSummary {
  date: string;
  models: Record<string, {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
  }>;
  totalCost: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const USAGE_DIR = appDataPath("usage");
const PRICING_PATH = appDataPath("token-pricing.json");

function usageFilePath(date: string): string {
  return path.join(USAGE_DIR, `${date}.jsonl`);
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/** Built-in fallback pricing (per 1M tokens, USD). */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6":   { input: 3.00, output: 15.00 },
  "claude-sonnet-4-5-20250514": { input: 3.00, output: 15.00 },
  "claude-opus-4-6":     { input: 15.00, output: 75.00 },
  "gpt-4o":              { input: 2.50, output: 10.00 },
  "gpt-5.2":             { input: 5.00, output: 20.00 },
  "o4-mini":             { input: 1.10, output: 4.40 },
};

let cachedPricing: Record<string, ModelPricing> | null = null;
let pricingLoadedAt = 0;
const PRICING_CACHE_MS = 5 * 60 * 1000;

function loadPricing(): Record<string, ModelPricing> {
  const now = Date.now();
  if (cachedPricing && now - pricingLoadedAt < PRICING_CACHE_MS) {
    return cachedPricing;
  }

  let merged: Record<string, ModelPricing>;
  try {
    const raw = fs.readFileSync(PRICING_PATH, "utf-8");
    merged = { ...DEFAULT_PRICING, ...JSON.parse(raw) };
  } catch {
    merged = { ...DEFAULT_PRICING };
  }
  cachedPricing = merged;
  pricingLoadedAt = now;
  return merged;
}

function getPricing(model: string): ModelPricing {
  const pricing = loadPricing();
  // Exact match first, then prefix match (e.g. "gpt-5.2-turbo" matches "gpt-5.2")
  if (pricing[model]) return pricing[model];
  for (const key of Object.keys(pricing)) {
    if (model.startsWith(key)) return pricing[key];
  }
  return { input: 0, output: 0 };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a single API call's token usage. Fire-and-forget — errors are logged
 * but never thrown, so this never breaks the main chat flow.
 */
export function recordUsage(usage: TokenUsage): void {
  try {
    fs.mkdirSync(USAGE_DIR, { recursive: true });

    const record: UsageRecord = {
      ts: new Date().toISOString(),
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };

    fs.appendFileSync(usageFilePath(todayString()), JSON.stringify(record) + "\n");
  } catch (err: any) {
    console.error("[usage-tracker] Failed to record usage:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Reading & summarising
// ---------------------------------------------------------------------------

function readDayRecords(date: string): UsageRecord[] {
  const filePath = usageFilePath(date);
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function getDailySummary(date: string): DailyUsageSummary {
  const records = readDayRecords(date);
  const models: DailyUsageSummary["models"] = {};

  for (const r of records) {
    const key = r.model;
    if (!models[key]) {
      models[key] = { calls: 0, inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0, totalCost: 0 };
    }
    models[key].calls++;
    models[key].inputTokens += r.inputTokens;
    models[key].outputTokens += r.outputTokens;
  }

  let totalCost = 0;
  for (const [model, stats] of Object.entries(models)) {
    const pricing = getPricing(model);
    stats.inputCost = (stats.inputTokens / 1_000_000) * pricing.input;
    stats.outputCost = (stats.outputTokens / 1_000_000) * pricing.output;
    stats.totalCost = stats.inputCost + stats.outputCost;
    totalCost += stats.totalCost;
  }

  return { date, models, totalCost };
}

/**
 * Get the rolling average daily cost over the last N days.
 */
export function getRollingAverage(days: number = 7): number {
  let totalCost = 0;
  let daysWithData = 0;
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const summary = getDailySummary(dateStr);
    if (Object.keys(summary.models).length > 0) {
      totalCost += summary.totalCost;
      daysWithData++;
    }
  }

  return daysWithData > 0 ? totalCost / daysWithData : 0;
}

// ---------------------------------------------------------------------------
// Formatted report
// ---------------------------------------------------------------------------

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatUsageReport(date: string): string {
  const summary = getDailySummary(date);
  const avg = getRollingAverage(7);

  if (Object.keys(summary.models).length === 0) {
    return `📊 **Token Usage — ${date}**\n\nNo API calls recorded.`;
  }

  const lines: string[] = [`📊 **Token Usage — ${date}**`];

  // Sort models by total cost descending
  const sorted = Object.entries(summary.models).sort((a, b) => b[1].totalCost - a[1].totalCost);

  for (const [model, stats] of sorted) {
    lines.push("");
    lines.push(`🤖 **${model}**`);
    lines.push(`   ↳ ${stats.calls} calls  |  ${formatTokenCount(stats.inputTokens)} input  |  ${formatTokenCount(stats.outputTokens)} output`);
    lines.push(`   💰 $${stats.inputCost.toFixed(2)} + $${stats.outputCost.toFixed(2)} = **$${stats.totalCost.toFixed(2)}**`);
  }

  lines.push("");
  lines.push(`**Total today:** $${summary.totalCost.toFixed(2)}`);
  lines.push(`**7-day avg:** $${avg.toFixed(2)}/day`);

  return lines.join("\n");
}
