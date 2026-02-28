import { Client, GatewayIntentBits, Message, TextChannel, Partials } from "discord.js";
import { config } from "./config.js";
import { chat } from "./providers/index.js";
import { addMessage } from "./conversation.js";
import { stripMarkdown } from "./markdown.js";

if (!config.discord.botToken) {
  throw new Error("DISCORD_BOT_TOKEN is not set");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

/**
 * Split a message into chunks at paragraph boundaries.
 */
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

/**
 * Convert basic Markdown to Discord's markdown format.
 * Discord supports **bold**, *italic*, `code`, ```blocks```, and links natively.
 * Headers (#) don't render so we convert them to bold.
 */
function toDiscordMarkdown(text: string): string {
  // Convert headers to bold
  return text.replace(/^#{1,6} (.+)$/gm, "**$1**");
}

client.once("ready", () => {
  console.log("[discord] Bot is live as %s", client.user?.tag);
});

client.on("messageCreate", async (message: Message) => {
  // Ignore bots and self
  if (message.author.bot) return;

  // Only respond to the authorised user
  if (message.author.id !== process.env.DISCORD_ALLOWED_USER_ID) return;

  const userMessage = message.content.trim();
  if (!userMessage) return;

  // Show typing indicator
  if ("sendTyping" in message.channel) {
    await (message.channel as TextChannel).sendTyping().catch(() => {});
  }

  try {
    // Use last 9 digits of channelId as numeric chatId for conversation tracking
    const chatId = parseInt(message.channelId.slice(-9), 10);

    void addMessage(chatId, "user", userMessage);

    const rawResponse = await chat(chatId, userMessage);

    // Strip <think> tags
    const thinkClose = "<" + "/think>";
    const response = rawResponse
      .replace(new RegExp("<think>[\\s\\S]*?" + thinkClose, "g"), "")
      .trim();

    void addMessage(chatId, "assistant", response);

    // Discord max message length is 2000 chars
    const formatted = toDiscordMarkdown(response);
    const chunks = formatted.length <= 2000 ? [formatted] : splitMessage(formatted, 2000);

    for (const chunk of chunks) {
      await message.reply(chunk).catch(async () => {
        // Fallback: strip all markdown if formatting fails
        await message.reply(stripMarkdown(chunk)).catch(() => {});
      });
    }
  } catch (error: any) {
    console.error("[discord] Error handling message:", error);
    await message.reply("Something went wrong. Check the logs.").catch(() => {});
  }
});

export function startDiscord(): void {
  if (!config.discord.botToken) return;
  client.login(config.discord.botToken).catch((err: any) => {
    console.error("[discord] Failed to login:", err.message);
  });
}

export function stopDiscord(): void {
  client.destroy();
}
