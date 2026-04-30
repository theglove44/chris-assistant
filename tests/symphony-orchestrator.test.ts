import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DynamicToolHandler,
  Issue,
  LandingResult,
  PullRequestCiStatus,
  SymphonyConfig,
  Tracker,
  WorkflowDefinition,
} from "../src/symphony/types.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function makeConfig(workspaceRoot: string): SymphonyConfig {
  return {
    workflowPath: path.join(workspaceRoot, "WORKFLOW.md"),
    tracker: {
      kind: "memory",
      endpoint: "",
      apiKey: null,
      projectSlug: null,
      repo: null,
      assignee: null,
      activeStates: ["Todo", "In Progress"],
      terminalStates: ["Done", "Closed"],
    },
    polling: { intervalMs: 30_000 },
    workspace: { root: workspaceRoot },
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
      afterCreate: null,
      beforeRun: null,
      afterRun: null,
      beforeRemove: null,
      timeoutMs: 10_000,
    },
    agent: { maxConcurrentAgents: 0, maxTurns: 1, maxRetryBackoffMs: 10_000 },
    codex: {
      command: "codex app-server",
      model: null,
      reasoningEffort: null,
      approvalPolicy: "never",
      threadSandbox: "workspace-write",
      turnTimeoutMs: 10_000,
      readTimeoutMs: 5_000,
      stallTimeoutMs: 5_000,
      serviceName: "test-symphony",
    },
    server: { host: "127.0.0.1", port: null },
  };
}

function makeDefinition(workflowPath: string): WorkflowDefinition {
  return {
    path: workflowPath,
    config: {},
    promptTemplate: "Work issue {{ issue.identifier }}",
  };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "CA-300",
    title: "Blocked orchestrator test",
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
    ...overrides,
  };
}

const DYNAMIC_TOOLS: DynamicToolHandler = {
  listTools() {
    return [];
  },
  async execute() {
    return {};
  },
};

async function withTempHome<T>(fn: () => Promise<T>): Promise<T> {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-home-"));
  cleanupPaths.push(tempHome);
  const previousHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    return await fn();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
}

describe("SymphonyOrchestrator", () => {
  it("reports blocked issues once per blocker state change", async () => {
    await withTempHome(async () => {
      const { SymphonyOrchestrator } = await import("../src/symphony/orchestrator.js");
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-orchestrator-"));
      cleanupPaths.push(workspaceRoot);

      const blocker = { id: "blocker-1", identifier: "CA-299", state: "In Progress" };
      let issues = [makeIssue({ blockedBy: [blocker] })];
      const comments: Array<{ issueId: string; body: string }> = [];

      const tracker: Tracker = {
        async fetchCandidateIssues() {
          return issues;
        },
        async fetchIssuesByStates() {
          return [];
        },
        async fetchIssueStatesByIds(ids: string[]) {
          return issues.filter((issue) => ids.includes(issue.id));
        },
        async createComment(issueId: string, body: string) {
          comments.push({ issueId, body });
        },
        async updateIssueState() {},
      };

      const orchestrator = new SymphonyOrchestrator(
        makeDefinition(path.join(workspaceRoot, "WORKFLOW.md")),
        makeConfig(workspaceRoot),
        tracker,
        DYNAMIC_TOOLS,
      );

      await (orchestrator as any).poll();
      await (orchestrator as any).poll();
      expect(comments).toHaveLength(1);
      expect(comments[0]?.body).toContain("currently blocked");
      expect(comments[0]?.body).toContain("CA-299");

      issues = [makeIssue({ blockedBy: [] })];
      await (orchestrator as any).poll();

      issues = [makeIssue({ blockedBy: [{ ...blocker, state: "Todo" }] })];
      await (orchestrator as any).poll();

      expect(comments).toHaveLength(2);
      await orchestrator.stop();
    });
  });

  it("formats a blocking reason from the first non-terminal dependency", () => {
    const config = makeConfig(fs.mkdtempSync(path.join(os.tmpdir(), "symphony-block-reason-")));
    cleanupPaths.push(config.workspace.root);

    const issue = makeIssue({
      blockedBy: [
        { id: "done-1", identifier: "CA-100", state: "Done" },
        { id: "todo-1", identifier: "CA-101", state: "Todo" },
      ],
    });

    return withTempHome(async () => {
      const { getBlockingReason } = await import("../src/symphony/orchestrator.js");
      expect(getBlockingReason(issue, config)).toBe("Blocked by CA-101 (Todo).");
    });
  });

  it("posts CI-aware feedback after landing when workflow runs fail", async () => {
    await withTempHome(async () => {
      const { SymphonyOrchestrator } = await import("../src/symphony/orchestrator.js");
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-orchestrator-"));
      cleanupPaths.push(workspaceRoot);
      const comments: Array<{ issueId: string; body: string }> = [];
      const ciStatus: PullRequestCiStatus = {
        state: "failure",
        completed: true,
        summary: "CI failed in 1 workflow run(s).",
        runs: [
          {
            workflowName: "CI",
            name: "check",
            status: "completed",
            conclusion: "failure",
            url: "https://github.com/theglove44/chris-assistant/actions/runs/1",
          },
        ],
      };

      const tracker: Tracker = {
        async fetchCandidateIssues() { return []; },
        async fetchIssuesByStates() { return []; },
        async fetchIssueStatesByIds() { return []; },
        async createComment(issueId: string, body: string) {
          comments.push({ issueId, body });
        },
        async updateIssueState() {},
        async getPullRequestCiStatus() {
          return ciStatus;
        },
      };

      const orchestrator = new SymphonyOrchestrator(
        makeDefinition(path.join(workspaceRoot, "WORKFLOW.md")),
        makeConfig(workspaceRoot),
        tracker,
        DYNAMIC_TOOLS,
      );

      const landing: LandingResult = {
        status: "created",
        branchName: "codex/symphony/issue-1",
        commitSha: "abc123def456",
        pullRequest: {
          number: 46,
          url: "https://github.com/theglove44/chris-assistant/pull/46",
          headBranch: "codex/symphony/issue-1",
          existed: false,
        },
        reason: null,
      };

      const issue = makeIssue({ state: "symphony:human-review" });
      const enriched = await (orchestrator as any).attachCiFeedback(issue, landing);

      expect(enriched?.ci?.state).toBe("failure");
      expect(comments).toHaveLength(1);
      expect(comments[0]?.body).toContain("CI update for draft PR");
      expect(comments[0]?.body).toContain("CI status: failed.");
      expect(comments[0]?.body).toContain("symphony:rework");
      await orchestrator.stop();
    });
  });

  it("bounds stop() with a shutdown timeout and force-kills stragglers", async () => {
    await withTempHome(async () => {
      const { SymphonyOrchestrator } = await import("../src/symphony/orchestrator.js");
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-orchestrator-"));
      cleanupPaths.push(workspaceRoot);

      const tracker: Tracker = {
        async fetchCandidateIssues() { return []; },
        async fetchIssuesByStates() { return []; },
        async fetchIssueStatesByIds() { return []; },
        async createComment() {},
        async updateIssueState() {},
      };

      const orchestrator = new SymphonyOrchestrator(
        makeDefinition(path.join(workspaceRoot, "WORKFLOW.md")),
        makeConfig(workspaceRoot),
        tracker,
        DYNAMIC_TOOLS,
      );

      // Inject a fake running entry whose handle.promise never resolves, the
      // shape orchestrator.stop() would otherwise wait turnTimeoutMs (1hr) for.
      const issue = makeIssue();
      let stopCalled = false;
      let forceKillCalled = false;
      const handle = {
        promise: new Promise<never>(() => { /* never resolves */ }),
        stop() { stopCalled = true; },
        forceKill() { forceKillCalled = true; },
      };
      (orchestrator as any).running.set(issue.id, {
        issue,
        attempt: 0,
        startedAt: Date.now(),
        handle,
        workspacePath: null,
        threadId: null,
        turnId: null,
        lastEvent: null,
        lastMessage: null,
      });

      const previousTimeout = process.env.SYMPHONY_SHUTDOWN_TIMEOUT_MS;
      process.env.SYMPHONY_SHUTDOWN_TIMEOUT_MS = "100";
      const warnings: unknown[][] = [];
      const previousWarn = console.warn;
      console.warn = (...args: unknown[]) => { warnings.push(args); };
      try {
        const startedAt = Date.now();
        await orchestrator.stop();
        const elapsed = Date.now() - startedAt;
        expect(elapsed).toBeLessThan(2_000);
        expect(stopCalled).toBe(true);
        expect(forceKillCalled).toBe(true);
        expect(warnings.some((w) => String(w[0]).includes("shutdown timed out"))).toBe(true);
        expect((orchestrator as any).running.size).toBe(0);
      } finally {
        console.warn = previousWarn;
        if (previousTimeout === undefined) {
          delete process.env.SYMPHONY_SHUTDOWN_TIMEOUT_MS;
        } else {
          process.env.SYMPHONY_SHUTDOWN_TIMEOUT_MS = previousTimeout;
        }
      }
    });
  });
});
