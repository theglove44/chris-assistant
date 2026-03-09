import { Bot, Context } from "grammy";
import { config } from "../../config.js";
import { authMiddleware, rateLimitMiddleware } from "../../middleware.js";

export const bot = new Bot<Context>(config.telegram.botToken);

bot.use(authMiddleware);
bot.use(rateLimitMiddleware);

export async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
