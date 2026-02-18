/**
 * Simple in-memory conversation history.
 * Keeps the last N messages per chat so Claude has short-term context.
 * Resets on server restart — long-term memory is in GitHub.
 */

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const MAX_HISTORY = 20; // Last 20 messages (10 back-and-forth exchanges)
const conversations = new Map<number, Message[]>();

export function addMessage(chatId: number, role: "user" | "assistant", content: string): void {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }
  const history = conversations.get(chatId)!;
  history.push({ role, content, timestamp: Date.now() });

  // Trim to max length
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

export function getHistory(chatId: number): Message[] {
  return conversations.get(chatId) || [];
}

export function clearHistory(chatId: number): void {
  conversations.delete(chatId);
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
