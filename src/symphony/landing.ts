import { execFile } from "child_process";
import { existsSync } from "fs";
import * as path from "path";
import { promisify } from "util";
import { appendIssueLog, sanitizeIssueKey } from "./paths.js";
import { renderTemplateString } from "./workflow.js";
import type { Issue, LandingResult, SymphonyConfig, Tracker } from "./types.js";

const execFileAsync = promisify(execFile);

type GitRunner = (args: string[], cwd: string, env?: Record<string, string>) => Promise<string>;

export class GitHubIssueLander {
  constructor(
    private readonly config: SymphonyConfig,
    private readonly tracker: Tracker,
    private readonly runGit: GitRunner = runGitCommand,
  ) {}

  shouldLand(issue: Issue): boolean {
    return this.config.landing.enabled
      && this.config.tracker.kind === "github"
      && !!this.tracker.ensurePullRequest
      && !!this.config.landing.triggerState
      && issue.state.trim().toLowerCase() === this.config.landing.triggerState.trim().toLowerCase();
  }

  async land(issue: Issue, workspacePath: string, lastAgentMessage: string | null): Promise<LandingResult> {
    if (!existsSync(path.join(workspacePath, ".git"))) {
      return {
        status: "skipped",
        branchName: null,
        commitSha: null,
        pullRequest: null,
        reason: "workspace is not a git checkout",
      };
    }

    const porcelain = await this.git(["status", "--porcelain"], workspacePath);
    if (!porcelain.trim()) {
      appendIssueLog(issue.identifier, "[landing] skipped no_changes");
      return {
        status: "skipped",
        branchName: null,
        commitSha: null,
        pullRequest: null,
        reason: "no workspace changes detected",
      };
    }

    const branchName = buildBranchName(this.config.landing.branchPrefix, issue);
    const baseBranch = this.config.landing.baseBranch || await detectBaseBranch(workspacePath);
    const templateContext = {
      issue,
      landing: {
        branch_name: branchName,
        base_branch: baseBranch,
      },
      last_agent_message: lastAgentMessage,
    };
    const commitMessage = (await renderTemplateString(this.config.landing.commitMessageTemplate, templateContext)).trim();
    const pullRequestTitle = (await renderTemplateString(this.config.landing.pullRequestTitleTemplate, templateContext)).trim();
    const pullRequestBody = (await renderTemplateString(this.config.landing.pullRequestBodyTemplate, templateContext)).trim();

    await this.git(["checkout", "-B", branchName], workspacePath);
    await this.git(["add", "-A"], workspacePath);
    await this.git(["commit", "-m", commitMessage], workspacePath, {
      GIT_AUTHOR_NAME: this.config.landing.authorName,
      GIT_AUTHOR_EMAIL: this.config.landing.authorEmail,
      GIT_COMMITTER_NAME: this.config.landing.authorName,
      GIT_COMMITTER_EMAIL: this.config.landing.authorEmail,
    });

    const commitSha = (await this.git(["rev-parse", "HEAD"], workspacePath)).trim();
    await this.ensurePushRemote(issue.identifier, workspacePath);
    await this.git(["push", "--force-with-lease", "--set-upstream", "origin", branchName], workspacePath);

    const pullRequest = await this.tracker.ensurePullRequest!({
      headBranch: branchName,
      baseBranch,
      title: pullRequestTitle,
      body: pullRequestBody,
      draft: this.config.landing.draft,
    });

    const status = pullRequest.existed ? "updated" : "created";
    appendIssueLog(
      issue.identifier,
      `[landing] ${status} branch=${branchName} pr=#${pullRequest.number} ${pullRequest.url}`,
    );
    return {
      status,
      branchName,
      commitSha,
      pullRequest,
      reason: null,
    };
  }

  private async git(
    args: string[],
    cwd: string,
    env: Record<string, string> = {},
  ): Promise<string> {
    return this.runGit(args, cwd, env);
  }

  private async ensurePushRemote(issueIdentifier: string, workspacePath: string): Promise<void> {
    const currentOrigin = (await this.git(["remote", "get-url", "origin"], workspacePath)).trim();
    const pushOrigin = await resolvePushRemoteUrl(this.config, currentOrigin);
    if (!pushOrigin || pushOrigin === currentOrigin) {
      return;
    }

    await this.git(["remote", "set-url", "origin", pushOrigin], workspacePath);
    appendIssueLog(issueIdentifier, `[landing] set origin to ${pushOrigin}`);
  }
}

async function detectBaseBranch(workspacePath: string): Promise<string> {
  try {
    const result = await execFileAsync("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
      cwd: workspacePath,
    });
    return result.stdout.trim().replace(/^origin\//, "") || "main";
  } catch {
    try {
      const result = await execFileAsync("git", ["branch", "--show-current"], {
        cwd: workspacePath,
      });
      return result.stdout.trim() || "main";
    } catch {
      return "main";
    }
  }
}

async function resolvePushRemoteUrl(config: SymphonyConfig, currentOrigin: string): Promise<string | null> {
  if (!looksLikeLocalGitRemote(currentOrigin)) {
    return currentOrigin;
  }

  const sourceRepo = process.env.SYMPHONY_SOURCE_REPO || process.cwd();
  try {
    const result = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: sourceRepo,
    });
    const sourceOrigin = result.stdout.trim();
    if (sourceOrigin) {
      return sourceOrigin;
    }
  } catch {
    // Fall through to tracker-derived SSH URL.
  }

  return config.tracker.repo ? `git@github.com:${config.tracker.repo}.git` : null;
}

function looksLikeLocalGitRemote(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("file://");
}

function buildBranchName(prefix: string, issue: Issue): string {
  const identifierPart = sanitizeIssueKey(issue.identifier.replace(/^#/, "issue-")).toLowerCase();
  const titleSlug = sanitizeIssueKey(issue.title)
    .toLowerCase()
    .replace(/_+/g, "-")
    .replace(/\.+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const suffix = titleSlug ? `-${titleSlug}` : "";
  return `${prefix}${identifierPart}${suffix}`.slice(0, 120);
}

async function runGitCommand(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<string> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      env: { ...process.env, ...env },
    });
    return [result.stdout, result.stderr].filter(Boolean).join("");
  } catch (err: any) {
    const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail || "unknown error"}`);
  }
}
