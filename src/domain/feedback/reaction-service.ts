import * as fs from "fs";
import * as path from "path";
import { JsonStore } from "../../infra/storage/json-store.js";
import { appDataPath } from "../../infra/storage/paths.js";

const CONTEXT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AssistantMessageContext {
  chatId: number;
  messageId: number;
  userMessage: string;
  assistantMessage: string;
  responseTs: number;
}

export interface ReactionFeedbackEvent extends AssistantMessageContext {
  ts: number;
  previousReactions: string[];
  reactions: string[];
}

type ContextMap = Record<string, AssistantMessageContext>;

function contextKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function datestamp(ts: number): string {
  const date = new Date(ts);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function createReactionContextStore(
  filePath = appDataPath("feedback", "reaction-context.json"),
): JsonStore<ContextMap> {
  return new JsonStore<ContextMap>(filePath, {});
}

export function recordAssistantMessage(
  context: AssistantMessageContext,
  store = createReactionContextStore(),
): void {
  const cutoff = context.responseTs - CONTEXT_TTL_MS;
  store.update((current) => {
    const next: ContextMap = {};
    for (const [key, value] of Object.entries(current)) {
      if (value.responseTs >= cutoff) next[key] = value;
    }
    next[contextKey(context.chatId, context.messageId)] = context;
    return next;
  });
}

export function archiveReactionFeedback(
  event: ReactionFeedbackEvent,
  feedbackDir = appDataPath("feedback"),
): void {
  try {
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.appendFileSync(path.join(feedbackDir, `${datestamp(event.ts)}.jsonl`), `${JSON.stringify(event)}\n`);
  } catch (error: any) {
    console.error("[feedback] Failed to archive reaction: %s", error.message);
  }
}

export function recordReaction(
  input: Omit<ReactionFeedbackEvent, keyof AssistantMessageContext>,
  chatId: number,
  messageId: number,
  store = createReactionContextStore(),
  archive = archiveReactionFeedback,
): ReactionFeedbackEvent | null {
  const context = store.read()[contextKey(chatId, messageId)];
  if (!context) return null;
  const event: ReactionFeedbackEvent = { ...context, ...input };
  archive(event);
  return event;
}
