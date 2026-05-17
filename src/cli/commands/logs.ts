import { Command } from "commander";
import { execFileSync, spawn } from "child_process";
import { PM2_NAME } from "../pm2-helper.js";

export function parseLogLineCount(value: string | undefined, fallback = "50"): string {
  const raw = value ?? fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error("--lines must be a positive integer");
  }

  const lines = Number(raw);
  if (!Number.isSafeInteger(lines) || lines < 1) {
    throw new Error("--lines must be a positive integer");
  }

  return String(lines);
}

export function registerLogsCommand(program: Command) {
  program
    .command("logs")
    .description("Show bot logs")
    .option("-f, --follow", "Follow log output in real-time")
    .option("-n, --lines <number>", "Number of lines to show", "50")
    .action(async (opts) => {
      const lines = parseLogLineCount(opts.lines);

      if (opts.follow) {
        // Streaming mode — hand off to pm2 logs with live output
        const child = spawn("npx", ["pm2", "logs", PM2_NAME, "--lines", lines], {
          stdio: "inherit",
        });

        // Forward SIGINT to child so ctrl+c stops cleanly
        process.on("SIGINT", () => {
          child.kill("SIGINT");
        });

        child.on("exit", (code) => {
          process.exit(code ?? 0);
        });
      } else {
        try {
          execFileSync("npx", ["pm2", "logs", PM2_NAME, "--nostream", "--lines", lines], {
            stdio: "inherit",
          });
        } catch {
          console.log("No logs found. Is the bot running?");
        }
      }
    });
}
