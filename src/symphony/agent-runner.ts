import { buildTurnSandboxPolicy } from "./config.js";
import { CodexAppServerSession } from "./codex/app-server.js";
import { appendIssueLog } from "./paths.js";
import { renderWorkflowPrompt } from "./workflow.js";
import { WorkspaceManager } from "./workspace.js";
import type {
  AppServerUpdate,
  DynamicToolHandler,
  Issue,
  IssueRunResult,
  RunnerHandle,
  SymphonyConfig,
  Tracker,
  WorkflowDefinition,
} from "./types.js";

export class AgentRunner {
  constructor(
    private readonly definition: WorkflowDefinition,
    private readonly config: SymphonyConfig,
    private readonly tracker: Tracker,
    private readonly dynamicTools: DynamicToolHandler,
    private readonly workspaceManager: WorkspaceManager,
  ) {}

  run(issue: Issue, attempt: number, onUpdate?: (update: AppServerUpdate) => void): RunnerHandle {
    const sessionHolder: { stop?: () => void; forceKill?: () => void } = {};

    const promise = (async (): Promise<IssueRunResult> => {
      const workspace = await this.workspaceManager.createForIssue(issue);
      await this.workspaceManager.runBeforeRunHook(workspace.path, issue);

      let lastAgentMessage: string | null = null;
      let threadId: string | null = null;
      let turnId: string | null = null;

      try {
        const session = new CodexAppServerSession(
          this.config,
          workspace.path,
          issue,
          this.dynamicTools,
          (update) => {
            if (update.text) {
              lastAgentMessage = update.text;
            }
            if (update.threadId) threadId = update.threadId;
            if (update.turnId) turnId = update.turnId;
            onUpdate?.(update);
          },
        );

        sessionHolder.stop = () => session.stop();
        sessionHolder.forceKill = () => session.forceKill();
        const meta = await session.start();
        threadId = meta.threadId;

        for (let turnNumber = 1; turnNumber <= this.config.agent.maxTurns; turnNumber++) {
          const prompt = turnNumber === 1
            ? await renderWorkflowPrompt(this.definition, { attempt, issue })
            : continuationPrompt(turnNumber, this.config.agent.maxTurns);
          const result = await session.runTurn(prompt);
          turnId = result.turnId;
          lastAgentMessage = result.lastAgentMessage;

          const refreshed = await this.tracker.fetchIssueStatesByIds([issue.id]);
          const nextIssue = refreshed[0] || issue;
          if (!isActiveState(nextIssue.state, this.config)) {
            return {
              status: "completed",
              issue: nextIssue,
              workspacePath: workspace.path,
              lastAgentMessage,
              threadId,
              turnId,
            };
          }
        }

        return {
          status: "needs_retry",
          issue,
          workspacePath: workspace.path,
          lastAgentMessage,
          threadId,
          turnId,
          reason: "max_turns_reached",
        };
      } catch (err: any) {
        appendIssueLog(issue.identifier, `[runner-error] ${err.message}`);
        return {
          status: "failed",
          issue,
          workspacePath: workspace.path,
          lastAgentMessage,
          threadId,
          turnId,
          reason: err.message,
        };
      } finally {
        await this.workspaceManager.runAfterRunHook(workspace.path, issue);
      }
    })();

    return {
      promise,
      stop(reason?: string) {
        appendIssueLog(issue.identifier, `[runner-stop] ${reason || "stop requested"}`);
        sessionHolder.stop?.();
      },
      forceKill(reason?: string) {
        appendIssueLog(issue.identifier, `[runner-force-kill] ${reason || "force kill requested"}`);
        sessionHolder.forceKill?.();
      },
    };
  }
}

function continuationPrompt(turnNumber: number, maxTurns: number): string {
  return [
    "Continuation guidance:",
    "",
    "- The previous Codex turn completed normally, but the issue is still active.",
    `- This is continuation turn ${turnNumber} of ${maxTurns}.`,
    "- Resume from the current workspace state rather than restarting.",
    "- Focus on remaining ticket work and move the ticket toward the workflow handoff state.",
  ].join("\n");
}

function isActiveState(state: string, config: SymphonyConfig): boolean {
  return config.tracker.activeStates.some((entry) => entry.trim().toLowerCase() === state.trim().toLowerCase());
}
