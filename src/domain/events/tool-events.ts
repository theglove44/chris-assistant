import { getEventContext } from "./context.js";
import { appendEvent } from "./log.js";

export async function recordToolCompleted(input: {
  name: string;
  provider: string;
  args: unknown;
  result: string;
  isError?: boolean;
}): Promise<void> {
  const context = getEventContext();
  try {
    await appendEvent({
      type: "tool.completed",
      chatId: context?.chatId,
      correlationId: context?.correlationId,
      payload: { ...input, isError: input.isError ?? false },
    });
  } catch (error: any) {
    console.error("[events] Failed to append tool event:", error.message);
  }
}
