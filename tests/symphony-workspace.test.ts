import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { buildLandingBranchName } from "../src/symphony/landing.js";
import { WorkspaceManager } from "../src/symphony/workspace.js";
import type { Issue, SymphonyConfig } from "../src/symphony/types.js";

function makeConfig(root: string): SymphonyConfig {
  return {
    workflowPath: path.join(root, "WORKFLOW.md"),
    tracker: {
      kind: "memory",
      endpoint: "",
      apiKey: null,
      projectSlug: null,
      repo: null,
      assignee: null,
      activeStates: ["Todo", "In Progress"],
      terminalStates: ["Done"],
    },
    polling: { intervalMs: 30_000 },
    workspace: { root },
    landing: {
      enabled: false,
      triggerState: null,
      baseBranch: null,
      branchPrefix: "codex/symphony/",
      draft: true,
      commitMessageTemplate: "",
      pullRequestTitleTemplate: "",
      pullRequestBodyTemplate: "",
      authorName: "Symphony Bot",
      authorEmail: "symphony@example.com",
    },
    hooks: {
      afterCreate: "printf created > created.txt",
      beforeRun: null,
      afterRun: null,
      beforeRemove: null,
      timeoutMs: 10_000,
    },
    agent: {
      maxConcurrentAgents: 1,
      maxTurns: 1,
      maxRetryBackoffMs: 10_000,
      provider: "codex" as const,
    },
    codex: {
      command: "codex app-server",
      model: null,
      reasoningEffort: null,
      approvalPolicy: "never",
      threadSandbox: "workspace-write",
      turnTimeoutMs: 10_000,
      readTimeoutMs: 5_000,
      stallTimeoutMs: 5_000,
      serviceName: "test",
    },
    claudeCode: {
      model: "claude-sonnet-4-6",
      maxTurnsPerQuery: null,
      systemPromptAppend: null,
      turnTimeoutMs: 3_600_000,
    },
    server: {
      host: "127.0.0.1",
      port: null,
    },
  };
}

function makeGitHubConfig(root: string): SymphonyConfig {
  return {
    ...makeConfig(root),
    tracker: {
      kind: "github",
      endpoint: "",
      apiKey: null,
      projectSlug: null,
      repo: "theglove44/chris-assistant",
      assignee: null,
      activeStates: ["symphony:todo", "symphony:in-progress", "symphony:rework"],
      terminalStates: ["closed"],
    },
    landing: {
      ...makeConfig(root).landing,
      enabled: true,
      baseBranch: "main",
    },
  };
}

const TEST_ISSUE: Issue = {
  id: "issue-1",
  identifier: "CA-100",
  title: "Workspace test",
  description: null,
  priority: null,
  state: "Todo",
  branchName: null,
  url: null,
  labels: [],
  blockedBy: [],
  assigneeId: null,
  assignedToWorker: false,
  createdAt: null,
  updatedAt: null,
};

describe("WorkspaceManager", () => {
  it("creates per-issue workspaces and runs after_create hooks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-workspaces-"));
    const manager = new WorkspaceManager(makeConfig(root));

    const workspace = await manager.createForIssue(TEST_ISSUE);
    const createdMarker = path.join(workspace.path, "created.txt");

    expect(workspace.path).toContain("CA-100");
    expect(fs.existsSync(createdMarker)).toBe(true);
    expect(fs.readFileSync(createdMarker, "utf-8")).toBe("created");
  });

  it("rejects workspace paths outside the configured root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-workspaces-"));
    const manager = new WorkspaceManager(makeConfig(root));

    expect(() => manager.validateWorkspacePath("/tmp/not-allowed")).toThrow();
  });

  it("resets existing rework workspaces onto the landed issue branch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-workspaces-"));
    const config = makeGitHubConfig(root);
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-remote-"));
    execFileSync("git", ["init", "--bare"], { cwd: remote });

    const seed = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-seed-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: seed });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: seed });
    fs.writeFileSync(path.join(seed, "README.md"), "main\n", "utf-8");
    execFileSync("git", ["add", "README.md"], { cwd: seed });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], { cwd: seed });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: seed });

    const issue = { ...TEST_ISSUE, state: "symphony:rework" };
    const issueBranch = buildLandingBranchName(config.landing.branchPrefix, issue);
    execFileSync("git", ["checkout", "-b", issueBranch], { cwd: seed });
    fs.writeFileSync(path.join(seed, "README.md"), "rework branch\n", "utf-8");
    execFileSync("git", ["add", "README.md"], { cwd: seed });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "issue branch"], { cwd: seed });
    execFileSync("git", ["push", "-u", "origin", issueBranch], { cwd: seed });

    const workspacePath = path.join(root, "CA-100");
    execFileSync("git", ["clone", remote, workspacePath], { stdio: "pipe" });
    execFileSync("git", ["checkout", "main"], { cwd: workspacePath });
    fs.writeFileSync(path.join(workspacePath, "README.md"), "stale local\n", "utf-8");
    fs.writeFileSync(path.join(workspacePath, "scratch.txt"), "remove me\n", "utf-8");

    const manager = new WorkspaceManager(config);
    const workspace = await manager.createForIssue(issue);

    expect(workspace.createdNow).toBe(false);
    expect(execFileSync("git", ["branch", "--show-current"], { cwd: workspace.path, encoding: "utf-8" }).trim())
      .toBe(issueBranch);
    expect(fs.readFileSync(path.join(workspace.path, "README.md"), "utf-8")).toBe("rework branch\n");
    expect(fs.existsSync(path.join(workspace.path, "scratch.txt"))).toBe(false);
  });
});
