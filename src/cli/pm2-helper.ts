import pm2 from "pm2";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, "../..");
export const BOT_SCRIPT = resolve(PROJECT_ROOT, "src/index.ts");
export const SYMPHONY_SCRIPT = resolve(PROJECT_ROOT, "src/symphony/index.ts");
export const TSX_BIN = resolve(PROJECT_ROOT, "node_modules/.bin/tsx");
export const PM2_NAME = "chris-assistant";
export const SYMPHONY_PM2_NAME = "chris-symphony";

/** Connect to pm2 daemon, run a callback, then disconnect. */
export function withPm2<T>(fn: (pm2Instance: typeof pm2) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);
      fn(pm2)
        .then((result) => {
          pm2.disconnect();
          resolve(result);
        })
        .catch((err) => {
          pm2.disconnect();
          reject(err);
        });
    });
  });
}

export interface ProcessInfo {
  name: string;
  status: string;
  pid: number | undefined;
  uptime: number | undefined;
  memory: number | undefined;
  restarts: number | undefined;
}

/** Get process info for the bot, or null if not found. */
export async function getProcess(name: string): Promise<ProcessInfo | null> {
  return withPm2(async (pm2) => {
    return new Promise((resolve, reject) => {
      pm2.describe(name, (err, list) => {
        if (err) return reject(err);
        if (!list || list.length === 0) return resolve(null);

        const proc = list[0];
        resolve({
          name: proc.name || name,
          status: proc.pm2_env?.status || "unknown",
          pid: proc.pid,
          uptime: proc.pm2_env?.pm_uptime,
          memory: proc.monit?.memory,
          restarts: proc.pm2_env?.restart_time,
        });
      });
    });
  });
}

export async function getBotProcess(): Promise<ProcessInfo | null> {
  return getProcess(PM2_NAME);
}
