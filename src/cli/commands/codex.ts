import { Command } from "commander";
import { getCodexStatus } from "../../codex.js";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

export function registerCodexCommand(program: Command) {
  const codex = program
    .command("codex")
    .description("Codex CLI and SDK runtime checks");

  codex
    .command("status")
    .description("Show Codex CLI binary/auth/app-server status")
    .action(() => {
      const status = getCodexStatus();

      console.log("Binary:      %s", status.binaryPath || "not found");
      console.log("Version:     %s", status.version || "unknown");
      console.log("Auth file:   %s", status.authFile);
      console.log("Auth:        %s", status.authenticated ? "configured" : "missing");
      if (status.accountId) {
        console.log("Account ID:  %s", status.accountId);
      }
      console.log("App server:  %s", status.appServerAvailable ? "available" : "unavailable");

      if (status.errors.length > 0) {
        console.log("");
        for (const error of status.errors) {
          console.log("- %s", error);
        }
      }
    });

  codex
    .command("doctor")
    .description("Run Codex CLI readiness checks for codex-agent and Symphony")
    .action(() => {
      const status = getCodexStatus();
      const checks = [
        { name: "codex binary available", ok: !!status.binaryPath },
        { name: "codex --version works", ok: !!status.version },
        { name: "codex auth configured", ok: status.authenticated },
        { name: "codex app-server command available", ok: status.appServerAvailable },
      ];

      let failed = 0;
      for (const check of checks) {
        const icon = check.ok ? PASS : FAIL;
        console.log("%s %s", icon, check.name);
        if (!check.ok) failed++;
      }

      if (failed > 0) {
        console.log("");
        console.log('Fix missing auth with "codex login".');
        process.exit(1);
      }
    });
}
