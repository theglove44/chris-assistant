import { Command } from "commander";
import { withPm2, getBotProcess, PM2_NAME, restartProcessWithFreshEnv } from "../pm2-helper.js";

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
        await restartProcessWithFreshEnv(pm2, PM2_NAME);
        console.log("Bot restarted with refreshed environment.");
      });
    });
}
