import { bot } from "./telegram.js";
import { startHealthMonitor, stopHealthMonitor } from "./health.js";

console.log("[chris-assistant] Starting up...");

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
