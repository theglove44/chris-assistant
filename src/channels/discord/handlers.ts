import { ChannelType, Message, TextChannel } from "discord.js";
import { config } from "../../config.js";
import { addMessage } from "../../conversation.js";
import { stripMarkdown } from "../../markdown.js";
import type { ImageAttachment } from "../../providers/types.js";
import { chatService } from "../../agent/chat-service.js";
import { discordClient } from "./client.js";
import { setupDiscordChannels } from "./channels.js";
import { splitDiscordMessage, toDiscordMarkdown } from "./formatting.js";

async function handleSetupCommand(message: Message): Promise<boolean> {
  if (message.content.trim() !== "!setup") return false;

  if (!config.discord.guildId) {
    await message.reply("⚠️ No DISCORD_GUILD_ID configured.").catch(() => {});
    return true;
  }

  try {
    const guild = await discordClient.guilds.fetch(config.discord.guildId);
    const result = await setupDiscordChannels(guild);
    if (result.created.length === 0) {
      await message.reply(`✅ All channels already exist (${result.existing} checked). Nothing to create.`).catch(() => {});
    } else {
      const list = result.created.map((c) => `• ${c}`).join("\n");
      await message.reply(`✅ Setup complete — created ${result.created.length} new item(s):\n${list}`).catch(() => {});
    }
  } catch (err: any) {
    await message.reply(`❌ Setup failed: ${err.message}`).catch(() => {});
  }

  return true;
}

async function collectAttachments(message: Message): Promise<{ userMessage: string; imageAttachments: ImageAttachment[] }> {
  let userMessage = message.content.trim();
  const imageAttachments: ImageAttachment[] = [];

  if (message.attachments.size > 0) {
    const textExtensions = [".txt", ".md", ".json", ".csv", ".xml", ".js", ".ts", ".py", ".html", ".css", ".yaml", ".yml", ".toml", ".log", ".sh"];

    for (const attachment of message.attachments.values()) {
      const name = (attachment.name ?? "").toLowerCase();
      const contentType = (attachment.contentType ?? "").split(";")[0].trim().toLowerCase();
      const isText = textExtensions.some((ext) => name.endsWith(ext)) || contentType.startsWith("text/");
      const isImage = contentType.startsWith("image/");

      if (isImage) {
        try {
          const res = await fetch(attachment.url);
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            imageAttachments.push({
              base64: buffer.toString("base64"),
              mimeType: contentType || "image/jpeg",
            });
          }
        } catch (err: any) {
          console.error("[discord] Failed to download image attachment:", err.message);
        }
      } else if (isText) {
        try {
          const res = await fetch(attachment.url);
          if (res.ok) {
            const MAX_BYTES = 50_000;
            const text = await res.text();
            const content = text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) + "\n\n[... truncated ...]" : text;
            userMessage = userMessage
              ? `[File: ${attachment.name}]\n\n${content}\n\n---\n\n${userMessage}`
              : `[File: ${attachment.name}]\n\n${content}`;
          }
        } catch (err: any) {
          console.error("[discord] Failed to download attachment:", err.message);
        }
      }
    }
  }

  if (!userMessage && imageAttachments.length > 0) {
    userMessage = imageAttachments.length === 1 ? "What's in this image?" : "What's in these images?";
  }

  return { userMessage, imageAttachments };
}

export function registerDiscordHandlers(): void {
  discordClient.once("ready", async () => {
    console.log("[discord] Bot is live as %s", discordClient.user?.tag);

    if (config.discord.guildId) {
      try {
        const guild = await discordClient.guilds.fetch(config.discord.guildId);
        const result = await setupDiscordChannels(guild);
        console.log("[discord] Channels ready — %d created, %d existing", result.created.length, result.existing);
      } catch (err: any) {
        console.error("[discord] Failed to setup channels:", err.message);
      }
    }
  });

  discordClient.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (message.author.id !== process.env.DISCORD_ALLOWED_USER_ID) return;
    if (await handleSetupCommand(message)) return;

    const { userMessage, imageAttachments } = await collectAttachments(message);
    if (!userMessage) return;

    if ("sendTyping" in message.channel) {
      await (message.channel as TextChannel).sendTyping().catch(() => {});
    }

    try {
      const chatId = parseInt(message.channelId.slice(-9), 10);
      const channelName = message.channel.type === ChannelType.DM ? "dm" : (message.channel as TextChannel).name ?? "unknown";
      const meta = { source: "discord" as const, channelName };

      void addMessage(chatId, "user", userMessage, meta);

      const rawResponse = await chatService.sendMessage({
        chatId,
        userMessage,
        images: imageAttachments.length > 0 ? imageAttachments : undefined,
      });

      const thinkClose = "<" + "/think>";
      const thinkingClose = "<" + "/thinking>";
      const response = rawResponse
        .replace(new RegExp("<think>[\\s\\S]*?" + thinkClose, "g"), "")
        .replace(new RegExp("<thinking>[\\s\\S]*?" + thinkingClose, "g"), "")
        .trim();

      void addMessage(chatId, "assistant", response, meta);

      const formatted = toDiscordMarkdown(response);
      const chunks = formatted.length <= 2000 ? [formatted] : splitDiscordMessage(formatted, 2000);

      for (const chunk of chunks) {
        await message.reply(chunk).catch(async () => {
          await message.reply(stripMarkdown(chunk)).catch(() => {});
        });
      }
    } catch (error: any) {
      console.error("[discord] Error handling message:", error);
      await message.reply("Something went wrong. Check the logs.").catch(() => {});
    }
  });
}
