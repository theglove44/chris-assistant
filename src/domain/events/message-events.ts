import type { ConversationMeta } from "../conversations/types.js";
import { getEventContext } from "./context.js";
import { appendEvent } from "./log.js";

export async function recordMessageEvent(input: {
  chatId: number;
  role: "user" | "assistant";
  content: string;
  meta?: ConversationMeta;
  ts: number;
}): Promise<void> {
  const context = getEventContext();
  try {
    await appendEvent({
      type: input.role === "user" ? "message.received" : "message.sent",
      chatId: input.chatId,
      correlationId: context?.chatId === input.chatId ? context.correlationId : undefined,
      ts: input.ts,
      payload: { role: input.role, content: input.content, meta: input.meta },
    });
  } catch (error: any) {
    console.error("[events] Failed to append message event:", error.message);
  }
}
