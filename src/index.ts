import { bot } from "./telegram.js";
import { startHealthMonitor, stopHealthMonitor } from "./health.js";

console.log("[chris-assistant] Starting up...");

// Register the Telegram command menu so users see commands in the bot UI
bot.api.setMyCommands([
  { command: "start", description: "Greeting" },
  { command: "clear", description: "Reset conversation history" },
  { command: "model", description: "Show current AI model" },
  { command: "memory", description: "Show memory file status" },
  { command: "project", description: "Show or set active project directory" },
  { command: "help", description: "List available commands" },
]).catch((err: any) => {
  console.error("[telegram] Failed to set command menu:", err.message);
});

bot.start({
  onStart: (botInfo) => {
    console.log("[chris-assistant] Bot is live as @%s", botInfo.username);
    console.log("[chris-assistant] Waiting for messages...");
    startHealthMonitor().catch((err: any) => {
      console.error("[health] Failed to start health monitor:", err.message);
    });
  },
});

// Graceful shutdown
const shutdown = () => {
  console.log("[chris-assistant] Shutting down...");
  stopHealthMonitor();
  bot.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
