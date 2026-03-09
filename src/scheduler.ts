/**
 * Scheduler compatibility facade.
 *
 * New domain code lives under src/domain/schedules/*.
 * This file preserves the existing public API for the rest of the app.
 */

export type { Schedule } from "./domain/schedules/types.js";
import { scheduleService } from "./domain/schedules/service.js";
import type { NewSchedule, Schedule, ScheduleUpdates } from "./domain/schedules/types.js";

export function startScheduler(): void {
  scheduleService.start();
}

export function stopScheduler(): void {
  scheduleService.stop();
}

export function getSchedules(): Schedule[] {
  return scheduleService.getSchedules();
}

export function addSchedule(task: NewSchedule): Schedule {
  return scheduleService.addSchedule(task);
}

export function removeSchedule(id: string): boolean {
  return scheduleService.removeSchedule(id);
}

export function updateSchedule(id: string, updates: ScheduleUpdates): Schedule | null {
  return scheduleService.updateSchedule(id, updates);
}

export function toggleSchedule(id: string): Schedule | null {
  return scheduleService.toggleSchedule(id);
}
