import { describe, expect, it } from "vitest";
import { matchesCron } from "../src/domain/schedules/cron.js";

describe("matchesCron", () => {
  it("matches an exact minute and hour", () => {
    const date = new Date(2026, 2, 9, 9, 30, 0, 0);
    expect(matchesCron("30 9 * * *", date)).toBe(true);
    expect(matchesCron("31 9 * * *", date)).toBe(false);
  });

  it("matches step values", () => {
    const onStep = new Date(2026, 2, 9, 10, 30, 0, 0);
    const offStep = new Date(2026, 2, 9, 10, 31, 0, 0);
    expect(matchesCron("*/15 * * * *", onStep)).toBe(true);
    expect(matchesCron("*/15 * * * *", offStep)).toBe(false);
  });

  it("matches comma-separated values", () => {
    const date = new Date(2026, 2, 9, 14, 0, 0, 0);
    expect(matchesCron("0 9,14,18 * * *", date)).toBe(true);
    expect(matchesCron("0 8,13,17 * * *", date)).toBe(false);
  });

  it("matches ranges", () => {
    const weekday = new Date(2026, 2, 11, 9, 0, 0, 0);
    expect(matchesCron("0 9 * * 1-5", weekday)).toBe(true);
  });

  it("treats 7 as sunday for day-of-week", () => {
    const sunday = new Date(2026, 2, 8, 12, 0, 0, 0);
    expect(matchesCron("0 12 * * 7", sunday)).toBe(true);
    expect(matchesCron("0 12 * * 0", sunday)).toBe(true);
  });

  it("returns false for invalid cron expressions", () => {
    const date = new Date(2026, 2, 9, 9, 0, 0, 0);
    expect(matchesCron("0 9 * *", date)).toBe(false);
    expect(matchesCron("nope", date)).toBe(false);
  });
});
