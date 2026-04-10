import { archiveMessage } from "./archive-service.js";
import { ensureConversationStoreLoaded, saveConversationStore } from "./store.js";
import type { ConversationMessage, ConversationMeta } from "./types.js";
import { tryDream } from "../memory/dream-service.js";

const MAX_HISTORY = 20;
// Token budget for history injected into new Claude sessions.
// System prompt + memory recall already consume ~15-20k tokens;
// keep injected history well under that to avoid crowding the context.
const MAX_HISTORY_TOKENS = 8_000;

/** Conservative token estimate: ~3.5 characters per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

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

  // Build formatted lines newest-first, then reverse, to fit within token budget.
  // This ensures we always keep the most recent exchanges when history is long.
  const lines: string[] = [];
  let totalTokens = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    const line = `${msg.role === "user" ? "Chris" : "Assistant"}: ${msg.content}`;
    const tokens = estimateTokens(line);
    if (totalTokens + tokens > MAX_HISTORY_TOKENS) break;
    lines.unshift(line);
    totalTokens += tokens;
  }

  if (lines.length === 0) return "";

  return `# Recent Conversation\n\n${lines.join("\n\n")}\n\n---\n\nChris's latest message follows:`;
}
