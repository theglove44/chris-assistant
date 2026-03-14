import { Command } from "commander";
import { execFileSync, execSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { config as appConfig } from "../../config.js";
import { getCodexStatus } from "../../codex.js";
import { buildSymphonyConfig } from "../../symphony/config.js";
import { readIssueLog, readSnapshot, sanitizeIssueKey } from "../../symphony/paths.js";
import { createTracker } from "../../symphony/runtime.js";
import { loadWorkflow } from "../../symphony/workflow.js";
import {
  getProcess,
  PROJECT_ROOT,
  SYMPHONY_PM2_NAME,
  SYMPHONY_SCRIPT,
  TSX_BIN,
  withPm2,
} from "../pm2-helper.js";

function formatUptime(startMs: number | undefined): string {
  if (!startMs) return "unknown";
  const seconds = Math.floor((Date.now() - startMs) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const WARN = "\x1b[33m!\x1b[0m";

interface DoctorCheck {
  name: string;
  run: () => Promise<"pass" | "fail" | "warn">;
}

export function registerSymphonyCommand(program: Command) {
  const symphony = program
    .command("symphony")
    .description("Manage the Symphony sidecar orchestrator");

  symphony
    .command("doctor [workflow]")
    .description("Validate the Symphony workflow, worker runtime, and tracker access")
    .action(async (workflow?: string) => {
      const workflowPath = workflow ? path.resolve(workflow) : path.join(PROJECT_ROOT, "WORKFLOW.md");

      if (!fs.existsSync(workflowPath)) {
        console.log(`${FAIL} workflow file not found: ${workflowPath}`);
        process.exitCode = 1;
        return;
      }

      let config;
      let definition;
      try {
        definition = loadWorkflow(workflowPath);
        config = buildSymphonyConfig(definition);
      } catch (err: any) {
        console.log(`${FAIL} invalid workflow: ${err.message}`);
        process.exitCode = 1;
        return;
      }

      console.log("Symphony diagnostics\n");
      console.log("Workflow: %s", definition.path);
      console.log("Tracker:  %s", config.tracker.kind);
      console.log("Target:   %s", config.tracker.repo || config.tracker.projectSlug || "n/a");
      console.log("");

      const checks: DoctorCheck[] = [
        {
          name: "Workflow loads",
          run: async () => "pass",
        },
        {
          name: "Workspace root is writable",
          run: async () => {
            try {
              fs.mkdirSync(config.workspace.root, { recursive: true });
              fs.accessSync(config.workspace.root, fs.constants.W_OK);
              return "pass";
            } catch (err: any) {
              console.log("    %s", err.message);
              return "fail";
            }
          },
        },
        {
          name: "Codex app-server runtime",
          run: async () => {
            const status = getCodexStatus();
            if (!status.binaryPath) {
              console.log('    codex is not installed');
              return "fail";
            }
            if (!status.authenticated) {
              console.log('    run "codex login"');
              return "fail";
            }
            if (!status.appServerAvailable) {
              console.log("    codex app-server is unavailable");
              return "fail";
            }
            console.log("    %s", status.version || status.binaryPath);
            return "pass";
          },
        },
      ];

      if (config.tracker.kind === "github") {
        checks.push(
          {
            name: "GitHub API token configured",
            run: async () => {
              if (appConfig.github.token?.trim()) {
                return "pass";
              }
              console.log("    github.token is empty");
              return "fail";
            },
          },
          {
            name: "GitHub auth via gh",
            run: async () => {
              try {
                execFileSync("gh", ["auth", "status"], { cwd: PROJECT_ROOT, stdio: "pipe" });
                return "pass";
              } catch (err: any) {
                console.log("    gh auth status failed");
                return "fail";
              }
            },
          },
          {
            name: "GitHub repo is reachable",
            run: async () => {
              try {
                execFileSync("gh", ["repo", "view", config.tracker.repo || "", "--json", "nameWithOwner"], {
                  cwd: PROJECT_ROOT,
                  stdio: "pipe",
                });
                return "pass";
              } catch (err: any) {
                console.log("    %s", stderrText(err) || "repo lookup failed");
                return "fail";
              }
            },
          },
          {
            name: "Required GitHub labels exist",
            run: async () => {
              try {
                const output = execFileSync(
                  "gh",
                  ["label", "list", "--repo", config.tracker.repo || "", "--limit", "200", "--json", "name"],
                  { cwd: PROJECT_ROOT, stdio: "pipe", encoding: "utf-8" },
                );
                const labels = new Set(
                  JSON.parse(output).map((entry: { name?: string }) => String(entry.name || "").trim().toLowerCase()),
                );
                const required = extractWorkflowLabels(config, definition.promptTemplate);
                const missing = required.filter((label) => !labels.has(label.toLowerCase()));
                if (missing.length === 0) {
                  return "pass";
                }
                console.log("    Missing: %s", missing.join(", "));
                return "warn";
              } catch (err: any) {
                console.log("    %s", stderrText(err) || err.message);
                return "fail";
              }
            },
          },
        );

        if (config.landing.enabled) {
          checks.push(
            {
              name: "Landing source repo is a git checkout",
              run: async () => {
                const sourceRepo = process.env.SYMPHONY_SOURCE_REPO || PROJECT_ROOT;
                try {
                  execFileSync("git", ["rev-parse", "--show-toplevel"], {
                    cwd: sourceRepo,
                    stdio: "pipe",
                  });
                  return "pass";
                } catch (err: any) {
                  console.log("    %s", stderrText(err) || "source repo is not a git checkout");
                  return "fail";
                }
              },
            },
            {
              name: "Landing source repo has origin remote",
              run: async () => {
                const sourceRepo = process.env.SYMPHONY_SOURCE_REPO || PROJECT_ROOT;
                try {
                  execFileSync("git", ["remote", "get-url", "origin"], {
                    cwd: sourceRepo,
                    stdio: "pipe",
                  });
                  return "pass";
                } catch (err: any) {
                  console.log("    %s", stderrText(err) || "origin remote not configured");
                  return "fail";
                }
              },
            },
          );
        }
      }

      let failed = false;
      for (const check of checks) {
        try {
          const result = await check.run();
          if (result === "pass") {
            console.log("%s %s", PASS, check.name);
          } else if (result === "warn") {
            console.log("%s %s", WARN, check.name);
          } else {
            failed = true;
            console.log("%s %s", FAIL, check.name);
          }
        } catch (err: any) {
          failed = true;
          console.log("%s %s", FAIL, check.name);
          console.log("    %s", err.message);
        }
      }

      if (failed) {
        process.exitCode = 1;
      }
    });

  symphony
    .command("start [workflow]")
    .description("Start or restart the Symphony sidecar")
    .action(async (workflow?: string) => {
      const existing = await getProcess(SYMPHONY_PM2_NAME);
      const args = workflow ? [workflow] : [];

      if (existing && existing.status === "online") {
        await withPm2(async (pm2) => {
          return new Promise<void>((resolve, reject) => {
            pm2.delete(SYMPHONY_PM2_NAME, (deleteErr) => {
              if (deleteErr) return reject(deleteErr);
              pm2.start(
                {
                  name: SYMPHONY_PM2_NAME,
                  script: SYMPHONY_SCRIPT,
                  cwd: PROJECT_ROOT,
                  interpreter: TSX_BIN,
                  args,
                  log_date_format: "YYYY-MM-DD HH:mm:ss",
                },
                (startErr) => (startErr ? reject(startErr) : resolve()),
              );
            });
          });
        });
        console.log("Symphony restarted.");
        return;
      }

      await withPm2(async (pm2) => {
        return new Promise<void>((resolve, reject) => {
          pm2.start(
            {
              name: SYMPHONY_PM2_NAME,
              script: SYMPHONY_SCRIPT,
              cwd: PROJECT_ROOT,
              interpreter: TSX_BIN,
              args,
              log_date_format: "YYYY-MM-DD HH:mm:ss",
            },
            (err) => (err ? reject(err) : resolve()),
          );
        });
      });

      console.log("Symphony started.");
    });

  symphony
    .command("stop")
    .description("Stop the Symphony sidecar")
    .action(async () => {
      const existing = await getProcess(SYMPHONY_PM2_NAME);
      if (!existing || existing.status === "stopped") {
        console.log("Symphony is not running.");
        return;
      }

      await withPm2(async (pm2) => {
        return new Promise<void>((resolve, reject) => {
          pm2.stop(SYMPHONY_PM2_NAME, (err) => (err ? reject(err) : resolve()));
        });
      });

      console.log("Symphony stopped.");
    });

  symphony
    .command("run-once [workflow]")
    .description("Run a single Symphony poll/dispatch cycle in the foreground")
    .action((workflow?: string) => {
      const args = [SYMPHONY_SCRIPT, "--once"];
      if (workflow) args.push(workflow);
      execFileSync(TSX_BIN, args, { cwd: PROJECT_ROOT, stdio: "inherit" });
    });

  symphony
    .command("status")
    .description("Show Symphony process and orchestrator status")
    .action(async () => {
      const proc = await getProcess(SYMPHONY_PM2_NAME);
      const snapshot = readSnapshot();

      if (!proc) {
        console.log("Symphony process is not running.");
      } else {
        console.log("Process: %s", proc.name);
        console.log("Status:  %s", proc.status);
        console.log("PID:     %s", proc.pid || "—");
        console.log("Uptime:  %s", formatUptime(proc.uptime));
      }

      if (!snapshot) {
        console.log("");
        console.log("No Symphony snapshot found yet.");
        return;
      }

      console.log("");
      console.log("Workflow:      %s", snapshot.workflowPath);
      console.log("Tracker:       %s (%s)", snapshot.tracker.kind, snapshot.tracker.target || "no target");
      console.log("Running:       %d", snapshot.running.length);
      console.log("Retry queue:   %d", snapshot.retryQueue.length);
      console.log("Claimed:       %d", snapshot.claimedIssueIds.length);
      console.log("Last poll:     %s", snapshot.lastPollAt ? new Date(snapshot.lastPollAt).toLocaleString() : "never");
      if (snapshot.completed?.length) {
        const latest = snapshot.completed[0];
        console.log("Latest ready:  %s %s", latest.identifier, latest.title);
        if (latest.landing?.pullRequest?.url) {
          console.log("Latest PR:     %s", latest.landing.pullRequest.url);
        } else if (latest.landing?.branchName) {
          console.log("Latest branch: %s", latest.landing.branchName);
        }
      }
      if (snapshot.lastError) {
        console.log("Last error:    %s", snapshot.lastError);
      }
    });

  symphony
    .command("cleanup [workflow]")
    .description("Prune finished issue workspaces and optionally stale remote Symphony branches")
    .option("--apply", "Apply deletions instead of showing a dry-run plan")
    .option("--delete-remote-branches", "Also delete stale remote codex/symphony branches with no open PR")
    .action(async (workflow?: string, opts?: { apply?: boolean; deleteRemoteBranches?: boolean }) => {
      const workflowPath = workflow ? path.resolve(workflow) : path.join(PROJECT_ROOT, "WORKFLOW.md");
      const definition = loadWorkflow(workflowPath);
      const config = buildSymphonyConfig(definition);
      const tracker = createTracker(config);
      const snapshot = readSnapshot();
      const activeIssues = await tracker.fetchCandidateIssues();
      const keepKeys = new Set(
        activeIssues.map((issue) => sanitizeIssueKey(issue.identifier)).concat(snapshot?.running.map((entry) => sanitizeIssueKey(entry.identifier)) || []),
      );
      const workspaceRoot = config.workspace.root;
      const workspaceDirs = fs.existsSync(workspaceRoot)
        ? fs.readdirSync(workspaceRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
        : [];
      const removableWorkspaces = workspaceDirs.filter((key) => !keepKeys.has(key));

      console.log("Symphony cleanup\n");
      console.log("Workflow:   %s", definition.path);
      console.log("Dry run:    %s", opts?.apply ? "no" : "yes");
      console.log("Workspaces: %d removable / %d total", removableWorkspaces.length, workspaceDirs.length);

      for (const key of removableWorkspaces) {
        const target = path.join(workspaceRoot, key);
        console.log("%s workspace %s", opts?.apply ? "Deleting" : "Would delete", target);
        if (opts?.apply) {
          fs.rmSync(target, { recursive: true, force: true });
        }
      }

      if (!opts?.deleteRemoteBranches) {
        return;
      }

      const sourceRepo = process.env.SYMPHONY_SOURCE_REPO || PROJECT_ROOT;
      const prefix = config.landing.branchPrefix;
      const remoteBranches = listRemoteBranches(sourceRepo, prefix);
      const openPrBranches = config.tracker.kind === "github" && config.tracker.repo
        ? listOpenPrBranches(config.tracker.repo)
        : new Set<string>();
      const staleRemoteBranches = remoteBranches.filter((branch) => !openPrBranches.has(branch));

      console.log("Remote branches: %d stale / %d total", staleRemoteBranches.length, remoteBranches.length);
      for (const branch of staleRemoteBranches) {
        console.log("%s remote branch %s", opts?.apply ? "Deleting" : "Would delete", branch);
        if (opts?.apply) {
          execFileSync("git", ["push", "origin", "--delete", branch], { cwd: sourceRepo, stdio: "pipe" });
        }
      }
    });

  symphony
    .command("logs [issue]")
    .description("Show Symphony logs or per-issue logs")
    .option("-f, --follow", "Follow PM2 log output")
    .option("-n, --lines <number>", "Number of lines to show", "80")
    .action((issue?: string, opts?: { follow?: boolean; lines?: string }) => {
      if (issue) {
        const lines = readIssueLog(issue, Number(opts?.lines || "80"));
        if (lines.length === 0) {
          const safe = sanitizeIssueKey(issue);
          console.log("No per-issue log found for %s (%s).", issue, safe);
          return;
        }
        console.log(lines.join("\n"));
        return;
      }

      const lines = opts?.lines || "80";
      if (opts?.follow) {
        const child = spawn("npx", ["pm2", "logs", SYMPHONY_PM2_NAME, "--lines", lines], {
          cwd: PROJECT_ROOT,
          stdio: "inherit",
        });
        process.on("SIGINT", () => child.kill("SIGINT"));
        child.on("exit", (code) => process.exit(code ?? 0));
        return;
      }

      try {
        execSync(`npx pm2 logs ${SYMPHONY_PM2_NAME} --nostream --lines ${lines}`, {
          cwd: PROJECT_ROOT,
          stdio: "inherit",
        });
      } catch {
        console.log("No Symphony process logs found.");
      }
    });
}

function extractWorkflowLabels(
  config: { tracker: { activeStates: string[] } },
  promptTemplate: string,
): string[] {
  const labels = new Set<string>();
  for (const state of config.tracker.activeStates) {
    if (state.includes(":")) {
      labels.add(state.trim());
    }
  }

  const promptLabels = promptTemplate.match(/\bsymphony:[a-z0-9-]+\b/gi) || [];
  for (const label of promptLabels) {
    labels.add(label.trim());
  }

  return Array.from(labels.values()).sort();
}

function listRemoteBranches(cwd: string, prefix: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["ls-remote", "--heads", "origin", `${prefix}*`],
      { cwd, stdio: "pipe", encoding: "utf-8" },
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[1] || "")
      .filter(Boolean)
      .map((ref) => ref.replace(/^refs\/heads\//, ""));
  } catch {
    return [];
  }
}

function listOpenPrBranches(repo: string): Set<string> {
  try {
    const output = execFileSync(
      "gh",
      ["pr", "list", "--repo", repo, "--state", "open", "--json", "headRefName"],
      { cwd: PROJECT_ROOT, stdio: "pipe", encoding: "utf-8" },
    );
    return new Set(
      JSON.parse(output)
        .map((entry: { headRefName?: string }) => String(entry.headRefName || "").trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function stderrText(error: any): string {
  if (typeof error?.stderr === "string") return error.stderr.trim();
  if (Buffer.isBuffer(error?.stderr)) return error.stderr.toString("utf-8").trim();
  return "";
}
