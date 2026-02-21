import { execFile } from "child_process";
import { promisify } from "util";
import { randomBytes } from "crypto";
import { z } from "zod";
import { registerTool } from "./registry.js";
import { resolveSafePath } from "./files.js";

const execFileAsync = promisify(execFile);

// Absolute paths — pm2 daemon doesn't inherit shell PATH
const SSH_BIN = "/usr/bin/ssh";
const SCP_BIN = "/usr/bin/scp";
const TMUX_BIN = "/opt/homebrew/bin/tmux";
const TAILSCALE_BIN = "/usr/local/bin/tailscale";

const SSH_OPTS = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=10",
  "-o", "StrictHostKeyChecking=accept-new",
];

const MAX_OUTPUT = 50_000;
const SESSION_PREFIX = "chris-bot-";

function truncate(s: string): string {
  if (s.length > MAX_OUTPUT) {
    return s.slice(0, MAX_OUTPUT) + "\n\n[... truncated ...]";
  }
  return s;
}

function sanitizeForTmux(s: string): string {
  return s.replace(/[.:]/g, "-");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tmuxHasSession(name: string): Promise<boolean> {
  try {
    await execFileAsync(TMUX_BIN, ["has-session", "-t", name], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function tmuxCapture(name: string, lines: number): Promise<string> {
  const { stdout } = await execFileAsync(
    TMUX_BIN,
    ["capture-pane", "-t", name, "-p", "-S", `-${lines}`],
    { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout;
}

/**
 * Check if the pane looks idle — last non-empty line ends with a shell prompt char.
 */
function looksIdle(output: string): boolean {
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  const last = lines[lines.length - 1].trimEnd();
  return /[$#%>]\s*$/.test(last);
}

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

async function actionExec(args: {
  host: string;
  command: string;
  task_id?: string;
  timeout?: number;
}): Promise<string> {
  const timeout = Math.min(args.timeout ?? 60, 300);
  const taskId = args.task_id || randomBytes(3).toString("hex");
  const sessionName = `${SESSION_PREFIX}${sanitizeForTmux(args.host)}-${taskId}`;

  console.log("[ssh] exec host=%s session=%s command=%s", args.host, sessionName, args.command.slice(0, 100));

  const existed = await tmuxHasSession(sessionName);

  if (!existed) {
    // Create new tmux session with SSH connection
    await execFileAsync(
      TMUX_BIN,
      [
        "new-session", "-d", "-s", sessionName,
        "-x", "200", "-y", "50",
        "--", SSH_BIN, ...SSH_OPTS, args.host,
      ],
      { timeout: 15_000 },
    );
    // Wait for SSH connection to establish
    await sleep(2000);
  }

  // Send the command
  await execFileAsync(
    TMUX_BIN,
    ["send-keys", "-t", sessionName, args.command, "Enter"],
    { timeout: 10_000 },
  );

  // Poll until done or timeout
  const deadline = Date.now() + timeout * 1000;
  let previousCapture = "";
  let stableCount = 0;

  // Give the command a moment to start
  await sleep(1000);

  while (Date.now() < deadline) {
    const capture = await tmuxCapture(sessionName, 100);

    if (capture === previousCapture && looksIdle(capture)) {
      stableCount++;
      if (stableCount >= 2) {
        return truncate(capture.trimEnd());
      }
    } else {
      stableCount = 0;
    }

    previousCapture = capture;
    await sleep(1000);
  }

  // Timeout — return what we have
  const finalCapture = await tmuxCapture(sessionName, 100);
  return truncate(
    finalCapture.trimEnd() +
    `\n\n[command may still be running in tmux session "${sessionName}"]`,
  );
}

async function actionSendKeys(args: {
  session: string;
  keys: string;
}): Promise<string> {
  console.log("[ssh] send_keys session=%s keys=%s", args.session, args.keys.slice(0, 50));

  if (!args.session.startsWith(SESSION_PREFIX)) {
    return `Error: session name must start with "${SESSION_PREFIX}"`;
  }

  if (!(await tmuxHasSession(args.session))) {
    return `Error: tmux session "${args.session}" not found`;
  }

  await execFileAsync(
    TMUX_BIN,
    ["send-keys", "-t", args.session, args.keys],
    { timeout: 10_000 },
  );

  // Capture pane after sending
  await sleep(500);
  const capture = await tmuxCapture(args.session, 50);
  return truncate(capture.trimEnd());
}

async function actionReadPane(args: {
  session: string;
  lines?: number;
}): Promise<string> {
  const lines = Math.min(args.lines ?? 100, 2000);
  console.log("[ssh] read_pane session=%s lines=%d", args.session, lines);

  if (!args.session.startsWith(SESSION_PREFIX)) {
    return `Error: session name must start with "${SESSION_PREFIX}"`;
  }

  if (!(await tmuxHasSession(args.session))) {
    return `Error: tmux session "${args.session}" not found`;
  }

  const capture = await tmuxCapture(args.session, lines);
  return truncate(capture.trimEnd()) || "(empty pane)";
}

async function actionDevices(): Promise<string> {
  console.log("[ssh] devices");

  try {
    const { stdout } = await execFileAsync(
      TAILSCALE_BIN,
      ["status", "--json"],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    );

    const status = JSON.parse(stdout);
    const peers = status.Peer || {};
    const self = status.Self;

    const lines: string[] = [];

    // Add self
    if (self) {
      const online = self.Online ? "online" : "offline";
      const os = self.OS || "unknown";
      const ip = self.TailscaleIPs?.[0] || "no IP";
      lines.push(`* ${self.HostName} — ${ip} (${os}, ${online}) [this device]`);
    }

    // Add peers
    for (const peer of Object.values(peers) as any[]) {
      const online = peer.Online ? "online" : "offline";
      const os = peer.OS || "unknown";
      const ip = peer.TailscaleIPs?.[0] || "no IP";
      lines.push(`${online === "online" ? "*" : " "} ${peer.HostName} — ${ip} (${os}, ${online})`);
    }

    if (lines.length === 0) {
      return "No Tailscale devices found.";
    }

    return lines.join("\n");
  } catch (err: any) {
    return `Error getting Tailscale status: ${err.message}`;
  }
}

async function actionSessions(): Promise<string> {
  console.log("[ssh] sessions");

  try {
    const { stdout } = await execFileAsync(
      TMUX_BIN,
      ["list-sessions", "-F", "#{session_name} #{session_created}"],
      { timeout: 10_000 },
    );

    const sessions = stdout
      .split("\n")
      .filter(Boolean)
      .filter((line) => line.startsWith(SESSION_PREFIX))
      .map((line) => {
        const [name, created] = line.split(" ");
        const date = created
          ? new Date(parseInt(created, 10) * 1000).toLocaleString()
          : "unknown";
        return `- ${name} (created: ${date})`;
      });

    if (sessions.length === 0) {
      return "No active chris-bot tmux sessions.";
    }

    return `${sessions.length} active session(s):\n${sessions.join("\n")}`;
  } catch (err: any) {
    // tmux returns error when no server is running
    if (err.message?.includes("no server running") || err.message?.includes("no sessions")) {
      return "No active chris-bot tmux sessions.";
    }
    return `Error listing sessions: ${err.message}`;
  }
}

async function actionKillSession(args: { session: string }): Promise<string> {
  console.log("[ssh] kill_session session=%s", args.session);

  if (!args.session.startsWith(SESSION_PREFIX)) {
    return `Error: can only kill sessions with "${SESSION_PREFIX}" prefix`;
  }

  if (!(await tmuxHasSession(args.session))) {
    return `Error: tmux session "${args.session}" not found`;
  }

  try {
    await execFileAsync(
      TMUX_BIN,
      ["kill-session", "-t", args.session],
      { timeout: 10_000 },
    );
    return `Killed tmux session "${args.session}"`;
  } catch (err: any) {
    return `Error killing session: ${err.message}`;
  }
}

async function actionScpPush(args: {
  host: string;
  local_path: string;
  remote_path: string;
}): Promise<string> {
  console.log("[ssh] scp_push host=%s local=%s remote=%s", args.host, args.local_path, args.remote_path);

  const resolved = resolveSafePath(args.local_path);
  if (!resolved) {
    return `Error: local path "${args.local_path}" escapes the workspace root — access denied.`;
  }

  try {
    await execFileAsync(
      SCP_BIN,
      [...SSH_OPTS, resolved, `${args.host}:${args.remote_path}`],
      { timeout: 120_000 },
    );
    return `Copied ${args.local_path} → ${args.host}:${args.remote_path}`;
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

async function actionScpPull(args: {
  host: string;
  remote_path: string;
  local_path: string;
}): Promise<string> {
  console.log("[ssh] scp_pull host=%s remote=%s local=%s", args.host, args.remote_path, args.local_path);

  const resolved = resolveSafePath(args.local_path);
  if (!resolved) {
    return `Error: local path "${args.local_path}" escapes the workspace root — access denied.`;
  }

  try {
    await execFileAsync(
      SCP_BIN,
      [...SSH_OPTS, `${args.host}:${args.remote_path}`, resolved],
      { timeout: 120_000 },
    );
    return `Copied ${args.host}:${args.remote_path} → ${args.local_path}`;
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

registerTool({
  name: "ssh",
  category: "always",
  description:
    "SSH into Tailnet devices to run commands, manage tmux sessions, and transfer files. " +
    "Commands run in persistent tmux sessions that can be attached to from other devices (e.g. iPhone). " +
    "Actions: exec (run a command via SSH in a tmux session), send_keys (send keystrokes to a tmux session), " +
    "read_pane (read current tmux pane content), devices (list Tailnet devices), sessions (list active SSH sessions), " +
    "kill_session (terminate a tmux session), scp_push (copy local file to remote), scp_pull (copy remote file to local).",
  zodSchema: {
    action: z.enum(["exec", "send_keys", "read_pane", "devices", "sessions", "kill_session", "scp_push", "scp_pull"])
      .describe("The SSH action to perform"),
    host: z.string().optional().describe("Tailnet hostname or IP (required for exec, scp_push, scp_pull)"),
    command: z.string().optional().describe("Command to run on the remote host (required for exec)"),
    task_id: z.string().optional().describe("Optional ID for the tmux session (default: random 6-char hex)"),
    timeout: z.number().optional().describe("Timeout in seconds for exec (default: 60, max: 300)"),
    session: z.string().optional().describe("Tmux session name (required for send_keys, read_pane, kill_session)"),
    keys: z.string().optional().describe("Keystrokes to send (required for send_keys). Examples: 'C-c', '\"ls -la\" Enter'"),
    lines: z.number().optional().describe("Number of pane lines to capture for read_pane (default: 100, max: 2000)"),
    local_path: z.string().optional().describe("Local file path relative to workspace (required for scp_push, scp_pull)"),
    remote_path: z.string().optional().describe("Remote file path (required for scp_push, scp_pull)"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["exec", "send_keys", "read_pane", "devices", "sessions", "kill_session", "scp_push", "scp_pull"],
        description: "The SSH action to perform",
      },
      host: {
        type: "string",
        description: "Tailnet hostname or IP (required for exec, scp_push, scp_pull)",
      },
      command: {
        type: "string",
        description: "Command to run on the remote host (required for exec)",
      },
      task_id: {
        type: "string",
        description: "Optional ID for the tmux session (default: random 6-char hex)",
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds for exec (default: 60, max: 300)",
      },
      session: {
        type: "string",
        description: "Tmux session name (required for send_keys, read_pane, kill_session)",
      },
      keys: {
        type: "string",
        description: "Keystrokes to send (required for send_keys). Examples: 'C-c', '\"ls -la\" Enter'",
      },
      lines: {
        type: "number",
        description: "Number of pane lines to capture for read_pane (default: 100, max: 2000)",
      },
      local_path: {
        type: "string",
        description: "Local file path relative to workspace (required for scp_push, scp_pull)",
      },
      remote_path: {
        type: "string",
        description: "Remote file path (required for scp_push, scp_pull)",
      },
    },
  },
  execute: async (args: {
    action: string;
    host?: string;
    command?: string;
    task_id?: string;
    timeout?: number;
    session?: string;
    keys?: string;
    lines?: number;
    local_path?: string;
    remote_path?: string;
  }): Promise<string> => {
    switch (args.action) {
      case "exec": {
        if (!args.host) return "Error: 'host' is required for exec";
        if (!args.command) return "Error: 'command' is required for exec";
        return actionExec({
          host: args.host,
          command: args.command,
          task_id: args.task_id,
          timeout: args.timeout,
        });
      }

      case "send_keys": {
        if (!args.session) return "Error: 'session' is required for send_keys";
        if (!args.keys) return "Error: 'keys' is required for send_keys";
        return actionSendKeys({ session: args.session, keys: args.keys });
      }

      case "read_pane": {
        if (!args.session) return "Error: 'session' is required for read_pane";
        return actionReadPane({ session: args.session, lines: args.lines });
      }

      case "devices":
        return actionDevices();

      case "sessions":
        return actionSessions();

      case "kill_session": {
        if (!args.session) return "Error: 'session' is required for kill_session";
        return actionKillSession({ session: args.session });
      }

      case "scp_push": {
        if (!args.host) return "Error: 'host' is required for scp_push";
        if (!args.local_path) return "Error: 'local_path' is required for scp_push";
        if (!args.remote_path) return "Error: 'remote_path' is required for scp_push";
        return actionScpPush({
          host: args.host,
          local_path: args.local_path,
          remote_path: args.remote_path,
        });
      }

      case "scp_pull": {
        if (!args.host) return "Error: 'host' is required for scp_pull";
        if (!args.remote_path) return "Error: 'remote_path' is required for scp_pull";
        if (!args.local_path) return "Error: 'local_path' is required for scp_pull";
        return actionScpPull({
          host: args.host,
          remote_path: args.remote_path,
          local_path: args.local_path,
        });
      }

      default:
        return `Unknown action: ${args.action}`;
    }
  },
});

console.log("[tools] ssh registered");
