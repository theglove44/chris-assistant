import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  Partials,
  ChannelType,
  Guild,
  CategoryChannel,
  PermissionsBitField,
} from "discord.js";
import { config } from "./config.js";
import { chat } from "./providers/index.js";
import { addMessage } from "./conversation.js";
import { stripMarkdown } from "./markdown.js";
import type { ImageAttachment } from "./providers/types.js";

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
 * Channel config lives in ~/.chris-assistant/discord-channels.json.
 * This file is read fresh on every setupChannels() call, so changes take
 * effect immediately via !setup — no restart required.
 */
const CHANNELS_CONFIG_FILE = path.join(os.homedir(), ".chris-assistant", "discord-channels.json");

interface ChannelDef {
  name: string;
  topic: string;
}

interface CategoryDef {
  category: string;
  channels: ChannelDef[];
}

function loadChannelConfig(): CategoryDef[] {
  try {
    const raw = fs.readFileSync(CHANNELS_CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as CategoryDef[];
  } catch {
    console.warn("[discord] Could not load %s — using empty channel config", CHANNELS_CONFIG_FILE);
    return [];
  }
}

/**
 * Ensure all configured categories and their channels exist in the guild.
 * Reads fresh from discord-channels.json each time — safe to call without restart.
 */
async function setupChannels(guild: Guild): Promise<{ created: string[]; existing: number }> {
  const config = loadChannelConfig();
  const created: string[] = [];
  let existing = 0;

  // Refresh channel cache before checking
  await guild.channels.fetch();

  for (const group of config) {
    // Find or create the category
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === group.category
    ) as CategoryChannel | undefined;

    if (!category) {
      category = await guild.channels.create({
        name: group.category,
        type: ChannelType.GuildCategory,
      });
      console.log("[discord] Created category: %s", group.category);
      created.push(`📁 **${group.category}** (category)`);
    }

    // Create any missing channels under this category
    for (const ch of group.channels) {
      const exists = guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildText &&
          c.name === ch.name &&
          (c as TextChannel).parentId === category!.id
      );

      if (!exists) {
        await guild.channels.create({
          name: ch.name,
          type: ChannelType.GuildText,
          topic: ch.topic,
          parent: category.id,
        });
        console.log("[discord] Created channel: #%s", ch.name);
        created.push(`#${ch.name} (under ${group.category})`);
      } else {
        existing++;
      }
    }
  }

  return { created, existing };
}

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

client.once("ready", async () => {
  console.log("[discord] Bot is live as %s", client.user?.tag);

  if (config.discord.guildId) {
    try {
      const guild = await client.guilds.fetch(config.discord.guildId);
      const result = await setupChannels(guild);
      console.log("[discord] Channels ready — %d created, %d existing", result.created.length, result.existing);
    } catch (err: any) {
      console.error("[discord] Failed to setup channels:", err.message);
    }
  }
});

client.on("messageCreate", async (message: Message) => {
  // Ignore bots and self
  if (message.author.bot) return;

  // Only respond to the authorised user
  if (message.author.id !== process.env.DISCORD_ALLOWED_USER_ID) return;

  // !setup — re-read discord-channels.json and create any missing channels/categories
  if (message.content.trim() === "!setup") {
    if (!config.discord.guildId) {
      await message.reply("⚠️ No DISCORD_GUILD_ID configured.").catch(() => {});
      return;
    }
    try {
      const guild = await client.guilds.fetch(config.discord.guildId);
      const result = await setupChannels(guild);
      if (result.created.length === 0) {
        await message.reply(`✅ All channels already exist (${result.existing} checked). Nothing to create.`).catch(() => {});
      } else {
        const list = result.created.map((c) => `• ${c}`).join("\n");
        await message.reply(`✅ Setup complete — created ${result.created.length} new item(s):\n${list}`).catch(() => {});
      }
    } catch (err: any) {
      await message.reply(`❌ Setup failed: ${err.message}`).catch(() => {});
    }
    return;
  }

  let userMessage = message.content.trim();
  const imageAttachments: ImageAttachment[] = [];

  // Handle file and image attachments
  if (message.attachments.size > 0) {
    const textExtensions = [".txt", ".md", ".json", ".csv", ".xml", ".js", ".ts", ".py", ".html", ".css", ".yaml", ".yml", ".toml", ".log", ".sh"];

    for (const attachment of message.attachments.values()) {
      const name = (attachment.name ?? "").toLowerCase();
      const contentType = (attachment.contentType ?? "").split(";")[0].trim().toLowerCase();

      const isText = textExtensions.some((ext) => name.endsWith(ext)) || contentType.startsWith("text/");
      const isImage = contentType.startsWith("image/");

      if (isImage) {
        // Download each image as base64 and collect for the AI
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

  // Default prompt if only images were sent with no text
  if (!userMessage && imageAttachments.length > 0) {
    userMessage = imageAttachments.length === 1 ? "What's in this image?" : "What's in these images?";
  }

  if (!userMessage) return;

  // Show typing indicator
  if ("sendTyping" in message.channel) {
    await (message.channel as TextChannel).sendTyping().catch(() => {});
  }

  try {
    // Use last 9 digits of channelId as numeric chatId for conversation tracking
    const chatId = parseInt(message.channelId.slice(-9), 10);

    const channelName = message.channel.type === ChannelType.DM
      ? "dm"
      : (message.channel as TextChannel).name ?? "unknown";
    const meta = { source: "discord" as const, channelName };

    void addMessage(chatId, "user", userMessage, meta);

    const rawResponse = await chat(chatId, userMessage, undefined, imageAttachments.length > 0 ? imageAttachments : undefined);

    // Strip <think> tags
    const thinkClose = "<" + "/think>";
    const response = rawResponse
      .replace(new RegExp("<think>[\\s\\S]*?" + thinkClose, "g"), "")
      .trim();

    void addMessage(chatId, "assistant", response, meta);

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

/**
 * Post a message to a specific Discord channel by name within the configured guild.
 * Used by the scheduler to send reports to project-specific channels.
 */
export async function sendToDiscordChannel(channelName: string, content: string): Promise<void> {
  if (!config.discord.guildId) {
    console.warn("[discord] sendToDiscordChannel: no DISCORD_GUILD_ID configured");
    return;
  }

  try {
    const guild = await client.guilds.fetch(config.discord.guildId);
    await guild.channels.fetch(); // populate cache

    const channel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === channelName
    ) as TextChannel | undefined;

    if (!channel) {
      console.error("[discord] sendToDiscordChannel: channel #%s not found", channelName);
      return;
    }

    // Discord max message length is 2000 chars — split if needed
    const chunks = content.length <= 2000 ? [content] : splitMessage(content, 2000);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  } catch (err: any) {
    console.error("[discord] sendToDiscordChannel failed:", err.message);
  }
}
