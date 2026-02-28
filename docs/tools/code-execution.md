---
title: Code Execution
description: The run_code tool for executing code in multiple languages
---

# Code Execution

`src/tools/run-code.ts` — executes code in multiple languages via `child_process.execFile`.

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `language` | Yes | One of: `javascript`, `typescript`, `python`, `shell` |
| `code` | Yes | Code to execute |

## Supported Languages

| Language | Execution method |
|----------|-----------------|
| JavaScript | `node -e <code>` |
| TypeScript | tsx binary from node_modules |
| Python | `python3 -c <code>` |
| Shell | `bash -c <code>` |

## Limits

- **Timeout**: 10 seconds
- **Buffer**: 1MB
- **Output truncation**: 50KB
- **Working directory**: `getWorkspaceRoot()` (matches file tools)

## Security

### No shell injection

Uses `child_process.execFile` (not `exec`) — arguments are passed as an array, never through a shell interpreter.

### Environment sanitization

Env vars are allowlisted (`SAFE_ENV_KEYS`): PATH, HOME, SHELL, LANG, TMPDIR, etc. Everything else is stripped. New secrets added to `.env` are automatically excluded without code changes.

`NODE_NO_WARNINGS=1` is set to suppress Node.js experimental feature warnings.

::: warning Not sandboxed
Code runs with the bot's user privileges. There is no containerization or OS-level sandboxing.
:::
