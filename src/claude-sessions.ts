/**
 * Claude Agent SDK session persistence.
 *
 * Stores session IDs per chat so conversations can be resumed across messages.
 * The Agent SDK manages its own context — we just need to remember which
 * session ID belongs to which chat.
 */

import {
  clearAllStoredSessionValues,
  clearStoredSessionValue,
  createSessionStore,
  getStoredSessionValue,
  setStoredSessionValue,
} from "./agent/session-store.js";

const store = createSessionStore("claude-sessions.json");

export function getSessionId(chatId: number): string | null {
  return getStoredSessionValue(store, chatId);
}

export function setSessionId(chatId: number, sessionId: string): void {
  setStoredSessionValue(store, chatId, sessionId);
}

export function clearSession(chatId: number): void {
  clearStoredSessionValue(store, chatId);
}

export function clearAllSessions(): void {
  clearAllStoredSessionValues(store);
}
