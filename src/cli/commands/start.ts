import { Command } from "commander";
import pm2 from "pm2";
import { withPm2, getBotProcess, PM2_NAME, BOT_SCRIPT, PROJECT_ROOT } from "../pm2-helper.js";

export function registerStartCommand(program: Command) {
  program
    .command("start")
    .description("Start the bot (or restart if already running)")
    .action(async () => {
      const existing = await getBotProcess();

      if (existing && existing.status === "online") {
        console.log("Bot is already running (pid %d). Restarting...", existing.pid);
        await withPm2(async (pm2) => {
          return new Promise<void>((resolve, reject) => {
            pm2.restart(PM2_NAME, (err) => {
              if (err) return reject(err);
              console.log("Bot restarted.");
              resolve();
            });
          });
        });
        return;
      }

      await withPm2(async (pm2Instance) => {
        return new Promise<void>((resolve, reject) => {
          pm2Instance.start(
            {
              name: PM2_NAME,
              script: "tsx",
              args: "src/index.ts",
              cwd: PROJECT_ROOT,
              interpreter: "none",
            },
            (err) => {
              if (err) return reject(err);
              console.log("Bot started.");
              resolve();
            },
          );
        });
      });
    });
}
