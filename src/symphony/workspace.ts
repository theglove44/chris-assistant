import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { buildLandingBranchName } from "./landing.js";
import { sanitizeIssueKey } from "./paths.js";
import type { Issue, SymphonyConfig, WorkspaceInfo } from "./types.js";

const execFileAsync = promisify(execFile);

export class WorkspaceManager {
  constructor(private readonly config: SymphonyConfig) {}

  async createForIssue(issue: Issue): Promise<WorkspaceInfo> {
    const key = sanitizeIssueKey(issue.identifier);
    const workspacePath = path.join(this.config.workspace.root, key);
    this.validateWorkspacePath(workspacePath);

    const createdNow = !fs.existsSync(workspacePath);
    if (createdNow) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      fs.mkdirSync(workspacePath, { recursive: true });
    } else {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    if (createdNow && this.config.hooks.afterCreate) {
      await this.runHook("after_create", this.config.hooks.afterCreate, workspacePath, issue);
    }

    if (!createdNow) {
      await this.reconcileExistingWorkspace(workspacePath, issue);
    }

    return { path: workspacePath, key, createdNow };
  }

  async runBeforeRunHook(workspacePath: string, issue: Issue): Promise<void> {
    if (!this.config.hooks.beforeRun) return;
    await this.runHook("before_run", this.config.hooks.beforeRun, workspacePath, issue);
  }

  async runAfterRunHook(workspacePath: string, issue: Issue): Promise<void> {
    if (!this.config.hooks.afterRun) return;
    try {
      await this.runHook("after_run", this.config.hooks.afterRun, workspacePath, issue);
    } catch {
      // Best effort.
    }
  }

  async removeIssueWorkspace(identifier: string): Promise<void> {
    const workspacePath = path.join(this.config.workspace.root, sanitizeIssueKey(identifier));
    this.validateWorkspacePath(workspacePath);

    if (fs.existsSync(workspacePath) && this.config.hooks.beforeRemove) {
      try {
        await this.runHook("before_remove", this.config.hooks.beforeRemove, workspacePath, {
          id: "",
          identifier,
          title: identifier,
          description: null,
          priority: null,
          state: "",
          branchName: null,
          url: null,
          labels: [],
          blockedBy: [],
          assigneeId: null,
          assignedToWorker: false,
          createdAt: null,
          updatedAt: null,
        });
      } catch {
        // Best effort.
      }
    }

    fs.rmSync(workspacePath, { recursive: true, force: true });
  }

  validateWorkspacePath(workspacePath: string): void {
    const root = path.resolve(this.config.workspace.root);
    const target = path.resolve(workspacePath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Workspace path escapes workspace root: ${target}`);
    }
  }

  private async runHook(name: string, command: string, workspacePath: string, issue: Issue): Promise<void> {
    await execFileAsync("sh", ["-lc", command], {
      cwd: workspacePath,
      timeout: this.config.hooks.timeoutMs,
      env: {
        ...process.env,
        SYMPHONY_WORKSPACE: workspacePath,
        SYMPHONY_ISSUE_ID: issue.id,
        SYMPHONY_ISSUE_IDENTIFIER: issue.identifier,
        SYMPHONY_ISSUE_TITLE: issue.title,
      },
    }).catch((err: any) => {
      throw new Error(`Workspace hook ${name} failed: ${err.message}`);
    });
  }

  private async reconcileExistingWorkspace(workspacePath: string, issue: Issue): Promise<void> {
    if (!this.shouldReconcileReworkWorkspace(issue)) {
      return;
    }

    if (!fs.existsSync(path.join(workspacePath, ".git"))) {
      return;
    }

    const issueBranch = buildLandingBranchName(this.config.landing.branchPrefix, issue);
    const baseBranch = this.config.landing.baseBranch || "main";

    await this.git(["fetch", "--prune", "origin"], workspacePath);
    await this.git(["reset", "--hard", "HEAD"], workspacePath);
    await this.git(["clean", "-fd"], workspacePath);

    if (await this.hasRemoteBranch(workspacePath, issueBranch)) {
      await this.git(["checkout", "-B", issueBranch, `origin/${issueBranch}`], workspacePath);
      await this.git(["reset", "--hard", `origin/${issueBranch}`], workspacePath);
      await this.git(["clean", "-fd"], workspacePath);
      return;
    }

    if (await this.hasRemoteBranch(workspacePath, baseBranch)) {
      await this.git(["checkout", "-B", baseBranch, `origin/${baseBranch}`], workspacePath);
      await this.git(["reset", "--hard", `origin/${baseBranch}`], workspacePath);
      await this.git(["clean", "-fd"], workspacePath);
    }
  }

  private shouldReconcileReworkWorkspace(issue: Issue): boolean {
    return this.config.tracker.kind === "github"
      && this.config.landing.enabled
      && issue.state.trim().toLowerCase().endsWith(":rework");
  }

  private async hasRemoteBranch(workspacePath: string, branchName: string): Promise<boolean> {
    try {
      await this.git(["rev-parse", "--verify", `origin/${branchName}`], workspacePath);
      return true;
    } catch {
      return false;
    }
  }

  private async git(args: string[], workspacePath: string): Promise<void> {
    await execFileAsync("git", args, {
      cwd: workspacePath,
    }).catch((err: any) => {
      const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").trim();
      throw new Error(`Workspace git reconcile failed (${args.join(" ")}): ${detail || "unknown error"}`);
    });
  }
}
