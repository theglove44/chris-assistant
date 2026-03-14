export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branchName: string | null;
  url: string | null;
  labels: string[];
  blockedBy: BlockerRef[];
  assigneeId: string | null;
  assignedToWorker: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkflowDefinition {
  path: string;
  config: Record<string, unknown>;
  promptTemplate: string;
}

export type CodexApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never"
  | { reject: { sandbox_approval: boolean; rules: boolean; mcp_elicitations: boolean } };

export type CodexThreadSandbox = "read-only" | "workspace-write" | "danger-full-access";

export interface SymphonyConfig {
  workflowPath: string;
  tracker: {
    kind: "linear" | "github" | "memory";
    endpoint: string;
    apiKey: string | null;
    projectSlug: string | null;
    repo: string | null;
    assignee: string | null;
    activeStates: string[];
    terminalStates: string[];
  };
  polling: {
    intervalMs: number;
  };
  workspace: {
    root: string;
  };
  landing: {
    enabled: boolean;
    triggerState: string | null;
    baseBranch: string | null;
    branchPrefix: string;
    draft: boolean;
    commitMessageTemplate: string;
    pullRequestTitleTemplate: string;
    pullRequestBodyTemplate: string;
    authorName: string;
    authorEmail: string;
  };
  hooks: {
    afterCreate: string | null;
    beforeRun: string | null;
    afterRun: string | null;
    beforeRemove: string | null;
    timeoutMs: number;
  };
  agent: {
    maxConcurrentAgents: number;
    maxTurns: number;
    maxRetryBackoffMs: number;
  };
  codex: {
    command: string;
    model: string | null;
    reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | null;
    approvalPolicy: CodexApprovalPolicy;
    threadSandbox: CodexThreadSandbox;
    turnTimeoutMs: number;
    readTimeoutMs: number;
    stallTimeoutMs: number;
    serviceName: string | null;
  };
  server: {
    host: string;
    port: number | null;
  };
}

export interface WorkspaceInfo {
  path: string;
  key: string;
  createdNow: boolean;
}

export interface DynamicToolHandler {
  listTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  execute(tool: string, arguments_: unknown): Promise<Record<string, unknown>>;
}

export interface AppServerSessionMeta {
  threadId: string;
}

export interface AppServerTurnResult {
  turnId: string;
  lastAgentMessage: string | null;
}

export interface AppServerUpdate {
  type: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  text?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  raw?: unknown;
}

export interface IssueRunResult {
  status: "completed" | "needs_retry" | "failed" | "stopped";
  issue: Issue;
  workspacePath: string;
  lastAgentMessage: string | null;
  threadId: string | null;
  turnId: string | null;
  reason?: string;
}

export interface RunnerHandle {
  promise: Promise<IssueRunResult>;
  stop(reason?: string): void;
}

export interface RetryEntrySnapshot {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAt: number;
  reason: string | null;
}

export interface RunningIssueSnapshot {
  issueId: string;
  identifier: string;
  title: string;
  state: string;
  attempt: number;
  workspacePath: string;
  startedAt: number;
  threadId: string | null;
  turnId: string | null;
  lastEvent: string | null;
  lastMessage: string | null;
}

export interface PullRequestRef {
  number: number;
  url: string;
  headBranch: string;
  existed: boolean;
}

export interface CiRunRef {
  workflowName: string | null;
  name: string;
  status: string;
  conclusion: string | null;
  url: string | null;
}

export interface PullRequestCiStatus {
  state: "pending" | "success" | "failure";
  completed: boolean;
  summary: string;
  runs: CiRunRef[];
}

export interface LandingResult {
  status: "created" | "updated" | "skipped";
  branchName: string | null;
  commitSha: string | null;
  pullRequest: PullRequestRef | null;
  reason: string | null;
  ci?: PullRequestCiStatus | null;
}

export interface CompletedIssueSnapshot {
  issueId: string;
  identifier: string;
  title: string;
  state: string;
  finishedAt: number;
  lastMessage: string | null;
  landing: LandingResult | null;
}

export interface SymphonySnapshot {
  workflowPath: string;
  startedAt: number;
  updatedAt: number;
  lastPollAt: number | null;
  nextPollAt: number | null;
  tracker: {
    kind: string;
    projectSlug: string | null;
    target: string | null;
  };
  config: {
    pollIntervalMs: number;
    maxConcurrentAgents: number;
    workspaceRoot: string;
    serverPort: number | null;
  };
  running: RunningIssueSnapshot[];
  retryQueue: RetryEntrySnapshot[];
  completed: CompletedIssueSnapshot[];
  claimedIssueIds: string[];
  completedIssueIds: string[];
  lastError: string | null;
}

export interface Tracker {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Issue[]>;
  createComment(issueId: string, body: string): Promise<void>;
  updateIssueState(issueId: string, stateName: string): Promise<void>;
  ensurePullRequest?(
    input: {
      headBranch: string;
      baseBranch: string;
      title: string;
      body: string;
      draft: boolean;
    },
  ): Promise<PullRequestRef>;
  getPullRequestCiStatus?(
    input: {
      pullRequestNumber: number;
      commitSha: string;
      headBranch: string;
    },
  ): Promise<PullRequestCiStatus | null>;
  graphql?(query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>>;
}
