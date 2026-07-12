import type { ConversationMeta } from "../conversations/types.js";

export type AssistantEventType = "message.received" | "message.sent" | "tool.completed";

export interface AssistantEvent<TPayload = Record<string, unknown>> {
  id: string;
  correlationId: string;
  ts: number;
  type: AssistantEventType;
  chatId?: number;
  payload: TPayload;
}

export interface MessageEventPayload {
  role: "user" | "assistant";
  content: string;
  meta?: ConversationMeta;
}

export interface ToolCompletedEventPayload {
  name: string;
  provider: string;
  args: unknown;
  result: string;
  isError: boolean;
}
