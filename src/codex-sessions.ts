import {
  clearAllStoredSessionValues,
  clearStoredSessionValue,
  createSessionStore,
  getStoredSessionValue,
  setStoredSessionValue,
} from "./agent/session-store.js";

const store = createSessionStore("codex-sessions.json");

export function getThreadId(chatId: number): string | null {
  return getStoredSessionValue(store, chatId);
}

export function setThreadId(chatId: number, threadId: string): void {
  setStoredSessionValue(store, chatId, threadId);
}

export function clearThread(chatId: number): void {
  clearStoredSessionValue(store, chatId);
}

export function clearAllThreads(): void {
  clearAllStoredSessionValues(store);
}
