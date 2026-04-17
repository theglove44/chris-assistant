import "dotenv/config";
import { envSchema, normalizeOptional } from "./schema.js";
import type { AppConfig } from "./types.js";
import { strictProviderForModel } from "../../providers/model-routing.js";

export interface RepoRef {
  owner: string;
  name: string;
}

function formatZodError(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const key = issue.path.length > 0 ? issue.path.join(".") : "config";
      return `${key}: ${issue.message}`;
    })
    .join("; ");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): { config: AppConfig; repo: RepoRef } {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${formatZodError(parsed.error)}`);
  }

  const values = parsed.data;
  const memoryRepo = values.GITHUB_MEMORY_REPO;
  const [owner, name] = memoryRepo.split("/");

  const model = values.AI_MODEL || values.CLAUDE_MODEL || "gpt-4o";
  try {
    strictProviderForModel(model);
  } catch (err) {
    throw new Error(`Invalid configuration: AI_MODEL — ${(err as Error).message}`);
  }

  return {
    config: {
      model,
      imageModel: values.IMAGE_MODEL || "gpt-5.2",
      telegram: {
        botToken: values.TELEGRAM_BOT_TOKEN,
        allowedUserId: values.TELEGRAM_ALLOWED_USER_ID,
        allowBotMessages: values.TELEGRAM_ALLOW_BOT_MESSAGES ?? false,
      },
      github: {
        token: values.GITHUB_TOKEN,
        memoryRepo,
      },
      discord: {
        botToken: normalizeOptional(values.DISCORD_BOT_TOKEN),
        guildId: normalizeOptional(values.DISCORD_GUILD_ID),
      },
      braveSearchApiKey: normalizeOptional(values.BRAVE_SEARCH_API_KEY),
      maxToolTurns: values.MAX_TOOL_TURNS ?? 200,
      dashboard: {
        port: values.DASHBOARD_PORT ?? 3000,
        token: normalizeOptional(values.DASHBOARD_TOKEN),
        docsUrl: normalizeOptional(values.DOCS_URL),
      },
      webhook: {
        secret: normalizeOptional(values.GITHUB_WEBHOOK_SECRET),
        port: values.WEBHOOK_PORT ?? 3001,
      },
      symphony: {
        statusUrl: values.SYMPHONY_STATUS_URL || "http://127.0.0.1:3010",
      },
      octopus: {
        apiKey: normalizeOptional(values.OCTOPUS_API_KEY),
        accountNumber: normalizeOptional(values.OCTOPUS_ACCOUNT_NUMBER),
      },
    },
    repo: { owner, name },
  };
}
