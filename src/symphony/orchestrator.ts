import { buildTurnSandboxPolicy } from "./config.js";
import { AgentRunner } from "./agent-runner.js";
import { GitHubIssueLander } from "./landing.js";
import { appendIssueLog, writeSnapshot } from "./paths.js";
import { notifyIssueBlocked, notifyIssueClaimed, notifyIssueReady, notifyRetryExhausted } from "./notifications.js";
import { WorkspaceManager } from "./workspace.js";
import type {
  AppServerUpdate,
  CompletedIssueSnapshot,
  CiRunRef,
  DynamicToolHandler,
  Issue,
  LandingResult,
  PullRequestCiStatus,
  RetryEntrySnapshot,
  RunnerHandle,
  RunningIssueSnapshot,
  SymphonyConfig,
  SymphonySnapshot,
  Tracker,
  WorkflowDefinition,
} from "./types.js";

const CI_FEEDBACK_WAIT_TIMEOUT_MS = 60_000;
const CI_FEEDBACK_POLL_INTERVAL_MS = 5_000;

// Bound shutdown so SIGINT/SIGTERM mid-turn can't block on turnTimeoutMs (1hr default)
// when the codex child fails to emit turn/completed after process-group SIGTERM.
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

function getShutdownTimeoutMs(): number {
  const raw = process.env.SYMPHONY_SHUTDOWN_TIMEOUT_MS;
  if (!raw) return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

interface RetryEntry {
  issue: Issue;
  attempt: number;
  dueAt: number;
  reason: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

interface RunningEntry {
  issue: Issue;
  attempt: number;
  startedAt: number;
  handle: RunnerHandle;
  workspacePath: string | null;
  threadId: string | null;
  turnId: string | null;
  lastEvent: string | null;
  lastMessage: string | null;
}

export class SymphonyOrchestrator {
  private readonly workspaceManager: WorkspaceManager;
  private readonly runner: AgentRunner;
  private readonly lander: GitHubIssueLander | null;
  private running = new Map<string, RunningEntry>();
  private claimed = new Set<string>();
  private completed = new Set<string>();
  private completedRuns: CompletedIssueSnapshot[] = [];
  private retries = new Map<string, RetryEntry>();
  private blocked = new Map<string, string>();
  private externallyStopped = new Set<string>();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = Date.now();
  private lastPollAt: number | null = null;
  private nextPollAt: number | null = null;
  private lastError: string | null = null;
  private shuttingDown = false;

  constructor(
    private readonly definition: WorkflowDefinition,
    private readonly config: SymphonyConfig,
    private readonly tracker: Tracker,
    dynamicTools: DynamicToolHandler,
    deps: { lander?: GitHubIssueLander | null } = {},
  ) {
    this.workspaceManager = new WorkspaceManager(config);
    this.runner = new AgentRunner(definition, config, tracker, dynamicTools, this.workspaceManager);
    this.lander = deps.lander === undefined ? createIssueLander(config, tracker) : deps.lander;
  }

  async start(): Promise<void> {
    this.shuttingDown = false;
    await this.cleanupTerminalIssueWorkspaces();
    await this.poll();
    this.scheduleNextTick();
  }

  async runOnce(): Promise<void> {
    await this.cleanupTerminalIssueWorkspaces();
    await this.poll();
    await Promise.all(Array.from(this.running.values(), (entry) => entry.handle.promise.catch(() => null)));
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    for (const entry of this.retries.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
    }
    this.retries.clear();
    const pending: Array<{ identifier: string; entry: RunningEntry; settled: boolean }> = [];
    const promises: Promise<unknown>[] = [];
    for (const entry of this.running.values()) {
      entry.handle.stop("orchestrator shutdown");
      const item = { identifier: entry.issue.identifier, entry, settled: false };
      pending.push(item);
      promises.push(entry.handle.promise.catch(() => null).finally(() => {
        item.settled = true;
      }));
    }

    // Await runners so codex children finish tearing down before we exit, but
    // bound the wait: if codex doesn't emit turn/completed after SIGTERM, the
    // runner promise can otherwise block on turnTimeoutMs (1hr default).
    const timeoutMs = getShutdownTimeoutMs();
    const TIMED_OUT = Symbol("shutdown-timeout");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });

    const all = Promise.all(promises).then(() => "ok" as const);
    const outcome = await Promise.race([all, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (outcome === TIMED_OUT) {
      const stragglers = pending.filter((item) => !item.settled);
      console.warn(
        `[symphony] shutdown timed out after ${timeoutMs}ms; force-killing runners:`,
        stragglers.map((item) => item.identifier),
      );
      for (const item of stragglers) {
        item.entry.handle.forceKill?.("orchestrator shutdown timeout");
      }
    }

    this.running.clear();
  }

  snapshot(): SymphonySnapshot {
    return {
      workflowPath: this.definition.path,
      startedAt: this.startedAt,
      updatedAt: Date.now(),
      lastPollAt: this.lastPollAt,
      nextPollAt: this.nextPollAt,
      tracker: {
        kind: this.config.tracker.kind,
        projectSlug: this.config.tracker.projectSlug,
        target: this.config.tracker.repo || this.config.tracker.projectSlug,
      },
      config: {
        pollIntervalMs: this.config.polling.intervalMs,
        maxConcurrentAgents: this.config.agent.maxConcurrentAgents,
        workspaceRoot: this.config.workspace.root,
        serverPort: this.config.server.port,
      },
      running: Array.from(this.running.values()).map((entry): RunningIssueSnapshot => ({
        issueId: entry.issue.id,
        identifier: entry.issue.identifier,
        title: entry.issue.title,
        state: entry.issue.state,
        attempt: entry.attempt,
        workspacePath: entry.workspacePath || "",
        startedAt: entry.startedAt,
        threadId: entry.threadId,
        turnId: entry.turnId,
        lastEvent: entry.lastEvent,
        lastMessage: entry.lastMessage,
      })),
      retryQueue: Array.from(this.retries.values()).map((entry): RetryEntrySnapshot => ({
        issueId: entry.issue.id,
        identifier: entry.issue.identifier,
        attempt: entry.attempt,
        dueAt: entry.dueAt,
        reason: entry.reason,
      })),
      completed: this.completedRuns,
      claimedIssueIds: Array.from(this.claimed.values()),
      completedIssueIds: Array.from(this.completed.values()),
      lastError: this.lastError,
    };
  }

  private scheduleNextTick(): void {
    if (this.shuttingDown) return;
    this.nextPollAt = Date.now() + this.config.polling.intervalMs;
    this.tickTimer = setTimeout(async () => {
      await this.poll();
      this.scheduleNextTick();
    }, this.config.polling.intervalMs);
    this.persistSnapshot();
  }

  private async poll(): Promise<void> {
    if (this.shuttingDown) return;
    this.lastPollAt = Date.now();
    this.lastError = null;
    try {
      await this.reconcileRunningIssues();
      const candidates = await this.tracker.fetchCandidateIssues();
      const activeCandidates = candidates.filter((issue) => isActiveState(issue.state, this.config));
      const blockedNow = new Set<string>();

      for (const issue of activeCandidates) {
        const blockedReason = getBlockingReason(issue, this.config);
        if (!blockedReason) {
          this.blocked.delete(issue.id);
          continue;
        }

        blockedNow.add(issue.id);
        await this.reportBlockedIssue(issue, blockedReason);
      }

      for (const blockedIssueId of Array.from(this.blocked.keys())) {
        if (!blockedNow.has(blockedIssueId)) {
          this.blocked.delete(blockedIssueId);
        }
      }

      const availableSlots = this.config.agent.maxConcurrentAgents - this.running.size;
      if (availableSlots <= 0) {
        this.persistSnapshot();
        return;
      }

      const nextIssues = candidates
        .filter((issue) => !this.claimed.has(issue.id))
        .filter((issue) => isActiveState(issue.state, this.config))
        .filter((issue) => !getBlockingReason(issue, this.config))
        .sort(compareIssues)
        .slice(0, availableSlots);

      for (const issue of nextIssues) {
        await this.dispatchIssue(issue, 0);
      }
    } catch (err: any) {
      this.lastError = err.message;
      console.error("[symphony] Poll failed:", err.message);
    }

    this.persistSnapshot();
  }

  private async dispatchIssue(issue: Issue, attempt: number): Promise<void> {
    this.claimed.add(issue.id);
    this.blocked.delete(issue.id);
    appendIssueLog(issue.identifier, `[claim] attempt=${attempt}`);
    await notifyIssueClaimed(issue);
    if (attempt === 0) {
      await this.safeCreateComment(issue, buildClaimComment(issue));
    }

    const handle = this.runner.run(issue, attempt, (update) => {
      const running = this.running.get(issue.id);
      if (!running) return;
      running.lastEvent = update.type;
      if (update.text) {
        running.lastMessage = update.text;
      }
      if (update.threadId) running.threadId = update.threadId;
      if (update.turnId) running.turnId = update.turnId;
      this.persistSnapshot();
    });

    this.running.set(issue.id, {
      issue,
      attempt,
      startedAt: Date.now(),
      handle,
      workspacePath: null,
      threadId: null,
      turnId: null,
      lastEvent: "claimed",
      lastMessage: null,
    });
    this.persistSnapshot();

    handle.promise
      .then(async (result) => {
        if (this.shuttingDown || this.externallyStopped.delete(issue.id)) {
          this.running.delete(issue.id);
          this.claimed.delete(issue.id);
          this.persistSnapshot();
          return;
        }

        const running = this.running.get(issue.id);
        this.running.delete(issue.id);

        if (result.status === "completed") {
          this.completed.add(issue.id);
          this.claimed.delete(issue.id);
          appendIssueLog(issue.identifier, `[complete] ${result.issue.state}`);
          let landing: LandingResult | null = null;
          if (!isActiveState(result.issue.state, this.config)) {
            landing = await this.tryLandResult(result.issue, result.workspacePath, result.lastAgentMessage);
            await notifyIssueReady(result.issue);
            if (!isTerminalState(result.issue.state, this.config)) {
              await this.safeCreateComment(
                result.issue,
                buildReadyComment(result.issue, result.lastAgentMessage, landing),
              );
            }
            landing = await this.attachCiFeedback(result.issue, landing);
          }
          this.recordCompletedRun(result.issue, result.lastAgentMessage, landing);
          if (isTerminalState(result.issue.state, this.config)) {
            await this.workspaceManager.removeIssueWorkspace(result.issue.identifier);
          }
          this.persistSnapshot();
          return;
        }

        if (result.status === "needs_retry") {
          this.scheduleRetry(issue, attempt + 1, result.reason || "continuation requested");
          this.persistSnapshot();
          return;
        }

        if (result.status === "failed") {
          const nextAttempt = attempt + 1;
          if (nextAttempt > 5) {
            this.claimed.delete(issue.id);
            await notifyRetryExhausted(issue, result.reason || "failed");
            await this.safeCreateComment(issue, buildRetryExhaustedComment(result.reason || "failed"));
          } else {
            this.scheduleRetry(issue, nextAttempt, result.reason || "failed");
          }
          this.persistSnapshot();
          return;
        }

        this.claimed.delete(issue.id);
        this.persistSnapshot();
      })
      .catch(async (err: any) => {
        if (this.shuttingDown || this.externallyStopped.delete(issue.id)) {
          this.running.delete(issue.id);
          this.claimed.delete(issue.id);
          this.persistSnapshot();
          return;
        }
        this.running.delete(issue.id);
        this.scheduleRetry(issue, attempt + 1, err.message);
        this.persistSnapshot();
      });
  }

  private scheduleRetry(issue: Issue, attempt: number, reason: string): void {
    const delay = Math.min(10_000 * Math.max(attempt, 1), this.config.agent.maxRetryBackoffMs);
    const dueAt = Date.now() + delay;
    appendIssueLog(issue.identifier, `[retry] attempt=${attempt} delay=${delay}ms reason=${reason}`);

    const timer = setTimeout(async () => {
      if (this.shuttingDown) {
        this.retries.delete(issue.id);
        return;
      }
      this.retries.delete(issue.id);
      try {
        const refreshed = await this.tracker.fetchIssueStatesByIds([issue.id]);
        const nextIssue = refreshed[0] || issue;
        if (!isActiveState(nextIssue.state, this.config)) {
          this.claimed.delete(issue.id);
          if (isTerminalState(nextIssue.state, this.config)) {
            await this.workspaceManager.removeIssueWorkspace(nextIssue.identifier);
          }
          this.persistSnapshot();
          return;
        }
        await this.dispatchIssue(nextIssue, attempt);
      } catch (err: any) {
        this.claimed.delete(issue.id);
        this.lastError = err.message;
        await notifyRetryExhausted(issue, err.message);
        this.persistSnapshot();
      }
    }, delay);

    this.retries.set(issue.id, { issue, attempt, dueAt, reason, timer });
  }

  private async reconcileRunningIssues(): Promise<void> {
    const ids = Array.from(this.running.keys());
    if (ids.length === 0) return;

    const refreshed = await this.tracker.fetchIssueStatesByIds(ids);
    const byId = new Map(refreshed.map((issue) => [issue.id, issue]));

    for (const [issueId, entry] of this.running) {
      const current = byId.get(issueId);
      if (!current) continue;

      entry.issue = current;
      const blockedReason = getBlockingReason(current, this.config);
      if (blockedReason) {
        this.externallyStopped.add(issueId);
        entry.handle.stop(`issue blocked: ${blockedReason}`);
        this.running.delete(issueId);
        this.claimed.delete(issueId);
        await this.reportBlockedIssue(current, blockedReason);
        continue;
      }

      if (!isActiveState(current.state, this.config)) {
        this.externallyStopped.add(issueId);
        entry.handle.stop(`issue moved to ${current.state}`);
        this.running.delete(issueId);
        this.claimed.delete(issueId);
        if (isTerminalState(current.state, this.config)) {
          await this.workspaceManager.removeIssueWorkspace(current.identifier);
        }
      }
    }
  }

  private async cleanupTerminalIssueWorkspaces(): Promise<void> {
    try {
      const terminalIssues = await this.tracker.fetchIssuesByStates(this.config.tracker.terminalStates);
      for (const issue of terminalIssues) {
        await this.workspaceManager.removeIssueWorkspace(issue.identifier);
      }
    } catch (err: any) {
      console.warn("[symphony] Terminal workspace cleanup skipped:", err.message);
    }
  }

  private persistSnapshot(): void {
    writeSnapshot(this.snapshot());
  }

  private async reportBlockedIssue(issue: Issue, reason: string): Promise<void> {
    if (this.blocked.get(issue.id) === reason) {
      return;
    }

    this.blocked.set(issue.id, reason);
    appendIssueLog(issue.identifier, `[blocked] ${reason}`);
    await notifyIssueBlocked(issue, reason);
    await this.safeCreateComment(issue, buildBlockedComment(reason));
  }

  private async safeCreateComment(issue: Issue, body: string): Promise<void> {
    try {
      await this.tracker.createComment(issue.id, body);
    } catch (err: any) {
      appendIssueLog(issue.identifier, `[tracker-comment-failed] ${err.message}`);
    }
  }

  private async tryLandResult(
    issue: Issue,
    workspacePath: string,
    lastAgentMessage: string | null,
  ): Promise<LandingResult | null> {
    if (!this.lander?.shouldLand(issue)) {
      return null;
    }

    try {
      return await this.lander.land(issue, workspacePath, lastAgentMessage);
    } catch (err: any) {
      appendIssueLog(issue.identifier, `[landing-failed] ${err.message}`);
      return {
        status: "skipped",
        branchName: null,
        commitSha: null,
        pullRequest: null,
        reason: `automatic landing failed: ${err.message}`,
        ci: null,
      };
    }
  }

  private async attachCiFeedback(issue: Issue, landing: LandingResult | null): Promise<LandingResult | null> {
    if (!landing?.pullRequest || !landing.commitSha || !this.tracker.getPullRequestCiStatus) {
      return landing;
    }

    const deadline = Date.now() + CI_FEEDBACK_WAIT_TIMEOUT_MS;
    let lastStatus: PullRequestCiStatus | null = null;

    while (Date.now() < deadline) {
      const status = await this.tracker.getPullRequestCiStatus({
        pullRequestNumber: landing.pullRequest.number,
        commitSha: landing.commitSha,
        headBranch: landing.pullRequest.headBranch,
      });

      if (status) {
        lastStatus = status;
        if (status.completed) {
          break;
        }
      }

      await sleep(CI_FEEDBACK_POLL_INTERVAL_MS);
    }

    const ciStatus = lastStatus || {
      state: "pending",
      completed: false,
      summary: "CI is still running or no workflow runs were reported within the wait window.",
      runs: [] as CiRunRef[],
    };

    landing.ci = ciStatus;
    appendIssueLog(issue.identifier, `[ci] ${ciStatus.state} ${ciStatus.summary}`);
    await this.safeCreateComment(issue, buildCiFeedbackComment(landing.pullRequest.url, ciStatus));
    return landing;
  }

  private recordCompletedRun(issue: Issue, lastMessage: string | null, landing: LandingResult | null): void {
    const nextEntry: CompletedIssueSnapshot = {
      issueId: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      state: issue.state,
      finishedAt: Date.now(),
      lastMessage,
      landing,
    };

    this.completedRuns = [
      nextEntry,
      ...this.completedRuns.filter((entry) => entry.issueId !== issue.id),
    ].slice(0, 10);
  }
}

function compareIssues(a: Issue, b: Issue): number {
  const aPriority = a.priority ?? 999;
  const bPriority = b.priority ?? 999;
  if (aPriority !== bPriority) return aPriority - bPriority;
  return (a.updatedAt || "").localeCompare(b.updatedAt || "");
}

function isActiveState(state: string, config: SymphonyConfig): boolean {
  return config.tracker.activeStates.some((entry) => entry.trim().toLowerCase() === state.trim().toLowerCase());
}

function isTerminalState(state: string, config: SymphonyConfig): boolean {
  return config.tracker.terminalStates.some((entry) => entry.trim().toLowerCase() === state.trim().toLowerCase());
}

export function getBlockingReason(issue: Issue, config: SymphonyConfig): string | null {
  const terminal = new Set(config.tracker.terminalStates.map((state) => state.trim().toLowerCase()));
  const blocker = issue.blockedBy.find((entry) => entry.state && !terminal.has(entry.state.trim().toLowerCase()));
  if (!blocker) return null;

  const parts = [
    blocker.identifier || blocker.id || "an upstream issue",
    blocker.state ? `(${blocker.state})` : null,
  ].filter(Boolean);
  return `Blocked by ${parts.join(" ")}.`;
}

export function buildClaimComment(issue: Issue): string {
  return [
    "Symphony claimed this issue and started an automated work run.",
    issue.url ? `Issue URL: ${issue.url}` : null,
  ].filter(Boolean).join("\n\n");
}

export function buildBlockedComment(reason: string): string {
  return [
    "Symphony skipped this run because the issue is currently blocked.",
    `Reason: ${reason}`,
  ].join("\n\n");
}

export function buildReadyComment(
  issue: Issue,
  lastAgentMessage: string | null,
  landing: LandingResult | null = null,
): string {
  return [
    `Symphony completed its current run and the issue is now in \`${issue.state}\`.`,
    landing ? formatLandingSummary(landing) : null,
    lastAgentMessage ? `Latest agent summary:\n\n${truncateText(lastAgentMessage, 1500)}` : null,
  ].filter(Boolean).join("\n\n");
}

export function buildRetryExhaustedComment(reason: string): string {
  return [
    "Symphony exhausted its retry budget for this issue.",
    `Latest failure: ${truncateText(reason, 1500)}`,
  ].join("\n\n");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatLandingSummary(landing: LandingResult): string {
  if (landing.pullRequest) {
    return [
      `Landing status: ${landing.status}.`,
      `Branch: \`${landing.branchName}\``,
      `Pull request: ${landing.pullRequest.url}`,
      landing.commitSha ? `Commit: \`${landing.commitSha.slice(0, 12)}\`` : null,
    ].filter(Boolean).join("\n");
  }

  return [
    "Landing status: skipped.",
    landing.reason ? `Reason: ${landing.reason}` : null,
  ].filter(Boolean).join("\n");
}

export function buildCiFeedbackComment(pullRequestUrl: string, status: PullRequestCiStatus): string {
  const lines = [
    `CI update for draft PR ${pullRequestUrl}`,
    "",
    `CI status: ${formatCiState(status.state)}.`,
    status.summary,
  ];

  const runs = status.state === "failure"
    ? status.runs.filter((run) => !isSuccessfulCiRun(run))
    : status.runs;

  if (runs.length > 0) {
    lines.push("");
    lines.push(status.state === "failure" ? "Relevant workflow runs:" : "Workflow runs:");
    for (const run of runs.slice(0, 5)) {
      lines.push(`- ${formatCiRun(run)}`);
    }
  }

  if (status.state === "failure") {
    lines.push("");
    lines.push("Symphony did not auto-requeue this issue.");
    lines.push("If you want another implementation pass, move the issue to `symphony:rework` with concrete feedback.");
  }

  return lines.join("\n");
}

function formatCiState(state: PullRequestCiStatus["state"]): string {
  switch (state) {
    case "success":
      return "passed";
    case "failure":
      return "failed";
    default:
      return "still running";
  }
}

function formatCiRun(run: CiRunRef): string {
  const label = run.workflowName && run.workflowName !== run.name
    ? `${run.workflowName} / ${run.name}`
    : run.name;
  const status = run.conclusion || run.status;
  return run.url ? `${label}: ${status} (${run.url})` : `${label}: ${status}`;
}

function isSuccessfulCiRun(run: CiRunRef): boolean {
  const normalized = (run.conclusion || "").trim().toLowerCase();
  return normalized === "success" || normalized === "neutral" || normalized === "skipped";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createIssueLander(config: SymphonyConfig, tracker: Tracker): GitHubIssueLander | null {
  if (!config.landing.enabled || config.tracker.kind !== "github" || !tracker.ensurePullRequest) {
    return null;
  }
  return new GitHubIssueLander(config, tracker);
}
