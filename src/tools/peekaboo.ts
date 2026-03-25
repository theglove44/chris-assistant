import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { registerTool } from "./registry.js";

const execFileAsync = promisify(execFile);

// Absolute paths — pm2 daemon doesn't inherit shell PATH
const SSH_BIN = "/usr/bin/ssh";
const SCP_BIN = "/usr/bin/scp";

const SSH_OPTS = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=10",
  "-o", "StrictHostKeyChecking=accept-new",
];

const PEEKABOO_HOST = "stormbreaker";
const PEEKABOO_BIN = "/usr/local/bin/peekaboo";
const REMOTE_TMUX = "/usr/local/bin/tmux";
const TMUX_SESSION = "peekaboo";

const MAX_OUTPUT = 50_000;
const POLL_INTERVAL_MS = 1_500;
const MAX_POLL_ATTEMPTS = 40; // 60s max wait

function truncate(s: string): string {
  if (s.length > MAX_OUTPUT) {
    return s.slice(0, MAX_OUTPUT) + "\n\n[... truncated ...]";
  }
  return s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// SSH helpers
// ---------------------------------------------------------------------------

async function sshExec(command: string, timeout = 60): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      SSH_BIN,
      [...SSH_OPTS, PEEKABOO_HOST, command],
      { timeout: timeout * 1000, maxBuffer: 2 * 1024 * 1024 },
    );
    return `${stdout ?? ""}${stderr ?? ""}`.trimEnd();
  } catch (err: any) {
    const out = `${err?.stdout ?? ""}${err?.stderr ?? ""}`.trimEnd();
    if (out) return out;
    return `Error: ${err?.message ?? String(err)}`;
  }
}

async function scpPull(remotePath: string, localPath: string): Promise<void> {
  await execFileAsync(
    SCP_BIN,
    [...SSH_OPTS, `${PEEKABOO_HOST}:${remotePath}`, localPath],
    { timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// Tmux helpers (remote tmux on the Mac Mini)
// ---------------------------------------------------------------------------

async function hasSession(): Promise<boolean> {
  try {
    await sshExec(`${REMOTE_TMUX} has-session -t ${TMUX_SESSION}`, 10);
    return true;
  } catch {
    return false;
  }
}

async function capturePane(lines = 200): Promise<string> {
  return sshExec(
    `${REMOTE_TMUX} capture-pane -t ${TMUX_SESSION} -p -S -${lines}`,
    10,
  );
}

function looksIdle(output: string): boolean {
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  const last = lines[lines.length - 1].trimEnd();
  // Match common prompts: $, #, %, >, or zsh-style timestamps like "14:08:52"
  return /[$#%>]\s*$/.test(last) || /\d{2}:\d{2}:\d{2}\s*$/.test(last);
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

const SESSION_ERROR =
  "Error: The peekaboo tmux session is not running on the Mac Mini. " +
  "Start it from the Mac Mini's local Terminal:\n" +
  "  tmux new-session -d -s peekaboo\n" +
  "This is required for macOS Screen Recording/Accessibility permissions.";

async function runPeekaboo(command: string): Promise<string> {
  // Check session exists
  const sessionOutput = await sshExec(
    `${REMOTE_TMUX} has-session -t ${TMUX_SESSION} 2>&1 && echo __OK__`,
    10,
  );
  if (!sessionOutput.includes("__OK__")) {
    return SESSION_ERROR;
  }

  // Capture pane before sending to identify new output later
  const before = await capturePane();
  const beforeLines = before.split("\n").length;

  // Send command
  await sshExec(
    `${REMOTE_TMUX} send-keys -t ${TMUX_SESSION} ${shellQuote(command)} Enter`,
    10,
  );

  // Poll until output looks idle
  await sleep(POLL_INTERVAL_MS);
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const output = await capturePane(300);
    if (looksIdle(output) && output !== before) {
      // Extract only the new output (after the command we sent)
      return truncate(extractNewOutput(output, command));
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // Timed out — return whatever we have
  const final = await capturePane(300);
  return truncate(extractNewOutput(final, command) + "\n\n[... timed out waiting for completion ...]");
}

/**
 * Extract output after the command line we sent.
 * Looks for the command string in the pane, returns everything after it
 * up to (but not including) the final prompt line.
 */
function extractNewOutput(pane: string, command: string): string {
  const lines = pane.split("\n");
  let startIdx = -1;

  // Find the line containing our command (search from the end)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(command.slice(0, 60))) {
      startIdx = i + 1;
      break;
    }
  }

  if (startIdx === -1) return pane.trimEnd();

  // Take everything from after the command to the last non-empty line
  // (excluding the final prompt)
  const outputLines = lines.slice(startIdx);
  // Remove trailing prompt line
  while (outputLines.length > 0) {
    const last = outputLines[outputLines.length - 1].trimEnd();
    if (last === "" || /[$#%>]\s*$/.test(last)) {
      outputLines.pop();
    } else {
      break;
    }
  }

  return outputLines.join("\n").trimEnd() || "(no output)";
}

function shellQuote(s: string): string {
  // Wrap in double quotes, escaping inner double quotes and backslashes
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

async function actionScreenshot(args: {
  app?: string;
  mode?: string;
}): Promise<string> {
  const ts = Date.now();
  const remotePath = `/tmp/peekaboo-${ts}.png`;
  const localPath = `/tmp/peekaboo-${ts}.png`;

  const modeFlag = args.mode ? `--mode ${args.mode}` : "--mode screen";
  const appFlag = args.app ? `--app ${shellQuoteInner(args.app)}` : "";

  const cmd = `${PEEKABOO_BIN} image ${modeFlag} ${appFlag} --path ${remotePath}`.trim();
  const result = await runPeekaboo(cmd);

  if (result.includes("Error") || result.includes(SESSION_ERROR)) {
    return result;
  }

  // SCP the image back
  try {
    await scpPull(remotePath, localPath);
    // Clean up remote file
    await sshExec(`rm -f ${remotePath}`, 5);
    return `Screenshot saved to ${localPath}\n\n${result}`;
  } catch (err: any) {
    return `Peekaboo captured the screenshot but SCP failed: ${err?.message ?? String(err)}\nRemote file: ${remotePath}`;
  }
}

async function actionSee(args: {
  app?: string;
  mode?: string;
  annotate?: boolean;
}): Promise<string> {
  const modeFlag = args.mode ? `--mode ${args.mode}` : "--mode screen";
  const appFlag = args.app ? `--app ${shellQuoteInner(args.app)}` : "";
  const annotateFlag = args.annotate ? "--annotate" : "";

  const cmd = `${PEEKABOO_BIN} see ${modeFlag} ${appFlag} ${annotateFlag} --json`.trim();
  return runPeekaboo(cmd);
}

async function actionClick(args: {
  label?: string;
  snapshot?: string;
  element_id?: string;
}): Promise<string> {
  const parts = [PEEKABOO_BIN, "click"];
  if (args.label) parts.push("--on", shellQuoteInner(args.label));
  if (args.snapshot) parts.push("--snapshot", args.snapshot);
  if (args.element_id) parts.push("--id", args.element_id);
  return runPeekaboo(parts.join(" "));
}

async function actionType(args: { text: string }): Promise<string> {
  return runPeekaboo(`${PEEKABOO_BIN} type --text ${shellQuoteInner(args.text)}`);
}

async function actionHotkey(args: { keys: string }): Promise<string> {
  return runPeekaboo(`${PEEKABOO_BIN} hotkey --keys ${shellQuoteInner(args.keys)}`);
}

async function actionApp(args: {
  subaction: string;
  app_name?: string;
}): Promise<string> {
  const parts = [PEEKABOO_BIN, "app", args.subaction];
  if (args.app_name) parts.push(shellQuoteInner(args.app_name));
  return runPeekaboo(parts.join(" "));
}

async function actionAgent(args: { instruction: string }): Promise<string> {
  return runPeekaboo(`${PEEKABOO_BIN} ${shellQuoteInner(args.instruction)}`);
}

/** Quote for use inside an already-quoted shell string */
function shellQuoteInner(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

registerTool({
  name: "peekaboo",
  category: "always",
  description:
    "GUI automation on the Mac Mini (stormbreaker) via Peekaboo — AI-powered screen capture, " +
    "UI element detection, clicking, typing, hotkeys, app management, and natural language agent mode. " +
    "Requires a tmux session named 'peekaboo' running on the Mac Mini's local Terminal.",
  zodSchema: {
    action: z.enum(["screenshot", "see", "click", "type", "hotkey", "app", "agent"]),
    // screenshot / see
    app_name: z.string().optional().describe("Target application name (e.g. 'Safari', 'Notes')"),
    mode: z.string().optional().describe("Capture mode: screen, window, frontmost"),
    annotate: z.boolean().optional().describe("Generate annotated screenshot with UI markers (for see)"),
    // click
    label: z.string().optional().describe("UI element label to click"),
    snapshot: z.string().optional().describe("Snapshot ID from a previous see command"),
    element_id: z.string().optional().describe("Element ID from a previous see command"),
    // type
    text: z.string().optional().describe("Text to type into the focused field"),
    // hotkey
    keys: z.string().optional().describe("Key combination (e.g. 'cmd+space', 'cmd+shift+n')"),
    // app
    subaction: z.string().optional().describe("App subaction: launch, quit, list"),
    // agent
    instruction: z.string().optional().describe("Natural language instruction for agent mode"),
  },
  jsonSchemaParameters: {
    type: "object" as const,
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["screenshot", "see", "click", "type", "hotkey", "app", "agent"],
        description: "The peekaboo action to perform",
      },
      app_name: {
        type: "string",
        description: "Target application name (e.g. 'Safari', 'Notes')",
      },
      mode: {
        type: "string",
        description: "Capture mode: screen, window, frontmost",
      },
      annotate: {
        type: "boolean",
        description: "Generate annotated screenshot with UI markers (for see)",
      },
      label: {
        type: "string",
        description: "UI element label to click",
      },
      snapshot: {
        type: "string",
        description: "Snapshot ID from a previous see command",
      },
      element_id: {
        type: "string",
        description: "Element ID from a previous see command",
      },
      text: {
        type: "string",
        description: "Text to type into the focused field",
      },
      keys: {
        type: "string",
        description: "Key combination (e.g. 'cmd+space', 'cmd+shift+n')",
      },
      subaction: {
        type: "string",
        description: "App subaction: launch, quit, list",
      },
      instruction: {
        type: "string",
        description: "Natural language instruction for agent mode",
      },
    },
  },
  execute: async (args: any): Promise<string> => {
    console.log("[peekaboo] action=%s", args.action);

    switch (args.action) {
      case "screenshot":
        return actionScreenshot({ app: args.app_name, mode: args.mode });
      case "see":
        return actionSee({ app: args.app_name, mode: args.mode, annotate: args.annotate });
      case "click":
        return actionClick({ label: args.label, snapshot: args.snapshot, element_id: args.element_id });
      case "type":
        if (!args.text) return "Error: 'text' is required for the type action.";
        return actionType({ text: args.text });
      case "hotkey":
        if (!args.keys) return "Error: 'keys' is required for the hotkey action.";
        return actionHotkey({ keys: args.keys });
      case "app":
        if (!args.subaction) return "Error: 'subaction' is required for the app action (launch, quit, list).";
        return actionApp({ subaction: args.subaction, app_name: args.app_name });
      case "agent":
        if (!args.instruction) return "Error: 'instruction' is required for the agent action.";
        return actionAgent({ instruction: args.instruction });
      default:
        return `Unknown action: ${args.action}`;
    }
  },
});
