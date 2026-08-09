import { describe, expect, it } from "vitest";
import { buildAgentEnvironment } from "../src/providers/agent-environment.js";

describe("agent subprocess environment", () => {
  it("keeps runtime essentials and drops application credentials", () => {
    const result = buildAgentEnvironment({
      HOME: "/Users/test",
      PATH: "/usr/bin",
      CODEX_HOME: "/Users/test/.codex",
      GITHUB_TOKEN: "github-secret",
      DEEPSEEK_API_KEY: "deepseek-secret",
      TELEGRAM_BOT_TOKEN: "telegram-secret",
    }, ["CODEX_HOME"]);

    expect(result).toEqual({
      HOME: "/Users/test",
      PATH: "/usr/bin",
      CODEX_HOME: "/Users/test/.codex",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
