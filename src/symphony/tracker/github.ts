import { Octokit } from "@octokit/rest";
import { config as appConfig } from "../../config.js";
import type { Issue, SymphonyConfig, Tracker } from "../types.js";

interface GitHubIssueShape {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  html_url?: string;
  labels?: Array<string | { name?: string | null }>;
  assignees?: Array<{ login?: string | null }> | null;
  created_at?: string;
  updated_at?: string;
  pull_request?: unknown;
}

interface GitHubApiClient {
  issues: {
    listForRepo(params: Record<string, unknown>): Promise<{ data: GitHubIssueShape[] }>;
    get(params: Record<string, unknown>): Promise<{ data: GitHubIssueShape }>;
    createComment(params: Record<string, unknown>): Promise<unknown>;
    update(params: Record<string, unknown>): Promise<unknown>;
    setLabels(params: Record<string, unknown>): Promise<unknown>;
  };
  pulls: {
    list(params: Record<string, unknown>): Promise<{ data: Array<{ number: number; html_url?: string; head?: { ref?: string | null } }> }>;
    create(params: Record<string, unknown>): Promise<{ data: { number: number; html_url?: string; head?: { ref?: string | null } } }>;
  };
  users: {
    getAuthenticated(): Promise<{ data: { login?: string | null } }>;
  };
}

function createGitHubClient(): GitHubApiClient {
  return new Octokit({
    auth: appConfig.github.token,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  }) as unknown as GitHubApiClient;
}

export class GitHubTracker implements Tracker {
  private readonly owner: string;
  private readonly repo: string;
  private readonly client: GitHubApiClient;
  private authenticatedLogin: Promise<string | null> | null = null;

  constructor(
    private readonly config: SymphonyConfig,
    deps: { client?: GitHubApiClient } = {},
  ) {
    const repo = parseRepo(config.tracker.repo);
    this.owner = repo.owner;
    this.repo = repo.repo;
    this.client = deps.client || createGitHubClient();
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.fetchOpenIssuesByStates(this.config.tracker.activeStates);
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    const wantsClosed = states.some(isGitHubClosedState);
    const wantsOpenLabels = states.filter((state) => !isGitHubClosedState(state));
    const results = new Map<string, Issue>();

    if (wantsOpenLabels.length > 0) {
      for (const issue of await this.fetchOpenIssuesByStates(wantsOpenLabels)) {
        results.set(issue.id, issue);
      }
    }

    if (wantsClosed) {
      const closedIssues = await this.listIssues("closed");
      for (const raw of closedIssues) {
        const issue = normalizeIssue(raw, this.config);
        if (issue && await this.matchesAssignee(issue)) {
          results.set(issue.id, issue);
        }
      }
    }

    return Array.from(results.values());
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    for (const id of ids) {
      const issueNumber = parseIssueNumber(id);
      const response = await this.client.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });
      const issue = normalizeIssue(response.data, this.config);
      if (issue) {
        issues.push(issue);
      }
    }

    return issues;
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.client.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseIssueNumber(issueId),
      body,
    });
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const issueNumber = parseIssueNumber(issueId);
    const response = await this.client.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    const existingLabels = extractLabelNames(response.data.labels);
    const nextLabels = existingLabels.filter((label) => !isManagedGitHubStateLabel(label));
    const normalizedState = stateName.trim();

    if (!isGitHubClosedState(normalizedState)) {
      nextLabels.push(normalizedState);
    }

    await this.client.issues.setLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels: Array.from(new Set(nextLabels)),
    });

    await this.client.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: isGitHubClosedState(normalizedState) ? "closed" : "open",
    });
  }

  async ensurePullRequest(input: {
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
    draft: boolean;
  }): Promise<{ number: number; url: string; headBranch: string; existed: boolean }> {
    const existing = await this.client.pulls.list({
      owner: this.owner,
      repo: this.repo,
      state: "open",
      head: `${this.owner}:${input.headBranch}`,
      base: input.baseBranch,
      per_page: 1,
    });

    const current = existing.data[0];
    if (current?.number && current.html_url) {
      return {
        number: current.number,
        url: current.html_url,
        headBranch: current.head?.ref || input.headBranch,
        existed: true,
      };
    }

    const created = await this.client.pulls.create({
      owner: this.owner,
      repo: this.repo,
      head: input.headBranch,
      base: input.baseBranch,
      title: input.title,
      body: input.body,
      draft: input.draft,
    });

    if (!created.data.html_url) {
      throw new Error("GitHub pull request creation did not return a URL");
    }

    return {
      number: created.data.number,
      url: created.data.html_url,
      headBranch: created.data.head?.ref || input.headBranch,
      existed: false,
    };
  }

  private async fetchOpenIssuesByStates(states: string[]): Promise<Issue[]> {
    const issues = await this.listIssues("open");
    const wanted = new Set(states.map((state) => state.trim().toLowerCase()));
    const results: Issue[] = [];

    for (const raw of issues) {
      const issue = normalizeIssue(raw, this.config);
      if (!issue) continue;
      if (!wanted.has(issue.state.trim().toLowerCase())) continue;
      if (!await this.matchesAssignee(issue)) continue;
      results.push(issue);
    }

    return results;
  }

  private async listIssues(state: "open" | "closed"): Promise<GitHubIssueShape[]> {
    const results: GitHubIssueShape[] = [];
    let page = 1;

    while (true) {
      const response = await this.client.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        state,
        per_page: 100,
        page,
      });
      const pageItems = response.data.filter((issue) => !issue.pull_request);
      results.push(...pageItems);

      if (response.data.length < 100) {
        break;
      }
      page += 1;
    }

    return results;
  }

  private async matchesAssignee(issue: Issue): Promise<boolean> {
    const wanted = this.config.tracker.assignee?.trim();
    if (!wanted) return true;

    if (wanted.toLowerCase() === "me") {
      const login = await this.getAuthenticatedLogin();
      return !!login && issue.assigneeId?.toLowerCase() === login.toLowerCase();
    }

    return issue.assigneeId?.toLowerCase() === wanted.toLowerCase();
  }

  private async getAuthenticatedLogin(): Promise<string | null> {
    if (!this.authenticatedLogin) {
      this.authenticatedLogin = this.client.users.getAuthenticated()
        .then((response) => response.data.login || null)
        .catch(() => null);
    }
    return this.authenticatedLogin;
  }
}

function parseRepo(value: string | null): { owner: string; repo: string } {
  const repo = (value || "").trim();
  const match = /^([^/]+)\/([^/]+)$/.exec(repo);
  if (!match) {
    throw new Error(`Invalid GitHub tracker repo: ${value || "(missing)"}`);
  }
  return { owner: match[1], repo: match[2] };
}

function parseIssueNumber(value: string): number {
  const normalized = value.trim().replace(/^#/, "");
  const issueNumber = Number.parseInt(normalized, 10);
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid GitHub issue id: ${value}`);
  }
  return issueNumber;
}

function normalizeIssue(issue: GitHubIssueShape, config: SymphonyConfig): Issue | null {
  if (!issue?.number || !issue.title) return null;

  const labels = extractLabelNames(issue.labels);
  const state = resolveIssueState(issue.state, labels, config);
  const assignee = Array.isArray(issue.assignees) ? issue.assignees.find((entry) => entry?.login) : null;

  return {
    id: String(issue.number),
    identifier: `#${issue.number}`,
    title: issue.title,
    description: typeof issue.body === "string" ? issue.body : null,
    priority: null,
    state,
    branchName: null,
    url: typeof issue.html_url === "string" ? issue.html_url : null,
    labels,
    blockedBy: [],
    assigneeId: assignee?.login ? String(assignee.login) : null,
    assignedToWorker: !!assignee?.login,
    createdAt: typeof issue.created_at === "string" ? issue.created_at : null,
    updatedAt: typeof issue.updated_at === "string" ? issue.updated_at : null,
  };
}

function extractLabelNames(labels: GitHubIssueShape["labels"]): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => {
      if (typeof label === "string") return label.trim();
      return typeof label?.name === "string" ? label.name.trim() : "";
    })
    .filter(Boolean);
}

function resolveIssueState(
  issueState: GitHubIssueShape["state"],
  labels: string[],
  config: SymphonyConfig,
): string {
  const stateLabels = labels.filter(isManagedGitHubStateLabel);
  const configuredState = stateLabels.find((label) => {
    const lower = label.toLowerCase();
    return config.tracker.activeStates.some((state) => state.trim().toLowerCase() === lower);
  });

  if (configuredState) {
    return configuredState;
  }

  if (stateLabels.length > 0) {
    return stateLabels[0];
  }

  return issueState === "closed" ? "Closed" : "Open";
}

function isManagedGitHubStateLabel(value: string): boolean {
  return value.trim().toLowerCase().startsWith("symphony:");
}

function isGitHubClosedState(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "closed" || normalized === "done";
}
