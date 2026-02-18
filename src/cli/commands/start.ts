import { Command } from "commander";
import { withPm2, getBotProcess, PM2_NAME, BOT_SCRIPT, TSX_BIN, PROJECT_ROOT } from "../pm2-helper.js";

export function registerStartCommand(program: Command) {
  program
    .command("start")
    .description("Start the bot (or restart if already running)")
    .action(async () => {
      try {
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
                script: BOT_SCRIPT,
                cwd: PROJECT_ROOT,
                interpreter: TSX_BIN,
              },
              (err) => {
                if (err) {
                  // pm2 sometimes rejects with an array of errors
                  if (Array.isArray(err)) {
                    for (const e of err) {
                      console.error("Error:", e?.message || e);
                    }
                  } else {
                    console.error("Error:", (err as Error)?.message || err);
                  }
                  return reject(err);
                }
                console.log("Bot started.");
                resolve();
              },
            );
          });
        });
      } catch (err: any) {
        if (Array.isArray(err)) {
          for (const e of err) {
            console.error(e?.message || JSON.stringify(e));
          }
        } else {
          console.error(err?.message || err);
        }
        process.exit(1);
      }
    });
}
