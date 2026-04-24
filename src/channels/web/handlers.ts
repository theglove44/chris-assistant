import { addMessage } from "../../conversation.js";
import { chatService } from "../../agent/chat-service.js";
import { config } from "../../config.js";
import type { ImageAttachment } from "../../providers/types.js";

export interface HandleWebMessageOptions {
  text: string;
  images?: ImageAttachment[];
  onChunk: (accumulated: string) => void;
  signal: AbortSignal;
}

export async function handleWebMessage(opts: HandleWebMessageOptions): Promise<void> {
  const chatId = config.telegram.allowedUserId;
  const meta = { source: "web" as const };

  const onAbort = () => {
    chatService.abort(chatId);
  };
  opts.signal.addEventListener("abort", onAbort, { once: true });

  try {
    await addMessage(chatId, "user", opts.text, meta);
    const reply = await chatService.sendMessage({
      chatId,
      userMessage: opts.text,
      onChunk: opts.onChunk,
      images: opts.images,
    });
    await addMessage(chatId, "assistant", reply, meta);
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }
}

export function parseDataUrlImages(raw: unknown): ImageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ImageAttachment[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const match = entry.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) continue;
    out.push({ mimeType: match[1]!, base64: match[2]! });
  }
  return out.length > 0 ? out : undefined;
}
