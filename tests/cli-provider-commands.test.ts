import * as fs from "node:fs";
import { Command } from "commander";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  dir: `/private/tmp/chris-cli-provider-test-${process.pid}`,
  envPath: `/private/tmp/chris-cli-provider-test-${process.pid}/.env`,
}));

const originalHome = process.env.HOME;

vi.mock("@octokit/rest", () => ({
  Octokit: class { repos = { get: vi.fn(async () => ({})) }; },
}));
vi.mock("../src/cli/pm2-helper.js", () => ({
  getBotProcess: vi.fn(async () => null), withPm2: vi.fn(), PM2_NAME: "test", PROJECT_ROOT: process.cwd(),
}));
vi.mock("../src/providers/openai-oauth.js", () => ({ loadTokens: vi.fn(() => null) }));
vi.mock("../src/codex.js", () => ({
  getCodexStatus: vi.fn(() => ({ binaryPath: null, authenticated: false, appServerAvailable: false, version: null })),
}));
vi.mock("../src/grok.js", () => ({
  getGrokStatus: vi.fn(() => ({
    binaryPath: "/fake/grok", authenticated: true, models: ["grok-4.5"], defaultModel: "grok-4.5",
    reasoningEffortFlagAvailable: true, version: "fake", errors: [],
  })),
}));
vi.mock("../src/domain/memory/health.js", () => ({
  checkMemoryHealth: vi.fn(async () => ({ ok: true, files: [], missing: [], empty: [], stale: [] })),
}));

describe("provider CLI commands with isolated configuration", () => {
  const logs: string[] = [];
  let registerDoctorCommand: typeof import("../src/cli/commands/doctor.js").registerDoctorCommand;
  let registerModelCommand: typeof import("../src/cli/commands/model.js").registerModelCommand;

  beforeAll(async () => {
    fs.mkdirSync(fixture.dir, { recursive: true });
    fs.mkdirSync(`${fixture.dir}/.pm2`, { recursive: true });
    fs.writeFileSync(`${fixture.dir}/.pm2/dump.pm2`, '{"TOKEN":"protected"}\n', { mode: 0o600 });
    process.env.HOME = fixture.dir;
    process.env.CHRIS_ASSISTANT_ENV_FILE = fixture.envPath;
    fs.writeFileSync(fixture.envPath, [
      "TELEGRAM_BOT_TOKEN=fake-telegram-token",
      "TELEGRAM_ALLOWED_USER_ID=123",
      "GITHUB_TOKEN=fake-github-token",
      "GITHUB_MEMORY_REPO=owner/repo",
      "DEEPSEEK_API_KEY=fake-deepseek-key",
      "AI_MODEL=gpt-4o",
      "",
    ].join("\n"));
    ({ registerDoctorCommand } = await import("../src/cli/commands/doctor.js"));
    ({ registerModelCommand } = await import("../src/cli/commands/model.js"));
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: { username: "fake" } }) })));
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
    process.env.HOME = originalHome;
    delete process.env.CHRIS_ASSISTANT_ENV_FILE;
  });

  it("selects a model and validated effort without touching the project .env", async () => {
    const program = new Command().exitOverride();
    registerModelCommand(program);
    await program.parseAsync(["node", "test", "model", "set", "deepseek-pro", "--effort", "max"]);
    const written = fs.readFileSync(fixture.envPath, "utf-8");
    expect(written).toContain("AI_MODEL=deepseek-v4-pro");
    expect(written).toContain("AI_REASONING_EFFORT=max");
  });

  it("runs doctor end to end with fake provider and network clients", async () => {
    logs.length = 0;
    const program = new Command().exitOverride();
    registerDoctorCommand(program);
    await program.parseAsync(["node", "test", "doctor"]);
    const output = logs.join("\n");
    expect(output).toContain("Grok CLI runtime");
    expect(output).toContain("DeepSeek API key");
    expect(output).not.toContain("contents match common secret-name patterns");
    expect(output).not.toContain("fake-deepseek-key");
    expect(output).not.toContain("fake-telegram-token");
  });
});
