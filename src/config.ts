import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  model: process.env.AI_MODEL || process.env.CLAUDE_MODEL /* back-compat */ || "gpt-4o",
  imageModel: process.env.IMAGE_MODEL || "gpt-5.2",
  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    allowedUserId: Number(required("TELEGRAM_ALLOWED_USER_ID")),
  },
  github: {
    token: required("GITHUB_TOKEN"),
    memoryRepo: required("GITHUB_MEMORY_REPO"),
  },
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || null,
    guildId: process.env.DISCORD_GUILD_ID || null,
  },
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY || null,
  maxToolTurns: Number(process.env.MAX_TOOL_TURNS || "200"),
} as const;

export const [repoOwner, repoName] = config.github.memoryRepo.split("/");
