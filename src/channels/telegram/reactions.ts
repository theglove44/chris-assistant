import type { Bot, Context } from "grammy";
import { recordReaction } from "../../domain/feedback/reaction-service.js";

function formatReaction(reaction: { type: string; emoji?: string; custom_emoji_id?: string }): string {
  if (reaction.type === "emoji") return reaction.emoji ?? "emoji";
  if (reaction.type === "custom_emoji") return `custom:${reaction.custom_emoji_id ?? "unknown"}`;
  return reaction.type;
}

export function registerTelegramReactionHandlers(bot: Bot<Context>): void {
  bot.on("message_reaction", async (ctx) => {
    const reaction = ctx.messageReaction;
    if (!reaction) return;

    const event = recordReaction(
      {
        ts: reaction.date * 1000,
        previousReactions: reaction.old_reaction.map(formatReaction),
        reactions: reaction.new_reaction.map(formatReaction),
      },
      reaction.chat.id,
      reaction.message_id,
    );

    if (event) {
      console.log("[feedback] Recorded reaction on message %d", reaction.message_id);
    }
  });
}
