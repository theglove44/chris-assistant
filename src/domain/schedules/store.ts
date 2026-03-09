import { JsonStore } from "../../infra/storage/json-store.js";
import { appDataPath } from "../../infra/storage/paths.js";
import type { Schedule } from "./types.js";

const scheduleStore = new JsonStore<Schedule[]>(appDataPath("schedules.json"), []);

export function readSchedules(): Schedule[] {
  return scheduleStore.read();
}

export function writeSchedules(schedules: Schedule[]): void {
  scheduleStore.write(schedules);
}
