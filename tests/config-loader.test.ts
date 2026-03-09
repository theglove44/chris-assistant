import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/infra/config/load-config.js";

describe("loadConfig", () => {
  const baseEnv = {
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_ALLOWED_USER_ID: "12345",
    GITHUB_TOKEN: "github-token",
    GITHUB_MEMORY_REPO: "owner/repo",
  } satisfies Record<string, string>;

  it("loads required config with defaults", () => {
    const { config, repo } = loadConfig(baseEnv);

    expect(config.model).toBe("gpt-4o");
    expect(config.imageModel).toBe("gpt-5.2");
    expect(config.maxToolTurns).toBe(200);
    expect(config.dashboard.port).toBe(3000);
    expect(config.webhook.port).toBe(3001);
    expect(config.telegram.allowedUserId).toBe(12345);
    expect(config.discord.botToken).toBeNull();
    expect(config.dashboard.token).toBeNull();
    expect(repo).toEqual({ owner: "owner", name: "repo" });
  });

  it("prefers AI_MODEL over CLAUDE_MODEL and parses optional fields", () => {
    const { config } = loadConfig({
      ...baseEnv,
      AI_MODEL: "gpt-5.2",
      CLAUDE_MODEL: "sonnet",
      IMAGE_MODEL: "gpt-4o",
      DISCORD_BOT_TOKEN: "discord-token",
      DISCORD_GUILD_ID: "guild-123",
      BRAVE_SEARCH_API_KEY: "brave-key",
      MAX_TOOL_TURNS: "77",
      DASHBOARD_PORT: "4000",
      DASHBOARD_TOKEN: "secret",
      DOCS_URL: "https://example.com/docs",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      WEBHOOK_PORT: "4001",
      SYMPHONY_STATUS_URL: "http://127.0.0.1:9999",
    });

    expect(config.model).toBe("gpt-5.2");
    expect(config.imageModel).toBe("gpt-4o");
    expect(config.discord.botToken).toBe("discord-token");
    expect(config.discord.guildId).toBe("guild-123");
    expect(config.braveSearchApiKey).toBe("brave-key");
    expect(config.maxToolTurns).toBe(77);
    expect(config.dashboard.port).toBe(4000);
    expect(config.dashboard.token).toBe("secret");
    expect(config.dashboard.docsUrl).toBe("https://example.com/docs");
    expect(config.webhook.secret).toBe("webhook-secret");
    expect(config.webhook.port).toBe(4001);
    expect(config.symphony.statusUrl).toBe("http://127.0.0.1:9999");
  });

  it("throws a helpful error when required values are missing", () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration/);
    expect(() => loadConfig({})).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("rejects invalid memory repo format", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        GITHUB_MEMORY_REPO: "not-a-valid-repo",
      }),
    ).toThrow(/owner\/repo format/);
  });
});
