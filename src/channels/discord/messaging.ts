import { ChannelType, TextChannel } from "discord.js";
import { config } from "../../config.js";
import { discordClient } from "./client.js";
import { splitDiscordMessage } from "./formatting.js";

export async function sendToDiscordChannel(channelName: string, content: string): Promise<void> {
  if (!config.discord.botToken) {
    console.warn("[discord] sendToDiscordChannel: DISCORD_BOT_TOKEN not configured");
    return;
  }

  if (!config.discord.guildId) {
    console.warn("[discord] sendToDiscordChannel: no DISCORD_GUILD_ID configured");
    return;
  }

  try {
    const guild = await discordClient.guilds.fetch(config.discord.guildId);
    await guild.channels.fetch();

    const channel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === channelName,
    ) as TextChannel | undefined;

    if (!channel) {
      console.error("[discord] sendToDiscordChannel: channel #%s not found", channelName);
      return;
    }

    const chunks = content.length <= 2000 ? [content] : splitDiscordMessage(content, 2000);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  } catch (err: any) {
    console.error("[discord] sendToDiscordChannel failed:", err.message);
  }
}
