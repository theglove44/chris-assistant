import { EventEmitter } from "node:events";
import type { ConversationMeta } from "./types.js";

export interface ConversationEvent {
  chatId: number;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  meta?: ConversationMeta;
}

export const conversationEvents = new EventEmitter();
conversationEvents.setMaxListeners(50);
