import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { clearHistory } from "../../conversation.js";
import { chatService } from "../../agent/chat-service.js";
import { datestamp, redactArchiveEntries, uploadArchives } from "../../conversation-archive.js";
import { eventDate, redactEventEntries } from "../../domain/events/log.js";
import { encodeCallback, parseCallbackData } from "./callback-data.js";

export function purgeConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes, purge", encodeCallback("purge:yes"))
    .text("Cancel", encodeCallback("purge:no"));
}

export function restartConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes, restart", encodeCallback("restart:yes"))
    .text("Cancel", encodeCallback("restart:no"));
}

async function clearKeyboard(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery?.message) return;
  await ctx.api
    .editMessageReplyMarkup(
      ctx.callbackQuery.message.chat.id,
      ctx.callbackQuery.message.message_id,
      { reply_markup: { inline_keyboard: [] } },
    )
    .catch(() => {});
}

export function registerTelegramCallbackHandlers(bot: Bot<Context>): void {
  bot.on("callback_query:data", async (ctx) => {
    const action = parseCallbackData(ctx.callbackQuery.data);

    if (!action) {
      // Always answer to clear the spinner, even on unknown payloads.
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    const chatId = ctx.callbackQuery.message?.chat.id;
    if (chatId === undefined) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    switch (action) {
      case "purge:yes": {
        await clearHistory(chatId);
        chatService.clearSession(chatId);
        const today = datestamp();
        const removed = redactArchiveEntries(chatId, today);
        const removedEvents = await redactEventEntries(chatId, eventDate(Date.now()));
        if (removed > 0) {
          uploadArchives().catch((err: any) => {
            console.error("[telegram] Failed to upload redacted archive:", err.message);
          });
        }
        await clearKeyboard(ctx);
        await ctx.answerCallbackQuery({ text: "Purged" }).catch(() => {});
        await ctx.reply(
          removed > 0 || removedEvents > 0
            ? `Conversation purged. ${removed} archive entries and ${removedEvents} events removed from today's logs.`
            : "Conversation cleared. No archive entries or events found for today.",
        );
        return;
      }

      case "purge:no": {
        await clearKeyboard(ctx);
        await ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => {});
        await ctx.reply("Purge cancelled.");
        return;
      }

      case "restart:yes": {
        await clearKeyboard(ctx);
        await ctx.answerCallbackQuery({ text: "Restarting" }).catch(() => {});
        await ctx.reply("Restarting... back in a few seconds.");
        setTimeout(() => process.exit(0), 1500);
        return;
      }

      case "restart:no": {
        await clearKeyboard(ctx);
        await ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => {});
        await ctx.reply("Restart cancelled.");
        return;
      }
    }
  });
}
