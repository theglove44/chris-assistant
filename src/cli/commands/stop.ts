import { Command } from "commander";
import { withPm2, getBotProcess, PM2_NAME } from "../pm2-helper.js";

export function registerStopCommand(program: Command) {
  program
    .command("stop")
    .description("Stop the bot")
    .action(async () => {
      const existing = await getBotProcess();

      if (!existing || existing.status === "stopped") {
        console.log("Bot is not running.");
        return;
      }

      await withPm2(async (pm2) => {
        return new Promise<void>((resolve, reject) => {
          pm2.stop(PM2_NAME, (err) => {
            if (err) return reject(err);
            console.log("Bot stopped.");
            resolve();
          });
        });
      });
    });
}
