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

  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (once) {
    await runtime.runOnce();
    await runtime.stop();
    return;
  }

  await runtime.start();
}

main().catch((err) => {
  console.error("[symphony] Fatal error:", err);
  process.exit(1);
});
