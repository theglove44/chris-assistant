import "dotenv/config";
import { createSymphonyRuntime } from "./runtime.js";

function parseArgs(argv: string[]): { once: boolean; workflowPath?: string } {
  const args = [...argv];
  const onceIndex = args.indexOf("--once");
  const once = onceIndex !== -1;
  if (once) args.splice(onceIndex, 1);
  return {
    once,
    workflowPath: args[0],
  };
}

async function main(): Promise<void> {
  const { once, workflowPath } = parseArgs(process.argv.slice(2));
  const runtime = createSymphonyRuntime(workflowPath);

  let shuttingDown = false;
  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await runtime.stop();
    } catch (err) {
      console.error("[symphony] shutdown error:", err);
    }
    process.exit(code);
  };

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGHUP", () => void shutdown(0));

  if (once) {
    await runtime.runOnce();
    // run-once was leaking child processes; force-exit guarantees codex
    // children are torn down even if a handle keeps the loop alive.
    await shutdown(0);
    return;
  }

  await runtime.start();
}

main().catch(async (err) => {
  console.error("[symphony] Fatal error:", err);
  process.exit(1);
});
