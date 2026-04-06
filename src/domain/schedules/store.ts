import { JsonStore } from "../../infra/storage/json-store.js";
import { appDataPath } from "../../infra/storage/paths.js";
import { readMemoryFile, writeMemoryFile } from "../memory/repository.js";
import type { Schedule } from "./types.js";

const SCHEDULES_PATH = appDataPath("schedules.json");
const scheduleStore = new JsonStore<Schedule[]>(SCHEDULES_PATH, []);

export async function readSchedulesWithRecovery(): Promise<Schedule[]> {
  const local = scheduleStore.read();
  if (local.length > 0) return local;

  // Local file missing or empty — attempt GitHub restore
  try {
    const raw = await readMemoryFile("schedules.json");
    if (raw) {
      const restored = JSON.parse(raw) as Schedule[];
      if (restored.length > 0) {
        scheduleStore.write(restored);
        console.log("[schedules] Restored %d schedules from GitHub backup", restored.length);
        return restored;
      }
    }
  } catch (err: any) {
    console.error("[schedules] GitHub restore failed:", err.message);
  }

  return local;
}

export function readSchedules(): Schedule[] {
  return scheduleStore.read();
}

export function writeSchedules(schedules: Schedule[]): void {
  scheduleStore.write(schedules);
  // Fire-and-forget backup to GitHub memory repo
  writeMemoryFile(
    "schedules.json",
    JSON.stringify(schedules, null, 2),
    "backup: update schedules.json",
  ).catch((err: any) => {
    console.error("[schedules] Failed to backup schedules to GitHub:", err.message);
  });
}
