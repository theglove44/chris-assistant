import { Bot, Context } from "grammy";
import { config } from "./config.js";
import { chat } from "./providers/index.js";
import { addMessage, clearHistory } from "./conversation.js";
import { checkRateLimit } from "./rate-limit.js";

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

  // Show "typing" indicator while Claude thinks
  await ctx.replyWithChatAction("typing");

  // Keep the typing indicator alive for longer responses
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);

  try {
    // Record user message
    addMessage(ctx.chat.id, "user", userMessage);

    // Get AI response
    const rawResponse = await chat(ctx.chat.id, userMessage);

    // Strip <think>...</think> blocks (reasoning models emit these)
    const response = rawResponse.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Record assistant response
    addMessage(ctx.chat.id, "assistant", response);

    // Send response — split if too long for Telegram (4096 char limit)
    if (response.length <= 4096) {
      await ctx.reply(response, { parse_mode: "Markdown" }).catch(() =>
        // Fallback without markdown if parsing fails
        ctx.reply(response),
      );
    } else {
      // Split into chunks
      const chunks = splitMessage(response, 4096);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() =>
          ctx.reply(chunk),
        );
      }
    }
  } catch (error: any) {
    console.error("[telegram] Error handling message:", error);
    await ctx.reply("Something went wrong. Check the logs.");
  } finally {
    clearInterval(typingInterval);
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
