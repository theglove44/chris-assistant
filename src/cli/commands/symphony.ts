import { Command } from "commander";
import { execFileSync, execSync, spawn } from "child_process";
import * as os from "os";
import * as path from "path";
import { readIssueLog, readSnapshot, sanitizeIssueKey } from "../../symphony/paths.js";
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

export function registerSymphonyCommand(program: Command) {
  const symphony = program
    .command("symphony")
    .description("Manage the Symphony sidecar orchestrator");

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
      console.log("Tracker:       %s (%s)", snapshot.tracker.kind, snapshot.tracker.projectSlug || "no project");
      console.log("Running:       %d", snapshot.running.length);
      console.log("Retry queue:   %d", snapshot.retryQueue.length);
      console.log("Claimed:       %d", snapshot.claimedIssueIds.length);
      console.log("Last poll:     %s", snapshot.lastPollAt ? new Date(snapshot.lastPollAt).toLocaleString() : "never");
      if (snapshot.lastError) {
        console.log("Last error:    %s", snapshot.lastError);
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
