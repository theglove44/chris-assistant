export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ConversationMeta {
  source?: "telegram" | "discord" | "scheduled";
  channelName?: string;
}

export interface ArchiveEntry {
  ts: number;
  chatId: number;
  role: "user" | "assistant";
  content: string;
  source?: "telegram" | "discord" | "scheduled";
  channelName?: string;
}
