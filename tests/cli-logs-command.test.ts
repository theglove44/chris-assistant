import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("child_process", () => childProcess);

import { parseLogLineCount, registerLogsCommand } from "../src/cli/commands/logs.js";

describe("logs command", () => {
  beforeEach(() => {
    childProcess.execFileSync.mockReset();
    childProcess.spawn.mockReset();
  });

  it("rejects non-numeric line counts", () => {
    expect(() => parseLogLineCount("1; touch /tmp/injected")).toThrow(
      "--lines must be a positive integer",
    );
    expect(() => parseLogLineCount("0")).toThrow("--lines must be a positive integer");
  });

  it("passes validated line counts as argv instead of a shell command", async () => {
    const program = new Command();
    program.exitOverride();
    registerLogsCommand(program);

    await program.parseAsync(["node", "chris", "logs", "--lines", "25"]);

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      "npx",
      ["pm2", "logs", "chris-assistant", "--nostream", "--lines", "25"],
      { stdio: "inherit" },
    );
  });
});
