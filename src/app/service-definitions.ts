import { createService, ServiceRegistry } from "./services.js";
import { startDiscord, stopDiscord } from "../discord.js";
import { startHealthMonitor, stopHealthMonitor } from "../health.js";
import { startScheduler, stopScheduler } from "../scheduler.js";
import { startConversationBackup, stopConversationBackup } from "../conversation-backup.js";
import { startArchiveUploader, stopArchiveUploader, uploadArchives } from "../conversation-archive.js";
import { startDailySummarizer, stopDailySummarizer } from "../conversation-summary.js";
import { startChannelSummarizer, stopChannelSummarizer } from "../conversation-channel-summary.js";
import { startJournalUploader, stopJournalUploader } from "../memory/journal.js";
import { startMemoryConsolidation, stopMemoryConsolidation } from "../memory-consolidation.js";
import { startHeartbeat, stopHeartbeat } from "../heartbeat.js";
import { startDashboard, stopDashboard } from "../dashboard.js";
import { startWebhook, stopWebhook } from "../webhook.js";
import { startUsageReport, stopUsageReport } from "../domain/usage/daily-report-service.js";
import { ensureLocalMemoryDir } from "../domain/memory/recall.js";
import { setTelegramCommandMenu } from "../channels/telegram/index.js";

export function createPreTelegramRegistry(): ServiceRegistry {
  return new ServiceRegistry([
    createService(
      "telegram-command-menu",
      async () => {
        await setTelegramCommandMenu();
      },
      () => {},
    ),
  ]);
}

export function createPostTelegramRegistry(): ServiceRegistry {
  return new ServiceRegistry([
    createService("local-memory-dir", () => ensureLocalMemoryDir(), () => {}),
    createService("health-monitor", () => startHealthMonitor(), () => stopHealthMonitor()),
    createService("scheduler", () => startScheduler(), () => stopScheduler()),
    createService("conversation-backup", () => startConversationBackup(), () => stopConversationBackup()),
    createService("archive-uploader", () => startArchiveUploader(), async () => {
      await uploadArchives();
      stopArchiveUploader();
    }),
    createService("daily-summarizer", () => startDailySummarizer(), () => stopDailySummarizer()),
    createService("channel-summarizer", () => startChannelSummarizer(), () => stopChannelSummarizer()),
    createService("journal-uploader", () => startJournalUploader(), () => stopJournalUploader()),
    createService("memory-consolidation", () => startMemoryConsolidation(), () => stopMemoryConsolidation()),
    createService("heartbeat", () => startHeartbeat(), () => stopHeartbeat()),
    createService("dashboard", () => startDashboard(), () => stopDashboard()),
    createService("discord", () => startDiscord(), () => stopDiscord()),
    createService("webhook", () => startWebhook(), () => stopWebhook()),
    createService("usage-report", () => startUsageReport(), () => stopUsageReport()),
  ]);
}
