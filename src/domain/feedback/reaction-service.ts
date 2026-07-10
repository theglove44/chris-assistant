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
  reactionDelayMs: number;
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
  input: Omit<ReactionFeedbackEvent, keyof AssistantMessageContext | "reactionDelayMs">,
  chatId: number,
  messageId: number,
  store = createReactionContextStore(),
  archive = archiveReactionFeedback,
): ReactionFeedbackEvent | null {
  const context = store.read()[contextKey(chatId, messageId)];
  if (!context) return null;
  const event: ReactionFeedbackEvent = {
    ...context,
    ...input,
    reactionDelayMs: Math.max(0, input.ts - context.responseTs),
  };
  archive(event);
  return event;
}

export interface ReactionFeedbackSummary {
  totalEvents: number;
  reactionChanges: number;
  positive: number;
  negative: number;
  neutral: number;
  trend: "positive" | "negative" | "mixed" | "none";
  byReaction: Array<{ reaction: string; count: number }>;
  recent: Array<Pick<ReactionFeedbackEvent, "ts" | "reactions" | "reactionDelayMs" | "assistantMessage"> & { added: string[] }>;
}

const POSITIVE_REACTIONS = new Set(["👍", "❤️", "🔥", "🎯", "✅", "👏", "💯"]);
const NEGATIVE_REACTIONS = new Set(["👎", "😕", "😞"]);

function reactionDelta(previous: string[], next: string[]): string[] {
  const remaining = [...previous];
  const added: string[] = [];
  for (const reaction of next) {
    const index = remaining.indexOf(reaction);
    if (index === -1) added.push(reaction);
    else remaining.splice(index, 1);
  }
  return added;
}

export function readReactionFeedback(
  feedbackDir = appDataPath("feedback"),
  since = Date.now() - 7 * 24 * 60 * 60 * 1000,
): ReactionFeedbackEvent[] {
  try {
    return fs.readdirSync(feedbackDir)
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
      .flatMap((file) => {
        try {
          return fs.readFileSync(path.join(feedbackDir, file), "utf-8")
            .split("\n")
            .filter(Boolean)
            .flatMap((line) => {
              try {
                const event = JSON.parse(line) as ReactionFeedbackEvent;
                return typeof event.ts === "number" && Array.isArray(event.reactions) && Array.isArray(event.previousReactions)
                  ? [event]
                  : [];
              } catch {
                return [];
              }
            });
        } catch {
          return [];
        }
      })
      .filter((event) => event.ts >= since)
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export function summarizeReactionFeedback(events: ReactionFeedbackEvent[]): ReactionFeedbackSummary {
  const counts = new Map<string, number>();
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  for (const event of events) {
    const added = reactionDelta(event.previousReactions, event.reactions);
    for (const reaction of added) {
      counts.set(reaction, (counts.get(reaction) ?? 0) + 1);
      if (POSITIVE_REACTIONS.has(reaction)) positive++;
      else if (NEGATIVE_REACTIONS.has(reaction)) negative++;
      else neutral++;
    }
  }
  const recent = events.slice(0, 10).map((event) => {
    const added = reactionDelta(event.previousReactions, event.reactions);
    return {
      ts: event.ts,
      reactions: event.reactions,
      added,
      reactionDelayMs: event.reactionDelayMs ?? Math.max(0, event.ts - event.responseTs),
      assistantMessage: event.assistantMessage,
    };
  });

  const trend = positive === 0 && negative === 0
    ? "none"
    : positive === negative ? "mixed" : positive > negative ? "positive" : "negative";

  return {
    totalEvents: events.length,
    reactionChanges: positive + negative + neutral,
    positive,
    negative,
    neutral,
    trend,
    byReaction: [...counts.entries()]
      .map(([reaction, count]) => ({ reaction, count }))
      .sort((a, b) => b.count - a.count || a.reaction.localeCompare(b.reaction)),
    recent,
  };
}
