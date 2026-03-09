import * as fs from "fs";
import { appDataPath } from "../../infra/storage/paths.js";
import type { ConversationMessage } from "./types.js";

export type ConversationStore = Record<string, ConversationMessage[]>;

export const CONVERSATIONS_FILE = appDataPath("conversations.json");

let conversations: Map<number, ConversationMessage[]> | null = null;
let writePromise: Promise<void> = Promise.resolve();

export async function ensureConversationStoreLoaded(): Promise<Map<number, ConversationMessage[]>> {
  if (conversations !== null) return conversations;

  await fs.promises.mkdir(appDataPath(), { recursive: true });

  try {
    const raw = await fs.promises.readFile(CONVERSATIONS_FILE, "utf-8");
    const store: ConversationStore = JSON.parse(raw);
    conversations = new Map(Object.entries(store).map(([key, messages]) => [Number(key), messages]));
  } catch {
    conversations = new Map();
  }

  return conversations;
}

export function saveConversationStore(store: Map<number, ConversationMessage[]>): Promise<void> {
  writePromise = writePromise
    .then(async () => {
      const serializable: ConversationStore = {};
      for (const [chatId, messages] of store) {
        serializable[String(chatId)] = messages;
      }
      await fs.promises.writeFile(CONVERSATIONS_FILE, JSON.stringify(serializable, null, 2), "utf-8");
    })
    .catch((err: Error) => {
      console.error("[conversation] Failed to save:", err.message);
    });

  return writePromise;
}
