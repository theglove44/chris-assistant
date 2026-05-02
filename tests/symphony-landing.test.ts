import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { GitHubIssueLander } from "../src/symphony/landing.js";
import type { Issue, SymphonyConfig, Tracker } from "../src/symphony/types.js";

function makeConfig(root: string): SymphonyConfig {
  return {
    workflowPath: path.join(root, "WORKFLOW.md"),
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
    polling: { intervalMs: 30_000 },
    workspace: { root },
    landing: {
      enabled: true,
      triggerState: "symphony:human-review",
      baseBranch: "main",
      branchPrefix: "codex/symphony/",
      draft: true,
      commitMessageTemplate: "chore: land {{ issue.identifier }}",
      pullRequestTitleTemplate: "{{ issue.identifier }} {{ issue.title }}",
      pullRequestBodyTemplate: "Latest: {{ last_agent_message }}",
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

const ISSUE: Issue = {
  id: "40",
  identifier: "#40",
  title: "Document GitHub-backed Symphony operator flow",
  description: null,
  priority: null,
  state: "symphony:human-review",
  branchName: null,
  url: "https://github.com/theglove44/chris-assistant/issues/40",
  labels: ["symphony:human-review"],
  blockedBy: [],
  assigneeId: null,
  assignedToWorker: false,
  createdAt: null,
  updatedAt: null,
};

function initGitWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-landing-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:theglove44/chris-assistant.git"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "hello\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "hello world\n", "utf-8");
  return root;
}

function cloneWorkspaceFromLocalSource(sourceRepo: string): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-landing-clone-"));
  execFileSync("git", ["clone", sourceRepo, workspace], { stdio: "pipe" });
  fs.writeFileSync(path.join(workspace, "README.md"), "hello from clone\n", "utf-8");
  return workspace;
}

describe("GitHubIssueLander", () => {
  it("commits workspace changes and creates a pull request via the tracker", async () => {
    const root = initGitWorkspace();
    const calls: Array<Record<string, unknown>> = [];
    const tracker: Tracker = {
      async fetchCandidateIssues() { return []; },
      async fetchIssuesByStates() { return []; },
      async fetchIssueStatesByIds() { return []; },
      async createComment() {},
      async updateIssueState() {},
      async ensurePullRequest(input) {
        calls.push(input);
        return {
          number: 901,
          url: "https://github.com/theglove44/chris-assistant/pull/901",
          headBranch: input.headBranch,
          existed: false,
        };
      },
    };

    const lander = new GitHubIssueLander(makeConfig(root), tracker, async (args, cwd, env = {}) => {
      if (args[0] === "push" || args[0] === "fetch") {
        return "pushed";
      }
      return execFileSync("git", args, {
        cwd,
        env: { ...process.env, ...env },
        encoding: "utf-8",
      });
    });
    const result = await lander.land(ISSUE, root, "typecheck passed");

    expect(result.status).toBe("created");
    expect(result.branchName).toContain("codex/symphony/issue-40");
    expect(result.pullRequest?.url).toContain("/pull/901");
    expect(calls[0]?.headBranch).toBe(result.branchName);
    expect(calls[0]?.baseBranch).toBe("main");
    expect(calls[0]?.body).toContain("typecheck passed");
    expect(execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: root, encoding: "utf-8" }).trim())
      .toBe("chore: land #40");
  });

  it("skips landing when there are no workspace changes", async () => {
    const root = initGitWorkspace();
    execFileSync("git", ["checkout", "--", "README.md"], { cwd: root });

    const tracker: Tracker = {
      async fetchCandidateIssues() { return []; },
      async fetchIssuesByStates() { return []; },
      async fetchIssueStatesByIds() { return []; },
      async createComment() {},
      async updateIssueState() {},
      async ensurePullRequest() {
        throw new Error("should not create pull request");
      },
    };

    const lander = new GitHubIssueLander(makeConfig(root), tracker, async (args, cwd, env = {}) => {
      if (args[0] === "push") {
        return "pushed";
      }
      return execFileSync("git", args, {
        cwd,
        env: { ...process.env, ...env },
        encoding: "utf-8",
      });
    });
    const result = await lander.land(ISSUE, root, "nothing changed");

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("no workspace changes");
  });

  it("rewrites a local clone origin to the source repo's real remote before pushing", async () => {
    const sourceRepo = initGitWorkspace();
    const workspace = cloneWorkspaceFromLocalSource(sourceRepo);
    const previousSourceRepo = process.env.SYMPHONY_SOURCE_REPO;
    process.env.SYMPHONY_SOURCE_REPO = sourceRepo;

    const tracker: Tracker = {
      async fetchCandidateIssues() { return []; },
      async fetchIssuesByStates() { return []; },
      async fetchIssueStatesByIds() { return []; },
      async createComment() {},
      async updateIssueState() {},
      async ensurePullRequest(input) {
        return {
          number: 902,
          url: "https://github.com/theglove44/chris-assistant/pull/902",
          headBranch: input.headBranch,
          existed: false,
        };
      },
    };

    try {
      const lander = new GitHubIssueLander(makeConfig(workspace), tracker, async (args, cwd, env = {}) => {
        if (args[0] === "push" || args[0] === "fetch") {
          return "pushed";
        }
        return execFileSync("git", args, {
          cwd,
          env: { ...process.env, ...env },
          encoding: "utf-8",
        });
      });

      await lander.land(ISSUE, workspace, "updated docs");
      expect(execFileSync("git", ["remote", "get-url", "origin"], { cwd: workspace, encoding: "utf-8" }).trim())
        .toBe("git@github.com:theglove44/chris-assistant.git");
    } finally {
      if (previousSourceRepo === undefined) {
        delete process.env.SYMPHONY_SOURCE_REPO;
      } else {
        process.env.SYMPHONY_SOURCE_REPO = previousSourceRepo;
      }
    }
  });

  it("uses the configured main base branch even when the source repo is on a feature branch", async () => {
    const sourceRepo = initGitWorkspace();
    execFileSync("git", ["checkout", "-b", "codex/symphony/unpublished-test-landing"], { cwd: sourceRepo });
    const workspace = cloneWorkspaceFromLocalSource(sourceRepo);
    const previousSourceRepo = process.env.SYMPHONY_SOURCE_REPO;
    process.env.SYMPHONY_SOURCE_REPO = sourceRepo;
    const calls: Array<Record<string, unknown>> = [];

    const tracker: Tracker = {
      async fetchCandidateIssues() { return []; },
      async fetchIssuesByStates() { return []; },
      async fetchIssueStatesByIds() { return []; },
      async createComment() {},
      async updateIssueState() {},
      async ensurePullRequest(input) {
        calls.push(input);
        return {
          number: 903,
          url: "https://github.com/theglove44/chris-assistant/pull/903",
          headBranch: input.headBranch,
          existed: false,
        };
      },
    };

    try {
      const config = makeConfig(workspace);
      config.landing.baseBranch = "main";

      const lander = new GitHubIssueLander(config, tracker, async (args, cwd, env = {}) => {
        if (args[0] === "push" || args[0] === "fetch") {
          return "pushed";
        }
        return execFileSync("git", args, {
          cwd,
          env: { ...process.env, ...env },
          encoding: "utf-8",
        });
      });

      await lander.land(ISSUE, workspace, "updated docs");
      expect(calls[0]?.baseBranch).toBe("main");
      expect(execFileSync("git", ["remote", "get-url", "origin"], { cwd: workspace, encoding: "utf-8" }).trim())
        .toBe("git@github.com:theglove44/chris-assistant.git");
    } finally {
      if (previousSourceRepo === undefined) {
        delete process.env.SYMPHONY_SOURCE_REPO;
      } else {
        process.env.SYMPHONY_SOURCE_REPO = previousSourceRepo;
      }
    }
  });
});
