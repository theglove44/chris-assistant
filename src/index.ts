import { bot } from "./telegram.js";
import { startDiscord, stopDiscord } from "./discord.js";
import { startHealthMonitor, stopHealthMonitor } from "./health.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { startConversationBackup, stopConversationBackup } from "./conversation-backup.js";
import { startArchiveUploader, stopArchiveUploader, uploadArchives } from "./conversation-archive.js";
import { startDailySummarizer, stopDailySummarizer } from "./conversation-summary.js";
import { startChannelSummarizer, stopChannelSummarizer } from "./conversation-channel-summary.js";
import { startJournalUploader, stopJournalUploader } from "./memory/journal.js";
import { startMemoryConsolidation, stopMemoryConsolidation } from "./memory-consolidation.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";
import { startDashboard, stopDashboard } from "./dashboard.js";
import { startWebhook, stopWebhook } from "./webhook.js";

console.log("[chris-assistant] Starting up...");

// Register the Telegram command menu so users see commands in the bot UI
bot.api.setMyCommands([
  { command: "start", description: "Greeting" },
  { command: "clear", description: "Reset conversation + Claude session" },
  { command: "purge", description: "Full clear — conversation + today's archive" },
  { command: "stop", description: "Abort current Claude query" },
  { command: "session", description: "Show Claude session info" },
  { command: "model", description: "Show current AI model" },
  { command: "memory", description: "Show memory file status" },
  { command: "project", description: "Show or set active project directory" },
  { command: "reload", description: "Reload memory from GitHub" },
  { command: "restart", description: "Graceful bot restart" },
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
    startScheduler();
    startConversationBackup();
    startArchiveUploader();
    startDailySummarizer();
    startChannelSummarizer();
    startJournalUploader();
    startMemoryConsolidation();
    startHeartbeat();
    startDashboard();
    startDiscord();
    // Webhook starts after Discord so notifications aren't dropped during login
    startWebhook();
  },
});

// Graceful shutdown
const shutdown = async () => {
  console.log("[chris-assistant] Shutting down...");
  stopHealthMonitor();
  stopScheduler();
  stopConversationBackup();
  await uploadArchives();
  stopArchiveUploader();
  stopChannelSummarizer();
  stopDailySummarizer();
  stopJournalUploader();
  stopMemoryConsolidation();
  stopHeartbeat();
  stopDashboard();
  stopWebhook();
  bot.stop();
  stopDiscord();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
