/**
 * Claude Agent SDK session persistence.
 *
 * Stores session IDs per chat so conversations can be resumed across messages.
 * The Agent SDK manages its own context — we just need to remember which
 * session ID belongs to which chat.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface SessionStore {
  [chatId: string]: {
    sessionId: string;
    updatedAt: number;
  };
}

const DATA_DIR = path.join(os.homedir(), ".chris-assistant");
const SESSIONS_FILE = path.join(DATA_DIR, "claude-sessions.json");

let sessions: SessionStore | null = null;

function ensureLoaded(): SessionStore {
  if (sessions !== null) return sessions;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
    sessions = JSON.parse(raw);
  } catch {
    sessions = {};
  }
  return sessions!;
}

function saveToDisk(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[claude-sessions] Failed to save:", err.message);
  }
}

export function getSessionId(chatId: number): string | null {
  const store = ensureLoaded();
  return store[String(chatId)]?.sessionId ?? null;
}

export function setSessionId(chatId: number, sessionId: string): void {
  const store = ensureLoaded();
  store[String(chatId)] = { sessionId, updatedAt: Date.now() };
  saveToDisk();
}

export function clearSession(chatId: number): void {
  const store = ensureLoaded();
  delete store[String(chatId)];
  saveToDisk();
}

export function clearAllSessions(): void {
  sessions = {};
  saveToDisk();
}
