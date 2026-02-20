import * as fs from "fs";
import * as path from "path";
import { Bot, Context } from "grammy";
import { config } from "./config.js";
import { chat } from "./providers/index.js";
import type { ImageAttachment } from "./providers/index.js";
import { addMessage, clearHistory } from "./conversation.js";
import { checkRateLimit } from "./rate-limit.js";
import { toMarkdownV2 } from "./markdown.js";
import { readMemoryFile } from "./memory/github.js";
import { getWorkspaceRoot, setWorkspaceRoot, isProjectActive } from "./tools/files.js";
import { invalidatePromptCache } from "./providers/shared.js";

const bot = new Bot(config.telegram.botToken);

/**
 * Guard: only respond to the allowed user.
 */
function isAllowedUser(ctx: Context): boolean {
  return ctx.from?.id === config.telegram.allowedUserId;
}

/**
 * Download a file from Telegram's servers and return its raw bytes.
 */
async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Call chat() with one automatic retry on failure.
 *
 * If the first attempt throws, we wait RETRY_DELAY_MS and try once more with
 * the same arguments. Both the original error and any retry error are logged
 * so they appear in pm2 logs. Throws the final error if both attempts fail.
 */
const RETRY_DELAY_MS = 2000;

async function chatWithRetry(
  chatId: number,
  userMessage: string,
  onChunk: (accumulated: string) => void,
  image?: ImageAttachment,
): Promise<string> {
  try {
    return await chat(chatId, userMessage, onChunk, image);
  } catch (firstError: any) {
    console.warn(
      "[telegram] chat() failed, retrying in %dms. Error: %s",
      RETRY_DELAY_MS,
      firstError?.message ?? firstError,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    console.log("[telegram] Retrying chat() now...");
    return await chat(chatId, userMessage, onChunk, image);
  }
}

/**
 * Core response handler shared by text, photo, and document message handlers.
 * Sends a placeholder message, streams updates into it, then renders the final
 * MarkdownV2 response (with plain-text fallback) — splitting if needed.
 */
async function handleAiResponse(
  ctx: Context,
  userMessage: string,
  image?: ImageAttachment,
): Promise<void> {
  const sentMsg = await ctx.reply("...");
  const chatId = ctx.chat!.id;
  const messageId = sentMsg.message_id;

  // Streaming state
  let lastEditTime = 0;
  let lastEditedText = "...";
  const EDIT_INTERVAL_MS = 1500; // Stay well within Telegram's rate limit

  const onChunk = (accumulated: string) => {
    const now = Date.now();
    if (now - lastEditTime < EDIT_INTERVAL_MS) return;

    // Strip think tags — both complete and in-progress (no closing tag yet)
    const cleaned = accumulated
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/<think>[\s\S]*$/g, "")
      .trim();
    if (!cleaned || cleaned === lastEditedText) return;

    // Truncate for Telegram limit, add cursor
    const preview = cleaned.length > 4000 ? cleaned.slice(0, 4000) + "..." : cleaned;
    const withCursor = preview + " ▍";

    lastEditTime = now;
    lastEditedText = cleaned;

    // Fire and forget — don't await, don't let errors interrupt streaming
    ctx.api.editMessageText(chatId, messageId, withCursor).catch(() => {});
  };

  try {
    addMessage(chatId, "user", userMessage);

    const rawResponse = await chatWithRetry(chatId, userMessage, onChunk, image);

    // Strip <think>...</think> blocks (reasoning models emit these)
    const response = rawResponse.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    addMessage(chatId, "assistant", response);

    // Final render — replace the streaming message with the complete response.
    // Split on the original text (before MarkdownV2 conversion) so escape
    // characters don't inflate chunk sizes, then convert each chunk separately.
    const chunks = response.length <= 4096 ? [response] : splitMessage(response, 4096);

    // First chunk: edit the placeholder message that was sent at the start
    const firstChunk = chunks[0];
    await ctx.api
      .editMessageText(chatId, messageId, toMarkdownV2(firstChunk), {
        parse_mode: "MarkdownV2",
      })
      .catch(() =>
        ctx.api.editMessageText(chatId, messageId, firstChunk).catch(() => {}),
      );

    // Remaining chunks: send as new messages
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      await ctx.reply(toMarkdownV2(chunk), { parse_mode: "MarkdownV2" }).catch(
        () => ctx.reply(chunk),
      );
    }
  } catch (error: any) {
    console.error("[telegram] Both chat() attempts failed:", error);
    // Edit the placeholder to show error instead of leaving "..." hanging
    await ctx.api
      .editMessageText(chatId, messageId, "Something went wrong. Check the logs.")
      .catch(() => {});
  }
}

// /start command
bot.command("start", async (ctx) => {
  if (!isAllowedUser(ctx)) {
    await ctx.reply("Sorry, this bot is private.");
    return;
  }
  await ctx.reply("Hey Chris. I'm here whenever you need me.");
});

// /clear — reset conversation history
bot.command("clear", async (ctx) => {
  if (!isAllowedUser(ctx)) return;
  clearHistory(ctx.chat.id);
  await ctx.reply("Conversation cleared. Memory is still intact.");
});

// /model — show current model and provider
bot.command("model", async (ctx) => {
  if (!isAllowedUser(ctx)) return;
  const model = config.model;
  const m = model.toLowerCase();
  const provider = m.startsWith("gpt-") || m.startsWith("o3") || m.startsWith("o4-")
    ? "OpenAI"
    : model.startsWith("MiniMax")
      ? "MiniMax"
      : "Claude";
  await ctx.reply(`Model: ${model}\nProvider: ${provider}\nWorkspace: ${getWorkspaceRoot()}\n\nUse the CLI to switch: chris model set <name>`);
});

// /memory — show memory file status
bot.command("memory", async (ctx) => {
  if (!isAllowedUser(ctx)) return;

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

// /help — list available commands
// /reload — invalidate system prompt cache
bot.command("reload", async (ctx) => {
  if (!isAllowedUser(ctx)) return;
  invalidatePromptCache();
  await ctx.reply("System prompt cache cleared. Next message will reload memory from GitHub.");
});

bot.command("help", async (ctx) => {
  if (!isAllowedUser(ctx)) return;
  await ctx.reply(
    "Available commands:\n\n" +
    "/start — Greeting\n" +
    "/clear — Reset conversation history\n" +
    "/model — Show current AI model\n" +
    "/memory — Show memory file status\n" +
    "/project — Show active workspace\n" +
    "/project <path> — Set active workspace\n" +
    "/reload — Reload memory from GitHub\n" +
    "/help — This message",
  );
});

// /project — show or set active workspace
bot.command("project", async (ctx) => {
  if (!isAllowedUser(ctx)) return;

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

// Handle text messages
bot.on("message:text", async (ctx) => {
  if (!isAllowedUser(ctx)) {
    console.log("[telegram] Blocked message from user %d", ctx.from?.id);
    return;
  }

  const rateLimit = checkRateLimit(ctx.from.id);
  if (!rateLimit.allowed) {
    const retryAfterSecs = Math.ceil(rateLimit.retryAfterMs / 1000);
    await ctx.reply(`Slow down — try again in ${retryAfterSecs} seconds.`);
    return;
  }

  await handleAiResponse(ctx, ctx.message.text);
});

// Handle photos
bot.on("message:photo", async (ctx) => {
  if (!isAllowedUser(ctx)) {
    console.log("[telegram] Blocked photo from user %d", ctx.from?.id);
    return;
  }

  const rateLimit = checkRateLimit(ctx.from.id);
  if (!rateLimit.allowed) {
    const retryAfterSecs = Math.ceil(rateLimit.retryAfterMs / 1000);
    await ctx.reply(`Slow down — try again in ${retryAfterSecs} seconds.`);
    return;
  }

  try {
    // Telegram provides multiple resolutions — the last entry is always the largest
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];

    const buffer = await downloadTelegramFile(largest.file_id);
    const image: ImageAttachment = {
      base64: buffer.toString("base64"),
      mimeType: "image/jpeg",
    };

    const userMessage = ctx.message.caption || "What's in this image?";
    await handleAiResponse(ctx, userMessage, image);
  } catch (error: any) {
    console.error("[telegram] Error handling photo:", error);
    await ctx.reply("Sorry, I couldn't download that image. Try again.");
  }
});

// Handle documents (files)
bot.on("message:document", async (ctx) => {
  if (!isAllowedUser(ctx)) {
    console.log("[telegram] Blocked document from user %d", ctx.from?.id);
    return;
  }

  const rateLimit = checkRateLimit(ctx.from.id);
  if (!rateLimit.allowed) {
    const retryAfterSecs = Math.ceil(rateLimit.retryAfterMs / 1000);
    await ctx.reply(`Slow down — try again in ${retryAfterSecs} seconds.`);
    return;
  }

  const doc = ctx.message.document;
  const fileName = doc.file_name || "unknown";
  const mimeType = doc.mime_type || "";

  const textMimePrefixes = ["text/", "application/json", "application/xml", "application/javascript"];
  const textExtensions = [
    ".txt", ".md", ".json", ".csv", ".xml", ".js", ".ts", ".py",
    ".html", ".css", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".log", ".sh", ".bash",
  ];

  const isImage = mimeType.startsWith("image/");
  const isText =
    textMimePrefixes.some((prefix) => mimeType.startsWith(prefix)) ||
    textExtensions.some((ext) => fileName.toLowerCase().endsWith(ext));

  try {
    if (isImage) {
      const buffer = await downloadTelegramFile(doc.file_id);
      const image: ImageAttachment = {
        base64: buffer.toString("base64"),
        mimeType,
      };
      const userMessage = ctx.message.caption || "What's in this image?";
      await handleAiResponse(ctx, userMessage, image);
    } else if (isText) {
      const buffer = await downloadTelegramFile(doc.file_id);
      const text = buffer.toString("utf-8");

      // Truncate very large files to avoid blowing out the context window
      const MAX_TEXT_BYTES = 50_000;
      const content =
        text.length > MAX_TEXT_BYTES
          ? text.slice(0, MAX_TEXT_BYTES) + "\n\n[... truncated ...]"
          : text;

      const caption = ctx.message.caption || "Analyze this file.";
      const userMessage = `[File: ${fileName}]\n\n${content}\n\n---\n\n${caption}`;
      await handleAiResponse(ctx, userMessage);
    } else {
      const displayType = mimeType || "unknown type";
      await ctx.reply(
        `Sorry, I can't process ${displayType} files yet.\n\n` +
          "I can handle:\n" +
          "- Images (JPEG, PNG, GIF, WebP, etc.)\n" +
          "- Text files (.txt, .md, .json, .csv, .xml, .js, .ts, .py, .html, .css, .yaml, .toml, .sh, and more)",
      );
    }
  } catch (error: any) {
    console.error("[telegram] Error handling document:", error);
    await ctx.reply("Sorry, I couldn't process that file. Try again.");
  }
});

/**
 * Split a message into chunks at paragraph boundaries.
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Find a good split point (paragraph break, then sentence, then hard cut)
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = remaining.lastIndexOf(". ", maxLength);
      if (splitAt !== -1) splitAt += 1; // Include the period
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

export { bot };
