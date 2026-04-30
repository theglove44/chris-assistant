import { z } from "zod";

const envString = z.string().min(1);
const optionalString = z.string().min(1).nullable();

export const envSchema = z.object({
  AI_MODEL: z.string().optional(),
  CLAUDE_MODEL: z.string().optional(),
  IMAGE_MODEL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: envString,
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int(),
  TELEGRAM_ALLOW_BOT_MESSAGES: z.coerce.boolean().optional(),
  TELEGRAM_TRANSPORT: z.enum(["polling", "webhook"]).optional(),
  TELEGRAM_WEBHOOK_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "must be HTTPS")
    .optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).max(256).optional(),
  TELEGRAM_WEBHOOK_PORT: z.coerce.number().int().positive().optional(),
  GITHUB_TOKEN: envString,
  GITHUB_MEMORY_REPO: envString.regex(/^[^/]+\/[^/]+$/, "Expected owner/repo format"),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  MAX_TOOL_TURNS: z.coerce.number().int().positive().optional(),
  DASHBOARD_PORT: z.coerce.number().int().positive().optional(),
  DASHBOARD_TOKEN: z.string().optional(),
  DOCS_URL: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  WEBHOOK_PORT: z.coerce.number().int().positive().optional(),
  SYMPHONY_STATUS_URL: z.string().url().optional(),
  OCTOPUS_API_KEY: z.string().optional(),
  OCTOPUS_ACCOUNT_NUMBER: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
});

export function normalizeOptional(value?: string): string | null {
  return value && value.trim().length > 0 ? value : null;
}

export { optionalString };
