import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
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
      assignee: null,
      activeStates: ["Todo", "In Progress"],
      terminalStates: ["Done"],
    },
    polling: { intervalMs: 30_000 },
    workspace: { root },
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
    server: {
      host: "127.0.0.1",
      port: null,
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
});
