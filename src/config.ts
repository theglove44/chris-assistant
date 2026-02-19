import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929",
  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    allowedUserId: Number(required("TELEGRAM_ALLOWED_USER_ID")),
  },
  github: {
    token: required("GITHUB_TOKEN"),
    memoryRepo: required("GITHUB_MEMORY_REPO"),
  },
} as const;

export const [repoOwner, repoName] = config.github.memoryRepo.split("/");
