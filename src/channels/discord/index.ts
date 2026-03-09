import { config } from "../../config.js";
import { discordClient } from "./client.js";
import { registerDiscordHandlers } from "./handlers.js";
export { sendToDiscordChannel } from "./messaging.js";

registerDiscordHandlers();

export function startDiscord(): void {
  if (!config.discord.botToken) return;
  discordClient.login(config.discord.botToken).catch((err: any) => {
    console.error("[discord] Failed to login:", err.message);
  });
}

export function stopDiscord(): void {
  discordClient.destroy();
}
