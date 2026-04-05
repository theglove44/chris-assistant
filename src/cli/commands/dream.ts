import type { Command } from "commander";
import { dreamStatus, forceDream } from "../../domain/memory/dream-service.js";

export function registerDreamCommand(program: Command): void {
  const cmd = program
    .command("dream")
    .description("Memory consolidation (DreamTask)");

  cmd
    .command("status")
    .description("Show dream consolidation status")
    .action(() => {
      const status = dreamStatus();
      console.log("Dream consolidation status:");
      console.log("  Last consolidated: %s", status.lastConsolidated);
      console.log("  Hours since:       %s", status.hoursSince === Infinity ? "never" : status.hoursSince);
      console.log("  Sessions since:    %s", status.sessionsSince);
      console.log("  Failures:          %s", status.consecutiveFailures);
      console.log("  Running:           %s", status.isRunning ? "yes" : "no");
    });

  cmd
    .command("run")
    .description("Force a dream consolidation now (bypasses gates)")
    .action(async () => {
      console.log("Starting forced dream consolidation...");
      const result = await forceDream();
      if (result.success) {
        console.log("Dream complete. Changes:");
        for (const change of result.changes) {
          console.log("  - %s", change);
        }
      } else {
        console.error("Dream failed: %s", result.changes.join(", "));
        process.exit(1);
      }
    });
}
