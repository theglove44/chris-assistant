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
  let argsBytes = 0;
  try {
    argsBytes = Buffer.byteLength(JSON.stringify(input.args) ?? "", "utf-8");
  } catch {
    // Circular or otherwise unserializable arguments: record no content.
  }
  try {
    await appendEvent({
      type: "tool.completed",
      chatId: context?.chatId,
      correlationId: context?.correlationId,
      payload: {
        name: input.name,
        provider: input.provider,
        argsBytes,
        resultBytes: Buffer.byteLength(input.result, "utf-8"),
        isError: input.isError ?? false,
      },
    });
  } catch (error: any) {
    console.error("[events] Failed to append tool event:", error.message);
  }
}
