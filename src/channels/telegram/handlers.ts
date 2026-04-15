import type { Bot, Context } from "grammy";
import { addMessage } from "../../conversation.js";
import { toMarkdownV2, stripMarkdown, stripThinking } from "../../markdown.js";
import type { ImageAttachment } from "../../providers/types.js";
import { chatService } from "../../agent/chat-service.js";
import { downloadTelegramFile } from "./bot.js";

const RETRY_DELAY_MS = 2000;
const MAX_TEXT_BYTES = 50_000;
const EDIT_INTERVAL_MS = 1500;

async function chatWithRetry(
  chatId: number,
  userMessage: string,
  onChunk: (accumulated: string) => void,
  image?: ImageAttachment,
): Promise<string> {
  const images = image ? [image] : undefined;

  try {
    return await chatService.sendMessage({ chatId, userMessage, onChunk, images });
  } catch (firstError: any) {
    console.warn(
      "[telegram] chat() failed, retrying in %dms. Error: %s",
      RETRY_DELAY_MS,
      firstError?.message ?? firstError,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    console.log("[telegram] Retrying chat() now...");
    return await chatService.sendMessage({ chatId, userMessage, onChunk, images });
  }
}

async function reactTo(ctx: Context, emoji: string): Promise<void> {
  await ctx.api
    .setMessageReaction(ctx.chat!.id, ctx.message!.message_id, [
      { type: "emoji", emoji: emoji as any },
    ])
    .catch(() => {});
}

async function handleAiResponse(
  ctx: Context,
  userMessage: string,
  image?: ImageAttachment,
): Promise<void> {
  void reactTo(ctx, "👀");

  const sentMsg = await ctx.reply("...");
  const chatId = ctx.chat!.id;
  const messageId = sentMsg.message_id;

  let lastEditTime = 0;
  let lastEditedText = "...";

  const onChunk = (accumulated: string) => {
    const now = Date.now();
    if (now - lastEditTime < EDIT_INTERVAL_MS) return;

    const cleaned = stripThinking(accumulated);
    if (!cleaned || cleaned === lastEditedText) return;

    const preview = cleaned.length > 4000 ? cleaned.slice(0, 4000) + "..." : cleaned;
    const withCursor = preview + " ▍";

    lastEditTime = now;
    lastEditedText = cleaned;

    ctx.api.editMessageText(chatId, messageId, withCursor).catch(() => {});
  };

  try {
    const meta = { source: "telegram" as const };
    void addMessage(chatId, "user", userMessage, meta);

    const rawResponse = await chatWithRetry(chatId, userMessage, onChunk, image);

    const response = stripThinking(rawResponse);

    void addMessage(chatId, "assistant", response, meta);

    const chunks = response.length <= 4096 ? [response] : splitMessage(response, 4096);
    const firstChunk = chunks[0];

    await ctx.api
      .editMessageText(chatId, messageId, toMarkdownV2(firstChunk), {
        parse_mode: "HTML",
      })
      .catch(() =>
        ctx.api.editMessageText(chatId, messageId, stripMarkdown(firstChunk)).catch(() => {}),
      );

    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      await ctx.reply(toMarkdownV2(chunk), { parse_mode: "HTML" }).catch(
        () => ctx.reply(stripMarkdown(chunk)),
      );
    }

    void reactTo(ctx, "✅");
  } catch (error: any) {
    console.error("[telegram] Both chat() attempts failed:", error);
    await ctx.api
      .editMessageText(chatId, messageId, "Something went wrong. Check the logs.")
      .catch(() => {});
    void reactTo(ctx, "🚫");
  }
}

export function registerTelegramMessageHandlers(bot: Bot<Context>): void {
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    await handleAiResponse(ctx, ctx.message.text);
  });

  bot.on("message:photo", async (ctx) => {
    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];

      const buffer = await downloadTelegramFile(largest.file_id);
      const image: ImageAttachment = {
        base64: buffer.toString("base64"),
        mimeType: "image/jpeg",
      };

      const userMessage = ctx.message.caption || "What's in this image?";
      await handleAiResponse(ctx, userMessage, image);
    } catch (error: any) {
      console.error("[telegram] Error handling photo:", error);
      await ctx.reply("Sorry, I couldn't download that image. Try again.");
    }
  });

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    const fileName = doc.file_name || "unknown";
    const mimeType = doc.mime_type || "";

    const textMimePrefixes = ["text/", "application/json", "application/xml", "application/javascript"];
    const textExtensions = [
      ".txt", ".md", ".json", ".csv", ".xml", ".js", ".ts", ".py",
      ".html", ".css", ".yaml", ".yml", ".toml", ".ini", ".cfg",
      ".log", ".sh", ".bash",
    ];

    const isImage = mimeType.startsWith("image/");
    const isText =
      textMimePrefixes.some((prefix) => mimeType.startsWith(prefix)) ||
      textExtensions.some((ext) => fileName.toLowerCase().endsWith(ext));

    try {
      if (isImage) {
        const buffer = await downloadTelegramFile(doc.file_id);
        const image: ImageAttachment = {
          base64: buffer.toString("base64"),
          mimeType,
        };
        const userMessage = ctx.message.caption || "What's in this image?";
        await handleAiResponse(ctx, userMessage, image);
      } else if (isText) {
        const buffer = await downloadTelegramFile(doc.file_id);
        const text = buffer.toString("utf-8");
        const content = text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) + "\n\n[... truncated ...]" : text;

        const caption = ctx.message.caption || "Analyze this file.";
        const userMessage = `[File: ${fileName}]\n\n${content}\n\n---\n\n${caption}`;
        await handleAiResponse(ctx, userMessage);
      } else {
        const displayType = mimeType || "unknown type";
        await ctx.reply(
          `Sorry, I can't process ${displayType} files yet.\n\n` +
            "I can handle:\n" +
            "- Images (JPEG, PNG, GIF, WebP, etc.)\n" +
            "- Text files (.txt, .md, .json, .csv, .xml, .js, .ts, .py, .html, .css, .yaml, .toml, .sh, and more)",
        );
      }
    } catch (error: any) {
      console.error("[telegram] Error handling document:", error);
      await ctx.reply("Sorry, I couldn't process that file. Try again.");
    }
  });
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = remaining.lastIndexOf(". ", maxLength);
      if (splitAt !== -1) splitAt += 1;
    }
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
