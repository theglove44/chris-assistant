import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock the paths module before importing dream-lock
vi.mock("../../src/infra/storage/paths.js", () => {
  const testDir = path.join(os.tmpdir(), "chris-dream-test-" + process.pid);
  return {
    APP_DATA_DIR: testDir,
    appDataPath: (...parts: string[]) => path.join(testDir, ...parts),
  };
});

import { acquireLock, releaseLock, rollbackLock, hoursSinceLastConsolidation, lastConsolidatedAt } from "../src/domain/memory/dream-lock.js";
import { appDataPath } from "../src/infra/storage/paths.js";

const TEST_DIR = appDataPath();
const LOCK_FILE = appDataPath("dream.lock");

describe("dream-lock", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(TEST_DIR, { recursive: true }); } catch {}
  });

  describe("lastConsolidatedAt", () => {
    it("returns 0 when no lock file exists", () => {
      expect(lastConsolidatedAt()).toBe(0);
    });

    it("returns the lock file mtime when it exists", () => {
      fs.writeFileSync(LOCK_FILE, "test", "utf-8");
      const result = lastConsolidatedAt();
      expect(result).toBeGreaterThan(0);
      // Allow 100ms tolerance for filesystem timing
      expect(result).toBeLessThanOrEqual(Date.now() + 100);
    });
  });

  describe("hoursSinceLastConsolidation", () => {
    it("returns Infinity when never consolidated", () => {
      expect(hoursSinceLastConsolidation()).toBe(Infinity);
    });

    it("returns approximately 0 for a fresh lock", () => {
      fs.writeFileSync(LOCK_FILE, "test", "utf-8");
      const hours = hoursSinceLastConsolidation();
      expect(hours).toBeLessThan(0.01);
    });

    it("returns correct hours for an old lock", () => {
      fs.writeFileSync(LOCK_FILE, "test", "utf-8");
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      fs.utimesSync(LOCK_FILE, sixHoursAgo, sixHoursAgo);
      const hours = hoursSinceLastConsolidation();
      expect(hours).toBeGreaterThan(5.9);
      expect(hours).toBeLessThan(6.1);
    });
  });

  describe("acquireLock", () => {
    it("acquires when no lock exists", () => {
      expect(acquireLock()).toBe(true);
      expect(fs.existsSync(LOCK_FILE)).toBe(true);
      expect(fs.readFileSync(LOCK_FILE, "utf-8")).toBe(String(process.pid));
    });

    it("fails when a fresh lock exists", () => {
      fs.writeFileSync(LOCK_FILE, "9999", "utf-8");
      expect(acquireLock()).toBe(false);
    });

    it("acquires over a stale lock (> 1 hour)", () => {
      fs.writeFileSync(LOCK_FILE, "9999", "utf-8");
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(LOCK_FILE, twoHoursAgo, twoHoursAgo);
      expect(acquireLock()).toBe(true);
      expect(fs.readFileSync(LOCK_FILE, "utf-8")).toBe(String(process.pid));
    });
  });

  describe("releaseLock", () => {
    it("updates mtime to now", () => {
      fs.writeFileSync(LOCK_FILE, "test", "utf-8");
      const before = Date.now();
      releaseLock();
      const after = Date.now();
      const mtime = fs.statSync(LOCK_FILE).mtimeMs;
      expect(mtime).toBeGreaterThanOrEqual(before - 100);
      expect(mtime).toBeLessThanOrEqual(after + 100);
    });
  });

  describe("rollbackLock", () => {
    it("sets mtime to epoch 0", () => {
      fs.writeFileSync(LOCK_FILE, "test", "utf-8");
      rollbackLock();
      const mtime = fs.statSync(LOCK_FILE).mtimeMs;
      expect(mtime).toBeLessThan(1000);
    });

    it("does nothing if no lock file", () => {
      expect(() => rollbackLock()).not.toThrow();
    });
  });
});
