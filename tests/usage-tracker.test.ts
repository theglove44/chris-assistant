import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpDir = path.join(os.tmpdir(), `usage-tracker-test-${Date.now()}`);

vi.mock("../src/infra/storage/paths.js", async () => {
  const _os = await import("os");
  const _path = await import("path");
  const _fs = await import("fs");
  // Discover tmpDir at mock-init time via a marker file approach:
  // We just build a deterministic path the same way the outer scope does.
  // Since vi.mock is hoisted, we re-derive instead of referencing outer tmpDir.
  const dir = _path.default.join(_os.default.tmpdir(), `usage-tracker-test-mock`);
  return {
    APP_DATA_DIR: dir,
    appDataPath: (...parts: string[]) => _path.default.join(dir, ...parts),
  };
});

// We need the actual module's tmpDir to match the mock
const mockTmpDir = path.join(os.tmpdir(), "usage-tracker-test-mock");
const usageDir = path.join(mockTmpDir, "usage");

describe("usage-tracker", () => {
  beforeEach(() => {
    fs.mkdirSync(usageDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(mockTmpDir, { recursive: true, force: true });
  });

  it("recordUsage writes a JSONL line", async () => {
    const { recordUsage } = await import("../src/usage-tracker.js");

    recordUsage({
      inputTokens: 1000,
      outputTokens: 200,
      model: "claude-sonnet-4-6",
      provider: "claude",
    });

    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(usageDir, `${today}.jsonl`);
    expect(fs.existsSync(filePath)).toBe(true);

    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]);
    expect(record.provider).toBe("claude");
    expect(record.model).toBe("claude-sonnet-4-6");
    expect(record.inputTokens).toBe(1000);
    expect(record.outputTokens).toBe(200);
    expect(record.ts).toBeDefined();
  });

  it("getDailySummary aggregates by model", async () => {
    const { getDailySummary } = await import("../src/usage-tracker.js");

    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(usageDir, `${today}.jsonl`);

    const records = [
      { ts: new Date().toISOString(), provider: "claude", model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 200 },
      { ts: new Date().toISOString(), provider: "claude", model: "claude-sonnet-4-6", inputTokens: 500, outputTokens: 100 },
      { ts: new Date().toISOString(), provider: "openai", model: "gpt-4o", inputTokens: 800, outputTokens: 150 },
    ];
    fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const summary = getDailySummary(today);
    expect(summary.date).toBe(today);
    expect(summary.models["claude-sonnet-4-6"].calls).toBe(2);
    expect(summary.models["claude-sonnet-4-6"].inputTokens).toBe(1500);
    expect(summary.models["claude-sonnet-4-6"].outputTokens).toBe(300);
    expect(summary.models["gpt-4o"].calls).toBe(1);
    expect(summary.totalCost).toBeGreaterThan(0);
  });

  it("formatUsageReport produces readable output", async () => {
    const { formatUsageReport } = await import("../src/usage-tracker.js");

    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(usageDir, `${today}.jsonl`);

    const records = [
      { ts: new Date().toISOString(), provider: "claude", model: "claude-sonnet-4-6", inputTokens: 1_200_000, outputTokens: 180_000 },
    ];
    fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const report = formatUsageReport(today);
    expect(report).toContain("Token Usage");
    expect(report).toContain("claude-sonnet-4-6");
    expect(report).toContain("1.2M input");
    expect(report).toContain("180.0k output");
    expect(report).toContain("Total today");
  });

  it("getDailySummary returns empty for missing date", async () => {
    const { getDailySummary } = await import("../src/usage-tracker.js");

    const summary = getDailySummary("2020-01-01");
    expect(Object.keys(summary.models)).toHaveLength(0);
    expect(summary.totalCost).toBe(0);
  });
});
