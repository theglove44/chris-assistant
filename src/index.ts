import { bot } from "./telegram.js";

console.log("[chris-assistant] Starting up...");

bot.start({
  onStart: (botInfo) => {
    console.log("[chris-assistant] Bot is live as @%s", botInfo.username);
    console.log("[chris-assistant] Waiting for messages...");
  },
});

// Graceful shutdown
const shutdown = () => {
  console.log("[chris-assistant] Shutting down...");
  bot.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
