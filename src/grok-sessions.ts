import {
  clearAllStoredSessionValues,
  clearStoredSessionValue,
  createSessionStore,
  getStoredSessionValue,
  setStoredSessionValue,
} from "./agent/session-store.js";

const store = createSessionStore("grok-sessions.json");

export function getGrokSessionId(chatId: number): string | null {
  return getStoredSessionValue(store, chatId);
}

export function setGrokSessionId(chatId: number, sessionId: string): void {
  setStoredSessionValue(store, chatId, sessionId);
}

export function clearGrokSession(chatId: number): void {
  clearStoredSessionValue(store, chatId);
}

export function clearAllGrokSessions(): void {
  clearAllStoredSessionValues(store);
}
