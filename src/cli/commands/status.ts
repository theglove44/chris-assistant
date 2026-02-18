import { Command } from "commander";
import { getBotProcess } from "../pm2-helper.js";

function formatUptime(startMs: number | undefined): string {
  if (!startMs) return "unknown";
  const seconds = Math.floor((Date.now() - startMs) / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatMemory(bytes: number | undefined): string {
  if (!bytes) return "unknown";
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function registerStatusCommand(program: Command) {
  program
    .command("status")
    .description("Show bot status, uptime, and resource usage")
    .action(async () => {
      const proc = await getBotProcess();

      if (!proc) {
        console.log("Bot is not running.");
        console.log('Run "chris start" to start it.');
        return;
      }

      const statusIcon = proc.status === "online" ? "\x1b[32m●\x1b[0m" : "\x1b[31m●\x1b[0m";

      console.log(`${statusIcon} ${proc.name}`);
      console.log(`  Status:   ${proc.status}`);
      console.log(`  PID:      ${proc.pid || "—"}`);
      console.log(`  Uptime:   ${formatUptime(proc.uptime)}`);
      console.log(`  Memory:   ${formatMemory(proc.memory)}`);
      console.log(`  Restarts: ${proc.restarts ?? 0}`);
    });
}
