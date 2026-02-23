import { Context, NextFunction } from "grammy";
import { config } from "./config.js";
import { checkRateLimit } from "./rate-limit.js";

/**
 * Middleware: reject messages from unauthorized users.
 * The /start command gets a polite rejection; all others are silently ignored.
 */
export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  if (ctx.from?.id !== config.telegram.allowedUserId) {
    // Only respond to /start from unauthorized users
    if (ctx.message?.text?.startsWith("/start")) {
      await ctx.reply("Sorry, this bot is private.");
    }
    return; // Don't call next() — block all further processing
  }
  await next();
}

/**
 * Middleware: enforce rate limiting for the allowed user.
 */
export async function rateLimitMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  // Only rate-limit messages (not callback queries etc.)
  if (!ctx.from) {
    await next();
    return;
  }

  const rateLimit = checkRateLimit(ctx.from.id);
  if (!rateLimit.allowed) {
    const retryAfterSecs = Math.ceil(rateLimit.retryAfterMs / 1000);
    await ctx.reply(`Slow down — try again in ${retryAfterSecs} seconds.`);
    return;
  }
  await next();
}
