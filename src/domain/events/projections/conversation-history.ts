import type { ConversationMessage } from "../../conversations/types.js";
import type { AssistantEvent, MessageEventPayload } from "../types.js";
import { listEventDates, readEvents } from "../log.js";

export interface ConversationProjectionOptions {
  until?: number;
  maxHistory?: number;
}

export function projectConversationHistory(
  events: AssistantEvent[],
  options: ConversationProjectionOptions = {},
): Map<number, ConversationMessage[]> {
  const projected = new Map<number, ConversationMessage[]>();
  const maxHistory = options.maxHistory ?? Number.POSITIVE_INFINITY;

  for (const event of events) {
    if (options.until !== undefined && event.ts > options.until) continue;
    if (event.chatId === undefined) continue;
    if (event.type !== "message.received" && event.type !== "message.sent") continue;

    const payload = event.payload as unknown as MessageEventPayload;
    const history = projected.get(event.chatId) ?? [];
    history.push({ role: payload.role, content: payload.content, timestamp: event.ts });
    if (history.length > maxHistory) history.splice(0, history.length - maxHistory);
    projected.set(event.chatId, history);
  }

  return projected;
}

/** Rebuilds the conversations.json-compatible in-memory view from all event shards. */
export async function rebuildConversationHistory(
  options: ConversationProjectionOptions = {},
): Promise<Map<number, ConversationMessage[]>> {
  const shards = await Promise.all(listEventDates().map((date) => readEvents(date)));
  return projectConversationHistory(shards.flat().sort((a, b) => a.ts - b.ts), options);
}
