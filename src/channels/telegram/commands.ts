import * as fs from "fs";
import * as path from "path";
import type { Bot, Context } from "grammy";
import { config } from "../../config.js";
import { clearHistory } from "../../conversation.js";
import { readMemoryFile } from "../../memory/github.js";
import { invalidatePromptCache } from "../../providers/shared.js";
import { providerDisplayName } from "../../providers/model-routing.js";
import { getWorkspaceRoot, setWorkspaceRoot, isProjectActive } from "../../tools/files.js";
import { datestamp, redactArchiveEntries, uploadArchives } from "../../conversation-archive.js";
import { chatService } from "../../agent/chat-service.js";
import { dreamStatus, forceDream } from "../../domain/memory/dream-service.js";

export const TELEGRAM_COMMAND_MENU = [
  { command: "start", description: "Greeting" },
  { command: "clear", description: "Reset conversation + provider session" },
  { command: "purge", description: "Full clear — conversation + today's archive" },
  { command: "stop", description: "Abort current provider query" },
  { command: "session", description: "Show provider session info" },
  { command: "model", description: "Show current AI model" },
  { command: "memory", description: "Show memory file status" },
  { command: "project", description: "Show or set active project directory" },
  { command: "reload", description: "Reload memory from GitHub" },
  { command: "restart", description: "Graceful bot restart" },
  { command: "dream", description: "Run or check memory consolidation" },
  { command: "help", description: "List available commands" },
] as const;

export function registerTelegramCommands(bot: Bot<Context>): void {
  bot.command("start", async (ctx) => {
    await ctx.reply("Hey Chris. I'm here whenever you need me.");
  });

  bot.command("clear", async (ctx) => {
    await clearHistory(ctx.chat.id);
    chatService.clearSession(ctx.chat.id);
    await ctx.reply("Conversation cleared. Memory is still intact.");
  });

  bot.command("purge", async (ctx) => {
    const chatId = ctx.chat.id;

    await clearHistory(chatId);
    chatService.clearSession(chatId);

    const today = datestamp();
    const removed = redactArchiveEntries(chatId, today);

    if (removed > 0) {
      uploadArchives().catch((err: any) => {
        console.error("[telegram] Failed to upload redacted archive:", err.message);
      });
    }

    await ctx.reply(
      removed > 0
        ? `Conversation purged. ${removed} archive entries removed from today's log.`
        : "Conversation cleared. No archive entries found for today.",
    );
  });

  bot.command("model", async (ctx) => {
    const model = config.model;
    const provider = providerDisplayName(model);
    await ctx.reply(`Model: ${model}\nProvider: ${provider}\nWorkspace: ${getWorkspaceRoot()}\n\nUse the CLI to switch: chris model set <name>`);
  });

  bot.command("memory", async (ctx) => {
    const files = [
      "identity/SOUL.md", "identity/RULES.md", "identity/VOICE.md",
      "knowledge/about-chris.md", "knowledge/preferences.md",
      "knowledge/projects.md", "knowledge/people.md",
      "memory/decisions.md", "memory/learnings.md",
    ];

    const results = await Promise.all(
      files.map(async (path) => {
        const content = await readMemoryFile(path).catch(() => null);
        if (!content) return `  ○ ${path} (empty)`;
        const bytes = Buffer.byteLength(content, "utf-8");
        const size = bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;
        return `  ● ${path} (${size})`;
      }),
    );

    await ctx.reply(`Memory files:\n\n${results.join("\n")}`);
  });

  bot.command("reload", async (ctx) => {
    invalidatePromptCache();
    await ctx.reply("System prompt cache cleared. Next message will reload memory from GitHub.");
  });

  bot.command("stop", async (ctx) => {
    const aborted = chatService.abort(ctx.chat.id);
    await ctx.reply(aborted ? "Stopping current query..." : "Nothing running to stop.");
  });

  bot.command("session", async (ctx) => {
    const info = chatService.getSessionInfo(ctx.chat.id);

    if (info === null) {
      await ctx.reply("No active session for the current provider.");
      return;
    }

    await ctx.reply(`${info}\nUse /clear to reset.`);
  });

  bot.command("restart", async (ctx) => {
    await ctx.reply("Restarting... back in a few seconds.");
    setTimeout(() => process.exit(0), 1500);
  });

  bot.command("dream", async (ctx) => {
    const arg = ctx.match?.trim();

    if (arg === "run") {
      await ctx.reply("Starting dream consolidation...");
      const result = await forceDream();
      if (result.success) {
        const changes = result.changes.map((c) => "- " + c).join("\n");
        await ctx.reply("Dream complete.\n\nChanges:\n" + changes);
      } else {
        await ctx.reply("Dream failed: " + result.changes.join(", "));
      }
      return;
    }

    const status = dreamStatus();
    const lastStr = status.lastConsolidated === "never" ? "never" : new Date(status.lastConsolidated).toLocaleString();
    await ctx.reply(
      "Dream status:\n\n" +
      "Last consolidated: " + lastStr + "\n" +
      "Hours since: " + (status.hoursSince === Infinity ? "never" : String(status.hoursSince)) + "\n" +
      "Sessions since: " + status.sessionsSince + "\n" +
      "Failures: " + status.consecutiveFailures + "\n" +
      "Running: " + (status.isRunning ? "yes" : "no") + "\n\n" +
      "Use /dream run to force a consolidation now."
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Available commands:\n\n" +
      "/start — Greeting\n" +
      "/clear — Reset conversation + provider session\n" +
      "/purge — Full clear — conversation + today's archive\n" +
      "/stop — Abort current query\n" +
      "/session — Show provider session info\n" +
      "/model — Show current AI model\n" +
      "/memory — Show memory file status\n" +
      "/project — Show active workspace\n" +
      "/project <path> — Set active workspace\n" +
      "/reload — Reload memory from GitHub\n" +
      "/restart — Graceful bot restart\n" +
      "/dream — Memory consolidation status\n" +
      "/dream run — Force consolidation now\n" +
      "/help — This message",
    );
  });

  bot.command("project", async (ctx) => {
    const arg = ctx.match?.trim();

    if (!arg) {
      await ctx.reply(`Active workspace: ${getWorkspaceRoot()}\nCoding tools: ${isProjectActive() ? "enabled" : "disabled (set a specific project to enable)"}`);
      return;
    }

    const resolved = path.resolve(arg);

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        await ctx.reply(`Not a directory: ${resolved}`);
        return;
      }
    } catch {
      await ctx.reply(`Directory not found: ${resolved}`);
      return;
    }

    setWorkspaceRoot(resolved);
    await ctx.reply(`Workspace set to: ${resolved}\nCoding tools: enabled`);
  });
}
