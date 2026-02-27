/**
 * Persistent conversation history.
 * Keeps the last N messages per chat so Claude has short-term context.
 * Persists to ~/.chris-assistant/conversations.json across restarts.
 *
 * All file I/O is async (fs.promises). A write queue serializes concurrent
 * saves so rapid back-to-back addMessage() calls never interleave writes.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { archiveMessage } from "./conversation-archive.js";

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

// Single-entry write queue — each save waits for the previous one to finish,
// preventing interleaved writes from concurrent addMessage() calls.
let writePromise: Promise<void> = Promise.resolve();

async function ensureLoaded(): Promise<Map<number, Message[]>> {
  if (conversations !== null) {
    return conversations;
  }

  // Create the directory if it doesn't exist
  await fs.promises.mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await fs.promises.readFile(CONVERSATIONS_FILE, "utf-8");
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

function saveToDisk(store: Map<number, Message[]>): Promise<void> {
  writePromise = writePromise
    .then(async () => {
      const serializable: ConversationStore = {};
      for (const [chatId, messages] of store) {
        serializable[String(chatId)] = messages;
      }
      await fs.promises.writeFile(
        CONVERSATIONS_FILE,
        JSON.stringify(serializable, null, 2),
        "utf-8"
      );
    })
    .catch((err: Error) => {
      console.error("[conversation] Failed to save:", err.message);
    });
  return writePromise;
}

export async function addMessage(
  chatId: number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const store = await ensureLoaded();

  if (!store.has(chatId)) {
    store.set(chatId, []);
  }
  const history = store.get(chatId)!;
  const now = Date.now();
  history.push({ role, content, timestamp: now });

  // Archive every message before the rolling window clips it
  archiveMessage(chatId, role, content, now);

  // Trim to max length
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  await saveToDisk(store);
}

export async function getHistory(chatId: number): Promise<Message[]> {
  const store = await ensureLoaded();
  return store.get(chatId) ?? [];
}

export async function clearHistory(chatId: number): Promise<void> {
  const store = await ensureLoaded();
  store.delete(chatId);
  await saveToDisk(store);
}

/**
 * Format conversation history as a string to prepend to the user prompt.
 * This gives non-session providers (OpenAI, MiniMax) short-term memory.
 *
 * When Claude is the active provider with session resume, the SDK manages
 * its own conversation context — call this only for non-Claude providers.
 */
export async function formatHistoryForPrompt(chatId: number): Promise<string> {
  const history = await getHistory(chatId);
  if (history.length === 0) return "";

  const formatted = history
    .map((msg) => `${msg.role === "user" ? "Chris" : "Assistant"}: ${msg.content}`)
    .join("\n\n");

  return `# Recent Conversation\n\n${formatted}\n\n---\n\nChris's latest message follows:`;
}
