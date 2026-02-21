# SSH Tool — Remote Device Management

The SSH tool gives your AI assistant the ability to reach into any device on your Tailscale network. It can run commands, hold persistent terminal sessions, transfer files, and discover what's online — all through natural language via Telegram.

Every command runs inside a **persistent tmux session** on the Mac Mini. These sessions survive disconnects and can be attached to from any device — including an iPhone over SSH. Ask the bot to start a build on your server, then pick it up on your phone while you're away from your desk.

## Quick Examples

| What you tell the bot | What happens |
|------------------------|-------------|
| "List my Tailnet devices" | Runs `tailscale status --json`, returns a formatted device list |
| "Run `htop` on mediaserver" | SSHs into mediaserver in a tmux session, sends the command |
| "What's the disk usage on nas?" | `exec` with `df -h`, waits for output, returns it |
| "Copy README.md to mediaserver at /tmp/" | `scp_push` from workspace to remote |
| "Pull /var/log/syslog from gateway" | `scp_pull` from remote into workspace |
| "Show active SSH sessions" | Lists all `chris-bot-*` tmux sessions |
| "Kill the mediaserver session" | Terminates the tmux session |
| "Send Ctrl-C to that session" | `send_keys` with `C-c` to interrupt a running process |

## Actions Reference

The `ssh` tool is a single tool with 8 actions, selected via the `action` parameter.

### `exec` — Run a command on a remote host

Creates (or reuses) a persistent tmux session, SSHs into the host, runs the command, and polls until the output stabilizes or the timeout is reached.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `host` | Yes | — | Tailnet hostname or IP |
| `command` | Yes | — | Command to run |
| `task_id` | No | Random 6-char hex | ID suffix for the tmux session name |
| `timeout` | No | 60s (max 300s) | How long to wait for the command to finish |

**Session naming**: `chris-bot-<host>-<task_id>` (dots and colons in hostname are replaced with hyphens).

**Completion detection**: The tool polls every 1 second, capturing the tmux pane. A command is considered "done" when two consecutive captures are identical and the last non-empty line ends with a shell prompt character (`$`, `#`, `%`, or `>`). If the timeout is reached first, the captured output is returned with a note that the command may still be running.

**Session reuse**: If a session with the same name already exists, the tool reuses it instead of creating a new one. This means you can run multiple commands in the same session by providing a consistent `task_id`.

### `send_keys` — Send keystrokes to a tmux session

Sends arbitrary keystrokes to an existing session. Useful for interactive commands, canceling processes, or providing input.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `session` | Yes | Tmux session name (must start with `chris-bot-`) |
| `keys` | Yes | Keystrokes to send |

**Key examples**: `C-c` (Ctrl-C), `C-d` (Ctrl-D), `"yes" Enter`, `q`, `C-z`.

Returns the pane content after sending the keys.

### `read_pane` — Read tmux pane content

Captures the current visible content of a tmux session without sending any input.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `session` | Yes | — | Tmux session name (must start with `chris-bot-`) |
| `lines` | No | 100 (max 2000) | Number of lines to capture from scrollback |

### `devices` — List Tailnet devices

Queries `tailscale status --json` and returns a formatted list of all devices on the network with hostname, IP address, OS, and online status.

No parameters required.

**Output format**:
```
* macmini — 100.64.1.1 (macOS, online) [this device]
* mediaserver — 100.64.1.2 (linux, online)
  nas — 100.64.1.3 (linux, offline)
* iphone — 100.64.1.4 (iOS, online)
```

Online devices are marked with `*`. The device running the bot is labeled `[this device]`.

### `sessions` — List active SSH sessions

Lists all tmux sessions with the `chris-bot-` prefix, showing session name and creation time.

No parameters required.

### `kill_session` — Terminate a tmux session

Kills a tmux session. Only sessions with the `chris-bot-` prefix can be killed — this prevents accidentally destroying user sessions.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `session` | Yes | Tmux session name (must start with `chris-bot-`) |

### `scp_push` — Copy a local file to a remote host

Transfers a file from the local workspace to a remote device via SCP.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `host` | Yes | Tailnet hostname or IP |
| `local_path` | Yes | Path relative to workspace root |
| `remote_path` | Yes | Absolute path on the remote host |

The local path is validated through `resolveSafePath()` — it must resolve to a location within the workspace root. Symlink escapes are rejected.

### `scp_pull` — Copy a remote file to the local workspace

Transfers a file from a remote device into the local workspace via SCP.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `host` | Yes | Tailnet hostname or IP |
| `remote_path` | Yes | Absolute path on the remote host |
| `local_path` | Yes | Path relative to workspace root |

Same local path validation as `scp_push`.

## How It Works

### Architecture

```
Telegram message
  → AI decides to use ssh tool
  → Action dispatcher (src/tools/ssh.ts)
  → execFile() calls to system binaries
  → tmux manages persistent sessions
  → SSH connects to Tailnet devices

System binaries (absolute paths for pm2):
  /usr/bin/ssh          — OpenSSH client
  /usr/bin/scp          — Secure copy
  /opt/homebrew/bin/tmux — Terminal multiplexer
  /usr/local/bin/tailscale — Tailscale CLI
```

### The `exec` Flow

```
1. Generate session name: chris-bot-<host>-<task_id>

2. Check if session exists (tmux has-session)
   → Yes: reuse it
   → No: create new session with SSH connection
      tmux new-session -d -s <name> -x 200 -y 50 -- ssh [opts] <host>
      Wait 2s for SSH handshake

3. Send the command
   tmux send-keys -t <name> '<command>' Enter

4. Poll loop (every 1s until timeout):
   tmux capture-pane -t <name> -p
   → If two consecutive captures are identical
     AND last non-empty line ends with $ # % >
     → Command is done, return output
   → If timeout reached
     → Return output + "[command may still be running]"

5. Truncate output at 50KB if needed
```

### SSH Options

Every SSH and SCP connection uses these options:

| Option | Purpose |
|--------|---------|
| `-o BatchMode=yes` | Never prompt for a password — fail immediately if key auth doesn't work |
| `-o ConnectTimeout=10` | Fail fast if the host is unreachable |
| `-o StrictHostKeyChecking=accept-new` | Auto-accept host keys for new hosts, but reject changed keys (protects against MITM) |

### Timeouts

| Operation | Timeout | Reason |
|-----------|---------|--------|
| `exec` | 60s default, 300s max | Remote commands can be slow (builds, installs, updates) |
| `send_keys` | 10s | Local tmux command, always fast |
| `read_pane` | 10s | Local tmux command, always fast |
| `devices` | 10s | Local Tailscale query |
| `sessions` | 10s | Local tmux query |
| `kill_session` | 10s | Local tmux command |
| `scp_push` / `scp_pull` | 120s | File transfers over Tailnet can be large |
| SSH connection | 10s | Built into `ConnectTimeout` |

## Attaching from iPhone

One of the key features: tmux sessions persist on the Mac Mini, so you can attach to them from any device.

From your iPhone (using an SSH client like Termius, Blink, or a]Shell):

```bash
# SSH into the Mac Mini
ssh macmini

# List bot sessions
tmux list-sessions | grep chris-bot

# Attach to a session
tmux attach -t chris-bot-mediaserver-a1b2c3
```

You'll see exactly what the bot saw — the full terminal output, scrollback, and any running processes. You can interact with the session directly, then detach (`Ctrl-B d`) and let the bot continue using it later.

## Safety

### No shell injection

All commands are executed via Node.js `execFile()`, which passes arguments as an array — never through a shell. There is no way for a malicious command string to escape into shell metacharacters.

### Local path sandboxing

SCP operations validate local paths through the same `resolveSafePath()` used by the file tools. Paths must resolve within the workspace root (`~/Projects` by default). Symlinks that point outside the workspace are rejected.

### Session isolation

The `kill_session` action enforces the `chris-bot-` prefix. The bot cannot accidentally (or intentionally) kill user tmux sessions, development sessions, or anything else.

### No password prompts

`BatchMode=yes` ensures SSH never prompts for a password. If key-based auth isn't configured for a host, the connection fails immediately rather than hanging.

### Remote paths are unrestricted

Remote paths (on the target device) are not sandboxed — the bot operates with whatever SSH user permissions are configured. This is intentional: the remote device's own file permissions are the security boundary.

## Prerequisites

The bot runs on a Mac Mini with these already configured:

- **Tailscale** installed and logged in (devices are reachable by hostname)
- **SSH keys** configured for passwordless access to Tailnet devices
- **tmux** installed via Homebrew
- All binaries at their expected absolute paths

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Error getting Tailscale status" | Tailscale not running | `tailscale up` on the Mac Mini |
| SSH hangs / no output | Key auth not set up for host | Add SSH key: `ssh-copy-id <host>` |
| "session not found" | Session was killed or expired | Use `exec` to create a new one |
| Command never completes | Output doesn't end with a prompt char | Use `read_pane` to check, `send_keys` with `C-c` to cancel |
| SCP fails with "access denied" | Local path outside workspace | Use a path relative to workspace root |
| tmux binary not found | Different Homebrew prefix | Update `TMUX_BIN` in `src/tools/ssh.ts` |
