import { Command } from "commander";
import { execSync, spawn } from "child_process";
import { PM2_NAME } from "../pm2-helper.js";

export function registerLogsCommand(program: Command) {
  program
    .command("logs")
    .description("Show bot logs")
    .option("-f, --follow", "Follow log output in real-time")
    .option("-n, --lines <number>", "Number of lines to show", "50")
    .action(async (opts) => {
      const args = ["logs", PM2_NAME, "--nostream", "--lines", opts.lines];

      if (opts.follow) {
        // Streaming mode — hand off to pm2 logs with live output
        const child = spawn("npx", ["pm2", "logs", PM2_NAME, "--lines", opts.lines], {
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
          execSync(`npx pm2 logs ${PM2_NAME} --nostream --lines ${opts.lines}`, {
            stdio: "inherit",
          });
        } catch {
          console.log("No logs found. Is the bot running?");
        }
      }
    });
}
