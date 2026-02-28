---
title: SSH & Remote Access
description: SSH tool for remote device management via Tailscale
---

# SSH & Remote Access

The SSH tool gives your AI assistant the ability to reach into any device on your Tailscale network. It can run commands, hold persistent terminal sessions, transfer files, and discover what's online — all through natural language via Telegram.

By default, commands run as plain one-shot SSH commands (no tmux).

If you explicitly start a tmux session, the bot will keep that session around on the Mac Mini so you can attach to it later (even from an iPhone over SSH).

## Quick Examples

| What you tell the bot | What happens |
|------------------------|-------------|
| "List my Tailnet devices" | Runs `tailscale status --json`, returns a formatted device list |
| "Run `uptime` on mediaserver" | Runs `ssh mediaserver uptime` and returns the output |
| "What's the disk usage on nas?" | Runs `ssh nas 'df -h'`, waits for output, returns it |
| "Start a tmux session on mediaserver" | Starts/ensures a persistent tmux session, SSHs into mediaserver, returns the session profile |
| "Send Ctrl-C to that session" | `send_keys` with `C-c` to interrupt a running process |
| "Copy README.md to mediaserver at /tmp/" | `scp_push` from workspace to remote |
| "Pull /var/log/syslog from gateway" | `scp_pull` from remote into workspace |

## Actions Reference

The `ssh` tool is a single tool with 9 actions, selected via the `action` parameter.

### `exec` — Run a command on a remote host

Runs a one-shot SSH command (no tmux). Use this for non-interactive commands where you just want the output back.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `host` | Yes | — | Tailnet hostname or IP |
| `command` | Yes | — | Command to run |
| `timeout` | No | 60s (max 300s) | How long to wait for the command to finish |

### `start_tmux_session` — Start (or reuse) a persistent tmux-backed SSH session

Creates (or reuses) a tmux session on the bot machine, SSHs into the remote host inside it, and returns a session profile you can use with `send_keys` / `read_pane` / `kill_session`.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `host` | Yes | — | Tailnet hostname or IP |
| `session` | No | `jarvis` | Tmux session name |

### `send_keys` — Send keystrokes to a tmux session

Sends arbitrary keystrokes to an existing tmux session.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `session` | Yes | Tmux session name |
| `keys` | Yes | Keystrokes to send |

**Key examples**: `C-c` (Ctrl-C), `C-d` (Ctrl-D), `"yes" Enter`, `q`, `C-z`.

### `read_pane` — Read tmux pane content

Captures the current visible content of a tmux session without sending any input.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `session` | Yes | — | Tmux session name |
| `lines` | No | 100 (max 2000) | Number of lines to capture from scrollback |

### `devices` — List Tailnet devices

Queries `tailscale status --json` and returns a formatted list of all devices on the network.

No parameters required.

### `sessions` — List active tmux sessions

Lists tmux sessions used by the SSH tool.

No parameters required.

### `kill_session` — Terminate a tmux session

Kills a tmux session.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `session` | Yes | Tmux session name |

### `scp_push` — Copy a local file to a remote host

Transfers a file from the local workspace to a remote device via SCP.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `host` | Yes | Tailnet hostname or IP |
| `local_path` | Yes | Path relative to workspace root |
| `remote_path` | Yes | Absolute path on the remote host |

### `scp_pull` — Copy a remote file to the local workspace

Transfers a file from a remote device into the local workspace via SCP.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `host` | Yes | Tailnet hostname or IP |
| `remote_path` | Yes | Absolute path on the remote host |
| `local_path` | Yes | Path relative to workspace root |

## How It Works

### Architecture

```
Telegram message
  → AI decides to use ssh tool
  → Action dispatcher (src/tools/ssh.ts)
  → execFile() calls to system binaries
  → ssh / scp connect to Tailnet devices
  → tmux (optional) manages persistent sessions

System binaries (absolute paths for pm2):
  /usr/bin/ssh             — OpenSSH client
  /usr/bin/scp             — Secure copy
  /opt/homebrew/bin/tmux    — Terminal multiplexer (only needed for tmux actions)
  /usr/local/bin/tailscale  — Tailscale CLI
```

### SSH Options

Every SSH and SCP connection uses these options:

| Option | Purpose |
|--------|---------|
| `-o BatchMode=yes` | Never prompt for a password — fail immediately if key auth doesn't work |
| `-o ConnectTimeout=10` | Fail fast if the host is unreachable |
| `-o StrictHostKeyChecking=accept-new` | Auto-accept host keys for new hosts, but reject changed keys |

## Attaching from iPhone (tmux mode only)

If you started a tmux session, you can attach to it from any device.

From your iPhone (using an SSH client like Termius, Blink, or a]Shell):

```bash
# SSH into the Mac Mini
ssh macmini

# List sessions
tmux list-sessions

# Attach to the jarvis session
tmux attach -t jarvis
```

## Safety

### No shell injection

All commands are executed via Node.js `execFile()`, which passes arguments as an array — never through a shell.

### Local path sandboxing

SCP operations validate local paths through `resolveSafePath()` — they must resolve within the workspace root. Symlink escapes are rejected.

### No password prompts

`BatchMode=yes` ensures SSH never prompts for a password.
