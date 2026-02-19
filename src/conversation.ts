/**
 * Persistent conversation history.
 * Keeps the last N messages per chat so Claude has short-term context.
 * Persists to ~/.chris-assistant/conversations.json across restarts.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

type ConversationStore = Record<string, Message[]>;

const MAX_HISTORY = 20; // Last 20 messages (10 back-and-forth exchanges)

const DATA_DIR = path.join(os.homedir(), ".chris-assistant");
const CONVERSATIONS_FILE = path.join(DATA_DIR, "conversations.json");

let conversations: Map<number, Message[]> | null = null;

function ensureLoaded(): Map<number, Message[]> {
  if (conversations !== null) {
    return conversations;
  }

  // Create the directory if it doesn't exist
  fs.mkdirSync(DATA_DIR, { recursive: true });

  try {
    const raw = fs.readFileSync(CONVERSATIONS_FILE, "utf-8");
    const store: ConversationStore = JSON.parse(raw);
    conversations = new Map(
      Object.entries(store).map(([key, messages]) => [Number(key), messages])
    );
  } catch {
    // Missing file, invalid JSON, or any other read error — start fresh
    conversations = new Map();
  }

  return conversations;
}

function saveToDisk(store: Map<number, Message[]>): void {
  const serializable: ConversationStore = {};
  for (const [chatId, messages] of store) {
    serializable[String(chatId)] = messages;
  }
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(serializable, null, 2), "utf-8");
}

export function addMessage(chatId: number, role: "user" | "assistant", content: string): void {
  const store = ensureLoaded();

  if (!store.has(chatId)) {
    store.set(chatId, []);
  }
  const history = store.get(chatId)!;
  history.push({ role, content, timestamp: Date.now() });

  // Trim to max length
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  saveToDisk(store);
}

export function getHistory(chatId: number): Message[] {
  const store = ensureLoaded();
  return store.get(chatId) || [];
}

export function clearHistory(chatId: number): void {
  const store = ensureLoaded();
  store.delete(chatId);
  saveToDisk(store);
}

/**
 * Format conversation history as a string to prepend to the user prompt.
 * This gives Claude short-term memory within a conversation.
 */
export function formatHistoryForPrompt(chatId: number): string {
  const history = getHistory(chatId);
  if (history.length === 0) return "";

  const formatted = history
    .map((msg) => `${msg.role === "user" ? "Chris" : "Assistant"}: ${msg.content}`)
    .join("\n\n");

  return `# Recent Conversation\n\n${formatted}\n\n---\n\nChris's latest message follows:`;
}
