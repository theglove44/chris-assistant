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

  await fs.promises.mkdir(EVENTS_DIR, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(EVENTS_DIR, 0o700);
  const handle = await fs.promises.open(eventFilePath(eventDate(event.ts)), "a", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.appendFile(`${JSON.stringify(event)}\n`, "utf-8");
  } finally {
    await handle.close();
  }
  return event;
}

export async function readEvents(date: string): Promise<AssistantEvent[]> {
  try {
    const raw = await fs.promises.readFile(eventFilePath(date), "utf-8");
    const events: AssistantEvent[] = [];
    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        events.push(JSON.parse(line) as AssistantEvent);
      } catch {
        console.warn("[events] Ignoring corrupt record in %s", eventFilePath(date));
      }
    }
    return events;
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

/** Removes one chat's events from a shard while retaining other chats and corrupt records. */
export async function redactEventEntries(chatId: number, date: string): Promise<number> {
  const filePath = eventFilePath(date);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const kept: string[] = [];
    let removed = 0;
    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        const event = JSON.parse(line) as AssistantEvent;
        if (event.chatId === chatId) removed++;
        else kept.push(line);
      } catch {
        kept.push(line);
      }
    }
    if (removed > 0) {
      await fs.promises.writeFile(filePath, kept.length > 0 ? `${kept.join("\n")}\n` : "", { mode: 0o600 });
      await fs.promises.chmod(filePath, 0o600);
    }
    return removed;
  } catch (error: any) {
    if (error?.code === "ENOENT") return 0;
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
