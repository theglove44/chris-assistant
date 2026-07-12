import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { appDataPath } from "../../infra/storage/paths.js";
import type { AssistantEvent, AssistantEventType } from "./types.js";

export const EVENTS_DIR = appDataPath("events");

export function eventDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function eventFilePath(date: string): string {
  return `${EVENTS_DIR}/${date}.jsonl`;
}

export async function appendEvent<TPayload>(input: {
  type: AssistantEventType;
  chatId?: number;
  payload: TPayload;
  correlationId?: string;
  ts?: number;
}): Promise<AssistantEvent<TPayload>> {
  const event: AssistantEvent<TPayload> = {
    id: randomUUID(),
    correlationId: input.correlationId ?? randomUUID(),
    ts: input.ts ?? Date.now(),
    type: input.type,
    ...(input.chatId === undefined ? {} : { chatId: input.chatId }),
    payload: input.payload,
  };

  await fs.promises.mkdir(EVENTS_DIR, { recursive: true });
  await fs.promises.appendFile(eventFilePath(eventDate(event.ts)), `${JSON.stringify(event)}\n`, "utf-8");
  return event;
}

export async function readEvents(date: string): Promise<AssistantEvent[]> {
  try {
    const raw = await fs.promises.readFile(eventFilePath(date), "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AssistantEvent);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function listEventDates(): string[] {
  try {
    return fs.readdirSync(EVENTS_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .map((name) => name.slice(0, -6))
      .sort();
  } catch {
    return [];
  }
}
