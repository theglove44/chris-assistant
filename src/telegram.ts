import { Bot, Context } from "grammy";
import { config } from "./config.js";
import { chat } from "./providers/index.js";
import { addMessage, clearHistory } from "./conversation.js";
import { checkRateLimit } from "./rate-limit.js";
import { toMarkdownV2 } from "./markdown.js";

const bot = new Bot(config.telegram.botToken);

/**
 * Guard: only respond to the allowed user.
 */
function isAllowedUser(ctx: Context): boolean {
  return ctx.from?.id === config.telegram.allowedUserId;
}

// /start command
bot.command("start", async (ctx) => {
  if (!isAllowedUser(ctx)) {
    await ctx.reply("Sorry, this bot is private.");
    return;
  }
  await ctx.reply("Hey Chris. I'm here whenever you need me.");
});

// /clear — reset conversation history
bot.command("clear", async (ctx) => {
  if (!isAllowedUser(ctx)) return;
  clearHistory(ctx.chat.id);
  await ctx.reply("Conversation cleared. Memory is still intact.");
});

// Handle all text messages
bot.on("message:text", async (ctx) => {
  if (!isAllowedUser(ctx)) {
    console.log("[telegram] Blocked message from user %d", ctx.from?.id);
    return;
  }

  const rateLimit = checkRateLimit(ctx.from.id);
  if (!rateLimit.allowed) {
    const retryAfterSecs = Math.ceil(rateLimit.retryAfterMs / 1000);
    await ctx.reply(`Slow down — try again in ${retryAfterSecs} seconds.`);
    return;
  }

  const userMessage = ctx.message.text;

  // Send placeholder message immediately — streaming edits will update it
  const sentMsg = await ctx.reply("...");
  const chatId = ctx.chat.id;
  const messageId = sentMsg.message_id;

  // Streaming state
  let lastEditTime = 0;
  let lastEditedText = "...";
  const EDIT_INTERVAL_MS = 1500; // Stay well within Telegram's rate limit

  const onChunk = (accumulated: string) => {
    const now = Date.now();
    if (now - lastEditTime < EDIT_INTERVAL_MS) return;

    // Strip think tags from streaming preview
    const cleaned = accumulated.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!cleaned || cleaned === lastEditedText) return;

    // Truncate for Telegram limit, add cursor
    const preview = cleaned.length > 4000 ? cleaned.slice(0, 4000) + "..." : cleaned;
    const withCursor = preview + " ▍";

    lastEditTime = now;
    lastEditedText = cleaned;

    // Fire and forget — don't await, don't let errors interrupt streaming
    ctx.api.editMessageText(chatId, messageId, withCursor).catch(() => {});
  };

  try {
    addMessage(ctx.chat.id, "user", userMessage);

    const rawResponse = await chat(ctx.chat.id, userMessage, onChunk);

    // Strip <think>...</think> blocks (reasoning models emit these)
    const response = rawResponse.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    addMessage(ctx.chat.id, "assistant", response);

    // Final render — replace the streaming message with the complete response.
    // Split on the original text (before MarkdownV2 conversion) so escape
    // characters don't inflate chunk sizes, then convert each chunk separately.
    const chunks = response.length <= 4096 ? [response] : splitMessage(response, 4096);

    // First chunk: edit the placeholder message that was sent at the start
    const firstChunk = chunks[0];
    await ctx.api
      .editMessageText(chatId, messageId, toMarkdownV2(firstChunk), {
        parse_mode: "MarkdownV2",
      })
      .catch(() =>
        ctx.api.editMessageText(chatId, messageId, firstChunk).catch(() => {}),
      );

    // Remaining chunks: send as new messages
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      await ctx.reply(toMarkdownV2(chunk), { parse_mode: "MarkdownV2" }).catch(
        () => ctx.reply(chunk),
      );
    }
  } catch (error: any) {
    console.error("[telegram] Error handling message:", error);
    // Edit the placeholder to show error instead of leaving "..." hanging
    await ctx.api
      .editMessageText(chatId, messageId, "Something went wrong. Check the logs.")
      .catch(() => {});
  }
});

/**
 * Split a message into chunks at paragraph boundaries.
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Find a good split point (paragraph break, then sentence, then hard cut)
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = remaining.lastIndexOf(". ", maxLength);
      if (splitAt !== -1) splitAt += 1; // Include the period
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

export { bot };
