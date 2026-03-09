import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CategoryChannel, ChannelType, Guild, TextChannel } from "discord.js";

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

export async function setupDiscordChannels(guild: Guild): Promise<{ created: string[]; existing: number }> {
  const config = loadChannelConfig();
  const created: string[] = [];
  let existing = 0;

  await guild.channels.fetch();

  for (const group of config) {
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === group.category,
    ) as CategoryChannel | undefined;

    if (!category) {
      category = await guild.channels.create({
        name: group.category,
        type: ChannelType.GuildCategory,
      });
      console.log("[discord] Created category: %s", group.category);
      created.push(`📁 **${group.category}** (category)`);
    }

    for (const ch of group.channels) {
      const exists = guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildText &&
          c.name === ch.name &&
          (c as TextChannel).parentId === category!.id,
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
