import { stopApp } from "./bootstrap.js";

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    await stopApp();
  } finally {
    process.exit(0);
  }
}

export function registerProcessLifecycle(): void {
  process.on("SIGINT", () => {
    shutdown().catch((err: any) => {
      console.error("[chris-assistant] Shutdown failed:", err.message);
      process.exit(1);
    });
  });

  process.on("SIGTERM", () => {
    shutdown().catch((err: any) => {
      console.error("[chris-assistant] Shutdown failed:", err.message);
      process.exit(1);
    });
  });
}
