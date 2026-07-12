import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

interface EventContext {
  chatId: number;
  correlationId: string;
}

const eventContext = new AsyncLocalStorage<EventContext>();

export function withEventContext<T>(chatId: number, operation: () => Promise<T>): Promise<T> {
  const existing = eventContext.getStore();
  if (existing?.chatId === chatId) return operation();
  return eventContext.run({ chatId, correlationId: randomUUID() }, operation);
}

export function getEventContext(): EventContext | undefined {
  return eventContext.getStore();
}
