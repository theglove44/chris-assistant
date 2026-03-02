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
 * Project channels to create under the "Projects" category.
 */
const PROJECT_CHANNELS: { name: string; topic: string }[] = [
  {
    name: "chris-assistant",
    topic: "Jarvis — personal AI assistant via Telegram & Discord. Active dev.",
  },
  {
    name: "tasty-coach",
    topic: "Tastytrade automation: IVR scanning, position review, roll analysis, GEX tracking.",
  },
  {
    name: "tasty0dte-ironcondor",
    topic: "Automated 0DTE SPX Iron Condor/Iron Fly trading bot. Paper trading mode.",
  },
  {
    name: "stock-research",
    topic: "Daily AI infrastructure stock research. Chips, energy, data centres — companies with strong moats benefiting from the AI buildout.",
  },
  {
    name: "belfast-trip",
    topic: "City break to Belfast — plans, itineraries, recommendations, and logistics.",
  },
  {
    name: "valencia-holiday",
    topic: "Holiday to Valencia — plans, itineraries, recommendations, and logistics.",
  },
];

/**
 * Ensure the "Projects" category and all project channels exist in the guild.
 */
async function setupProjectChannels(guild: Guild): Promise<void> {
  const CATEGORY_NAME = "Projects";

  // Find or create the Projects category
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
  ) as CategoryChannel | undefined;

  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
    });
    console.log("[discord] Created category: %s", CATEGORY_NAME);
  }

  // Create any missing project channels under the category
  for (const proj of PROJECT_CHANNELS) {
    const exists = guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildText &&
        c.name === proj.name &&
        (c as TextChannel).parentId === category!.id
    );

    if (!exists) {
      await guild.channels.create({
        name: proj.name,
        type: ChannelType.GuildText,
        topic: proj.topic,
        parent: category.id,
      });
      console.log("[discord] Created channel: #%s", proj.name);
    }
  }
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
      await setupProjectChannels(guild);
      console.log("[discord] Project channels ready");
    } catch (err: any) {
      console.error("[discord] Failed to setup project channels:", err.message);
    }
  }
});

client.on("messageCreate", async (message: Message) => {
  // Ignore bots and self
  if (message.author.bot) return;

  // Only respond to the authorised user
  if (message.author.id !== process.env.DISCORD_ALLOWED_USER_ID) return;

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
