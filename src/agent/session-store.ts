import { JsonStore } from "../infra/storage/json-store.js";
import { appDataPath } from "../infra/storage/paths.js";

interface SessionRecord {
  value: string;
  updatedAt: number;
}

type SessionMap = Record<string, SessionRecord>;

function createSessionStore(fileName: string): JsonStore<SessionMap> {
  return new JsonStore<SessionMap>(appDataPath(fileName), {});
}

export function getStoredSessionValue(store: JsonStore<SessionMap>, chatId: number): string | null {
  return store.read()[String(chatId)]?.value ?? null;
}

export function setStoredSessionValue(store: JsonStore<SessionMap>, chatId: number, value: string): void {
  const data = store.read();
  data[String(chatId)] = { value, updatedAt: Date.now() };
  store.write(data);
}

export function clearStoredSessionValue(store: JsonStore<SessionMap>, chatId: number): void {
  const data = store.read();
  delete data[String(chatId)];
  store.write(data);
}

export function clearAllStoredSessionValues(store: JsonStore<SessionMap>): void {
  store.reset();
}

export { createSessionStore };
