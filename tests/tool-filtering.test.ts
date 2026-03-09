// Must set env vars before importing modules that depend on config.ts
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_ALLOWED_USER_ID = "12345";
process.env.GITHUB_TOKEN = "test-github-token";
process.env.GITHUB_MEMORY_REPO = "test/repo";

import { describe, expect, it } from "vitest";
import { registerTool } from "../src/tools/registry.js";
import { filterTools } from "../src/tools/filtering.js";
import { getOpenAiToolDefinitions } from "../src/tools/openai-adapter.js";

registerTool({
  name: "test_always_tool",
  category: "always",
  description: "Always available test tool",
  zodSchema: {},
  jsonSchemaParameters: {
    type: "object",
    required: [],
    properties: {},
  },
  execute: async () => "ok",
});

registerTool({
  name: "test_coding_tool",
  category: "coding",
  description: "Coding-only test tool",
  zodSchema: {},
  jsonSchemaParameters: {
    type: "object",
    required: [],
    properties: {},
  },
  execute: async () => "ok",
});

describe("tool filtering", () => {
  it("includes coding tools when includeCoding is true", () => {
    const names = filterTools(true).map((tool) => tool.name);
    expect(names).toContain("test_always_tool");
    expect(names).toContain("test_coding_tool");
  });

  it("excludes coding tools when includeCoding is false", () => {
    const names = filterTools(false).map((tool) => tool.name);
    expect(names).toContain("test_always_tool");
    expect(names).not.toContain("test_coding_tool");
  });

  it("applies allowedTools filtering", () => {
    const names = filterTools(true, ["test_coding_tool"]).map((tool) => tool.name);
    expect(names).toEqual(["test_coding_tool"]);
  });

  it("builds OpenAI tool definitions from filtered tools", () => {
    const defs = getOpenAiToolDefinitions(false).map((tool) => tool.function.name);
    expect(defs).toContain("test_always_tool");
    expect(defs).not.toContain("test_coding_tool");
  });
});
