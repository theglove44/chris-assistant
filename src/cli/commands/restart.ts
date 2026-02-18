import { Command } from "commander";
import { withPm2, getBotProcess, PM2_NAME } from "../pm2-helper.js";

export function registerRestartCommand(program: Command) {
  program
    .command("restart")
    .description("Restart the bot")
    .action(async () => {
      const existing = await getBotProcess();

      if (!existing || existing.status === "stopped") {
        console.log("Bot is not running. Use 'chris start' instead.");
        return;
      }

      await withPm2(async (pm2) => {
        return new Promise<void>((resolve, reject) => {
          pm2.restart(PM2_NAME, (err) => {
            if (err) return reject(err);
            console.log("Bot restarted.");
            resolve();
          });
        });
      });
    });
}
