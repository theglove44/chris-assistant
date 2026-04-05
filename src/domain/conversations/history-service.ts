import { archiveMessage } from "./archive-service.js";
import { ensureConversationStoreLoaded, saveConversationStore } from "./store.js";
import type { ConversationMessage, ConversationMeta } from "./types.js";
import { tryDream } from "../memory/dream-service.js";

const MAX_HISTORY = 20;

export async function addMessage(
  chatId: number,
  role: "user" | "assistant",
  content: string,
  meta?: ConversationMeta,
): Promise<void> {
  const store = await ensureConversationStoreLoaded();

  if (!store.has(chatId)) {
    store.set(chatId, []);
  }

  const history = store.get(chatId)!;
  const now = Date.now();
  history.push({ role, content, timestamp: now });
  archiveMessage(chatId, role, content, now, meta);

  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  await saveConversationStore(store);

  // Fire-and-forget: check if memory consolidation should run
  // Only trigger after assistant messages (not user messages)
  if (role === "assistant") {
    void tryDream().catch((err: any) => {
      console.error("[dream] tryDream error:", err.message);
    });
  }
}

export async function getHistory(chatId: number): Promise<ConversationMessage[]> {
  const store = await ensureConversationStoreLoaded();
  return store.get(chatId) ?? [];
}

export async function clearHistory(chatId: number): Promise<void> {
  const store = await ensureConversationStoreLoaded();
  store.delete(chatId);
  await saveConversationStore(store);
}

export async function formatHistoryForPrompt(chatId: number): Promise<string> {
  const history = await getHistory(chatId);
  if (history.length === 0) return "";

  const formatted = history
    .map((msg) => `${msg.role === "user" ? "Chris" : "Assistant"}: ${msg.content}`)
    .join("\n\n");

  return `# Recent Conversation\n\n${formatted}\n\n---\n\nChris's latest message follows:`;
}
