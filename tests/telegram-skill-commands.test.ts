import { describe, expect, it } from "vitest";
import {
  buildSkillCommandPlan,
  sanitizeSkillCommand,
  sanitizeSkillDescription,
} from "../src/channels/telegram/skill-commands.js";
import type { SkillIndexEntry } from "../src/skills/loader.js";

describe("sanitizeSkillCommand", () => {
  it("lowercases letters", () => {
    expect(sanitizeSkillCommand("MarketSnapshot")).toBe("marketsnapshot");
  });

  it("converts kebab and space separators to underscores", () => {
    expect(sanitizeSkillCommand("market-snapshot")).toBe("market_snapshot");
    expect(sanitizeSkillCommand("market snapshot")).toBe("market_snapshot");
  });

  it("collapses runs of invalid chars into a single underscore", () => {
    expect(sanitizeSkillCommand("a -- b // c")).toBe("a_b_c");
  });

  it("strips leading and trailing underscores", () => {
    expect(sanitizeSkillCommand("--hello--")).toBe("hello");
  });

  it("truncates to 32 characters", () => {
    const long = "a".repeat(40);
    expect(sanitizeSkillCommand(long)).toHaveLength(32);
  });

  it("returns null when nothing valid remains", () => {
    expect(sanitizeSkillCommand("---")).toBeNull();
    expect(sanitizeSkillCommand("")).toBeNull();
    expect(sanitizeSkillCommand("///")).toBeNull();
  });

  it("preserves digits and underscores", () => {
    expect(sanitizeSkillCommand("trading_runbook_v2")).toBe("trading_runbook_v2");
  });
});

describe("sanitizeSkillDescription", () => {
  it("returns the description when within bounds", () => {
    expect(sanitizeSkillDescription("Run a market snapshot", "fallback")).toBe(
      "Run a market snapshot",
    );
  });

  it("falls back when description is empty", () => {
    expect(sanitizeSkillDescription("", "MarketSnapshot")).toBe("MarketSnapshot");
  });

  it("pads short descriptions to satisfy Telegram's 3-char minimum", () => {
    const out = sanitizeSkillDescription("a", "fallback");
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it("truncates to 256 characters", () => {
    const long = "x".repeat(400);
    expect(sanitizeSkillDescription(long, "fallback")).toHaveLength(256);
  });
});

describe("buildSkillCommandPlan", () => {
  const staticMenu = [
    { command: "start", description: "Greeting" },
    { command: "purge", description: "Full clear" },
  ];

  const skill = (overrides: Partial<SkillIndexEntry>): SkillIndexEntry => ({
    id: "test-skill",
    name: "Test Skill",
    description: "Run a test",
    enabled: true,
    triggers: [],
    ...overrides,
  });

  it("merges static commands with sanitized skill commands", () => {
    const plan = buildSkillCommandPlan(staticMenu, [
      skill({ id: "market", name: "market-snapshot", description: "Daily market" }),
    ]);
    expect(plan.entries.map((e) => e.command)).toEqual(["start", "purge", "market_snapshot"]);
    expect(plan.skillIdByCommand.get("market_snapshot")).toBe("market");
    expect(plan.skipped).toEqual([]);
  });

  it("static commands win on conflict", () => {
    const plan = buildSkillCommandPlan(staticMenu, [
      skill({ id: "evil-start", name: "start", description: "should be skipped" }),
    ]);
    expect(plan.entries.find((e) => e.command === "start")?.description).toBe("Greeting");
    expect(plan.skillIdByCommand.has("start")).toBe(false);
    expect(plan.skipped[0]?.reason).toMatch(/collides/);
  });

  it("skips disabled skills", () => {
    const plan = buildSkillCommandPlan(staticMenu, [
      skill({ id: "off", name: "OffSkill", enabled: false }),
    ]);
    expect(plan.skillIdByCommand.size).toBe(0);
    expect(plan.skipped[0]?.reason).toBe("disabled");
  });

  it("skips skills whose names sanitize to nothing and have no usable id either", () => {
    const plan = buildSkillCommandPlan(staticMenu, [
      skill({ id: "---", name: "///" }),
    ]);
    expect(plan.skillIdByCommand.size).toBe(0);
    expect(plan.skipped[0]?.reason).toMatch(/no valid characters/);
  });

  it("falls back to the skill id when the name sanitizes to empty", () => {
    const plan = buildSkillCommandPlan(staticMenu, [
      skill({ id: "fallback_id", name: "///" }),
    ]);
    expect(plan.skillIdByCommand.get("fallback_id")).toBe("fallback_id");
  });

  it("skips a second skill that collides with the first", () => {
    const plan = buildSkillCommandPlan(staticMenu, [
      skill({ id: "a", name: "duplicate" }),
      skill({ id: "b", name: "Duplicate" }),
    ]);
    expect(plan.skillIdByCommand.size).toBe(1);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.id).toBe("b");
  });
});
