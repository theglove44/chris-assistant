import { describe, expect, it } from "vitest";
import { GitHubTracker } from "../src/symphony/tracker/github.js";
import type { SymphonyConfig } from "../src/symphony/types.js";

function makeConfig(): SymphonyConfig {
  return {
    workflowPath: "/tmp/WORKFLOW.md",
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
    workspace: { root: "/tmp/symphony" },
    landing: {
      enabled: true,
      triggerState: "symphony:human-review",
      baseBranch: "main",
      branchPrefix: "codex/symphony/",
      draft: true,
      commitMessageTemplate: "chore: test",
      pullRequestTitleTemplate: "test",
      pullRequestBodyTemplate: "body",
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

function createFakeClient() {
  const issues = new Map<number, any>([
    [12, {
      number: 12,
      title: "Ready for Symphony",
      body: "Do the work",
      state: "open",
      html_url: "https://github.com/theglove44/chris-assistant/issues/12",
      labels: [{ name: "bug" }, { name: "symphony:todo" }],
      assignees: [{ login: "theglove44" }],
      created_at: "2026-03-10T00:00:00Z",
      updated_at: "2026-03-11T00:00:00Z",
    }],
    [13, {
      number: 13,
      title: "Not managed by Symphony",
      body: null,
      state: "open",
      html_url: "https://github.com/theglove44/chris-assistant/issues/13",
      labels: [{ name: "bug" }],
      assignees: [],
      created_at: "2026-03-10T00:00:00Z",
      updated_at: "2026-03-11T00:00:00Z",
    }],
  ]);

  const comments: Array<{ issue_number: number; body: string }> = [];
  const updates: Array<Record<string, unknown>> = [];
  const labelSets: Array<Record<string, unknown>> = [];
  const pulls = new Map<string, { number: number; html_url: string; head: { ref: string } }>();
  const workflowRuns: Array<Record<string, unknown>> = [];

  return {
    issues,
    comments,
    updates,
    labelSets,
    pulls,
    workflowRuns,
    client: {
      actions: {
        async listWorkflowRunsForRepo() {
          return { data: { workflow_runs: workflowRuns as any[] } };
        },
      },
      issues: {
        async listForRepo(params: Record<string, unknown>) {
          const state = params.state;
          return {
            data: Array.from(issues.values()).filter((issue) => issue.state === state),
          };
        },
        async get(params: Record<string, unknown>) {
          return {
            data: issues.get(Number(params.issue_number)),
          };
        },
        async createComment(params: Record<string, unknown>) {
          comments.push({ issue_number: Number(params.issue_number), body: String(params.body) });
          return {};
        },
        async update(params: Record<string, unknown>) {
          updates.push(params);
          const issue = issues.get(Number(params.issue_number));
          if (issue) {
            issue.state = params.state;
          }
          return {};
        },
        async setLabels(params: Record<string, unknown>) {
          labelSets.push(params);
          const issue = issues.get(Number(params.issue_number));
          if (issue) {
            issue.labels = Array.isArray(params.labels)
              ? (params.labels as string[]).map((name) => ({ name }))
              : [];
          }
          return {};
        },
      },
      pulls: {
        async list(params: Record<string, unknown>) {
          const head = String(params.head || "").replace(/^theglove44:/, "");
          const pull = pulls.get(head);
          return { data: pull ? [pull] : [] };
        },
        async create(params: Record<string, unknown>) {
          const head = String(params.head);
          const pull = {
            number: 501,
            html_url: `https://github.com/theglove44/chris-assistant/pull/501`,
            head: { ref: head },
          };
          pulls.set(head, pull);
          return { data: pull };
        },
      },
      users: {
        async getAuthenticated() {
          return { data: { login: "theglove44" } };
        },
      },
    },
  };
}

describe("GitHubTracker", () => {
  it("fetches only open issues with managed Symphony state labels", async () => {
    const fake = createFakeClient();
    const tracker = new GitHubTracker(makeConfig(), { client: fake.client as any });

    const issues = await tracker.fetchCandidateIssues();

    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe("12");
    expect(issues[0]?.identifier).toBe("#12");
    expect(issues[0]?.state).toBe("symphony:todo");
  });

  it("comments and moves issues by rewriting managed state labels", async () => {
    const fake = createFakeClient();
    const tracker = new GitHubTracker(makeConfig(), { client: fake.client as any });

    await tracker.createComment("12", "hello from symphony");
    await tracker.updateIssueState("12", "symphony:human-review");
    await tracker.updateIssueState("12", "closed");

    expect(fake.comments).toEqual([{ issue_number: 12, body: "hello from symphony" }]);
    expect(fake.labelSets[0]?.labels).toEqual(["bug", "symphony:human-review"]);
    expect(fake.updates[0]?.state).toBe("open");
    expect(fake.labelSets[1]?.labels).toEqual(["bug"]);
    expect(fake.updates[1]?.state).toBe("closed");
  });

  it("reuses an existing open pull request for the same head branch", async () => {
    const fake = createFakeClient();
    const tracker = new GitHubTracker(makeConfig(), { client: fake.client as any });

    const first = await tracker.ensurePullRequest!({
      headBranch: "codex/symphony/issue-12",
      baseBranch: "main",
      title: "#12 Ready for Symphony",
      body: "body",
      draft: true,
    });
    const second = await tracker.ensurePullRequest!({
      headBranch: "codex/symphony/issue-12",
      baseBranch: "main",
      title: "#12 Ready for Symphony",
      body: "body",
      draft: true,
    });

    expect(first.existed).toBe(false);
    expect(second.existed).toBe(true);
    expect(second.url).toContain("/pull/501");
  });

  it("summarizes pull request CI status from workflow runs", async () => {
    const fake = createFakeClient();
    fake.workflowRuns.push(
      {
        name: "CI",
        display_title: "check",
        status: "completed",
        conclusion: "failure",
        html_url: "https://github.com/theglove44/chris-assistant/actions/runs/1",
        head_sha: "abc123",
        head_branch: "codex/symphony/issue-12",
      },
      {
        name: "Lint",
        display_title: "lint",
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/theglove44/chris-assistant/actions/runs/2",
        head_sha: "abc123",
        head_branch: "codex/symphony/issue-12",
      },
    );

    const tracker = new GitHubTracker(makeConfig(), { client: fake.client as any });
    const status = await tracker.getPullRequestCiStatus!({
      pullRequestNumber: 501,
      commitSha: "abc123",
      headBranch: "codex/symphony/issue-12",
    });

    expect(status?.state).toBe("failure");
    expect(status?.completed).toBe(true);
    expect(status?.summary).toContain("failed");
    expect(status?.runs).toHaveLength(2);
  });
});
