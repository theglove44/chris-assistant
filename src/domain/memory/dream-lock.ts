import * as fs from "fs";
import { appDataPath } from "../../infra/storage/paths.js";

const LOCK_FILE = appDataPath("dream.lock");
const STALE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get the last consolidation timestamp from the lock file mtime.
 * Returns 0 if no lock file exists (never consolidated).
 */
export function lastConsolidatedAt(): number {
  try {
    const stat = fs.statSync(LOCK_FILE);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Hours since the last successful consolidation.
 */
export function hoursSinceLastConsolidation(): number {
  const last = lastConsolidatedAt();
  if (last === 0) return Infinity;
  return (Date.now() - last) / (1000 * 60 * 60);
}

/**
 * Acquire the consolidation lock. Returns true if acquired.
 * Clears stale locks (> 1 hour old, regardless of PID).
 */
export function acquireLock(): boolean {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const stat = fs.statSync(LOCK_FILE);
      const age = Date.now() - stat.mtimeMs;

      if (age < STALE_MS) {
        return false;
      }

      console.log("[dream] Removing stale lock (%d min old)", Math.round(age / 60000));
    }

    fs.mkdirSync(appDataPath(), { recursive: true });
    fs.writeFileSync(LOCK_FILE, String(process.pid), "utf-8");
    return true;
  } catch (err: any) {
    console.error("[dream] Failed to acquire lock:", err.message);
    return false;
  }
}

/**
 * Release the lock. The mtime becomes "last consolidated at".
 */
export function releaseLock(): void {
  try {
    const now = new Date();
    fs.utimesSync(LOCK_FILE, now, now);
  } catch {
    try {
      fs.writeFileSync(LOCK_FILE, "", "utf-8");
    } catch (err: any) {
      console.error("[dream] Failed to release lock:", err.message);
    }
  }
}

/**
 * Roll back the lock on failure — rewind mtime so the next session retries.
 */
export function rollbackLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const epoch = new Date(0);
      fs.utimesSync(LOCK_FILE, epoch, epoch);
    }
  } catch (err: any) {
    console.error("[dream] Failed to rollback lock:", err.message);
  }
}
