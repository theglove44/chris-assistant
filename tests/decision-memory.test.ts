import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import {
  decisionsDueForRevisit,
  decisionRecordPath,
  formatDecisionDocument,
  formatDecisionFrontmatter,
  formatDecisionsDue,
  isIsoCalendarDate,
  validateDecision,
  type DecisionInput,
} from "../src/domain/memory/decision-service.js";
import { scanMemoryFiles } from "../src/domain/memory/memory-scan.js";
import { executeDecisionsDueForRevisit } from "../src/tools/decisions.js";

let tempDir: string | null = null;

const decision: DecisionInput = {
  date: "2026-07-01",
  chose: "Keep SQLite for v1",
  alternatives: [
    { name: "Move to Postgres", rejected_because: "migration cost exceeds current scale benefit" },
  ],
  reasoning_trace: ["Single-node workload remains within SQLite limits"],
  revisit_conditions: [
    { condition: "Concurrent writes become a bottleneck", status: "pending" },
    { condition: "Quarterly architecture review", review_on: "2026-07-10", status: "pending" },
  ],
};

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function writeDecision(input: DecisionInput, name = "decision.md"): Promise<string> {
  tempDir ??= await mkdtemp(join(tmpdir(), "chris-decisions-"));
  const path = join(tempDir, name);
  await writeFile(path, `---\n${formatDecisionFrontmatter(input)}\n---\n\nDecision details\n`);
  return path;
}

describe("counterfactual decision memory", () => {
  it("validates required counterfactual fields", () => {
    expect(validateDecision(decision)).toBeNull();
    expect(validateDecision({ ...decision, alternatives: [] })).toContain("at least one rejected option");
    expect(validateDecision({ ...decision, date: "01/07/2026" })).toContain("YYYY-MM-DD");
    expect(validateDecision({ ...decision, date: "2026-02-29" })).toContain("valid YYYY-MM-DD");
    expect(validateDecision({
      ...decision,
      revisit_conditions: [{ condition: "Impossible review", review_on: "2026-13-01" }],
    })).toContain("valid YYYY-MM-DD");
    expect(isIsoCalendarDate("2024-02-29")).toBe(true);
    expect(isIsoCalendarDate("2026-02-29")).toBe(false);
  });

  it("serializes stable YAML schema", async () => {
    const path = await writeDecision(decision);
    const saved = await readFile(path, "utf-8");

    expect(saved).toContain("type: decision");
    expect(saved).toContain("date: 2026-07-01");
    expect(saved).toContain("chose: Keep SQLite for v1");
    expect(saved).toContain("rejected_because:");
    expect(saved).toContain("reasoning_trace:");
    expect(saved).toContain("revisit_conditions:");

    const headers = await scanMemoryFiles(tempDir!);
    expect(headers).toEqual([
      expect.objectContaining({ filename: "decision.md", type: "decision" }),
    ]);
  });

  it("creates a stable durable decision path and document", () => {
    expect(decisionRecordPath(decision)).toBe("decisions/2026-07-01-keep-sqlite-for-v1.md");
    expect(formatDecisionDocument(decision)).toMatch(/^---\ntype: decision/);
    expect(formatDecisionDocument(decision)).toContain("## Decision: Keep SQLite for v1");
  });

  it("returns decisions whose review date is due", async () => {
    await writeDecision(decision, "due.md");
    await writeDecision({
      ...decision,
      chose: "Keep current queue",
      revisit_conditions: [{ condition: "Annual review", review_on: "2027-01-01" }],
    }, "future.md");

    const due = await decisionsDueForRevisit("2026-07-12", tempDir!);

    expect(due.map((record) => record.chose)).toEqual(["Keep SQLite for v1"]);
    expect(formatDecisionsDue(due, "2026-07-12")).toContain("Quarterly architecture review");
  });

  it("rejects impossible as_of dates", async () => {
    expect(await executeDecisionsDueForRevisit({ as_of: "2026-02-29" }))
      .toBe("Invalid as_of date; expected a valid YYYY-MM-DD date");
  });

  it("returns met conditions immediately and excludes dismissed conditions", async () => {
    await writeDecision({
      ...decision,
      revisit_conditions: [{ condition: "Latency exceeds SLO", status: "met" }],
    }, "met.md");
    await writeDecision({
      ...decision,
      chose: "Dismissed choice",
      revisit_conditions: [{ condition: "Old trigger", review_on: "2020-01-01", status: "dismissed" }],
    }, "dismissed.md");

    const due = await decisionsDueForRevisit("2026-07-12", tempDir!);
    expect(due.map((record) => record.chose)).toEqual(["Keep SQLite for v1"]);
  });
});
