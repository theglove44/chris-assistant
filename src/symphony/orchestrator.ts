import { buildTurnSandboxPolicy } from "./config.js";
import { AgentRunner } from "./agent-runner.js";
import { appendIssueLog, writeSnapshot } from "./paths.js";
import { notifyIssueBlocked, notifyIssueClaimed, notifyIssueReady, notifyRetryExhausted } from "./notifications.js";
import { WorkspaceManager } from "./workspace.js";
import type {
  AppServerUpdate,
  DynamicToolHandler,
  Issue,
  RetryEntrySnapshot,
  RunnerHandle,
  RunningIssueSnapshot,
  SymphonyConfig,
  SymphonySnapshot,
  Tracker,
  WorkflowDefinition,
} from "./types.js";

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
  private running = new Map<string, RunningEntry>();
  private claimed = new Set<string>();
  private completed = new Set<string>();
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
  ) {
    this.workspaceManager = new WorkspaceManager(config);
    this.runner = new AgentRunner(definition, config, tracker, dynamicTools, this.workspaceManager);
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
    for (const entry of this.running.values()) {
      entry.handle.stop("orchestrator shutdown");
    }
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
          if (!isActiveState(result.issue.state, this.config)) {
            await notifyIssueReady(result.issue);
            if (!isTerminalState(result.issue.state, this.config)) {
              await this.safeCreateComment(
                result.issue,
                buildReadyComment(result.issue, result.lastAgentMessage),
              );
            }
          }
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

export function buildReadyComment(issue: Issue, lastAgentMessage: string | null): string {
  return [
    `Symphony completed its current run and the issue is now in \`${issue.state}\`.`,
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
