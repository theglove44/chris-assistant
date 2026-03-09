export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  createdAt: number;
  lastRun: number | null;
  allowedTools?: string[];
  discordChannel?: string;
}

export type NewSchedule = Omit<Schedule, "id" | "createdAt" | "lastRun" | "allowedTools" | "discordChannel"> & {
  allowedTools?: string[];
  discordChannel?: string;
};

export type ScheduleUpdates = Partial<Pick<Schedule, "name" | "prompt" | "schedule" | "enabled" | "allowedTools" | "discordChannel">>;
