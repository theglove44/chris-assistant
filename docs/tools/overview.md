---
title: Tools Overview
description: AI tool registry and available tools
---

# Tools Overview

The assistant has access to a set of tools that all providers pick up automatically via the shared tool registry.

## Tool Registry

`src/tools/registry.ts` provides a shared registration system. Tools register once with `registerTool()` and automatically generate both OpenAI and Claude MCP format definitions. Generic `dispatchToolCall()` handles execution for all providers.

## Available Tools

| Tool | Category | Description |
|------|----------|-------------|
| `update_memory` | Always | Persist facts to GitHub memory repo |
| `web_search` | Always | Search the web via Brave Search API (optional — needs API key) |
| `fetch_url` | Always | Read any URL with HTML stripping, 15s timeout, 50KB truncation |
| `run_code` | Always | Execute JS, TS, Python, or shell commands (10s timeout) |
| `manage_schedule` | Always | Create, list, delete, or toggle cron-scheduled tasks |
| `recall_conversations` | Always | List, read, search, and summarize past conversations |
| `journal_entry` | Always | Write daily journal notes |
| `read_file` | Coding | Read a file from the active workspace |
| `write_file` | Coding | Write a file to the active workspace |
| `edit_file` | Coding | Exact-match find-and-replace edit within a file |
| `list_files` | Coding | List files with glob pattern matching (excludes node_modules/.git) |
| `search_files` | Coding | Search file contents with grep (optional glob filter) |
| `git_status` | Coding | Show git status of the active workspace |
| `git_diff` | Coding | Show git diff (staged or unstaged) |
| `git_commit` | Coding | Stage files and commit (no push — safety choice) |
| `manage_skills` | Always | Create, list, get, update, delete, toggle, and manage reusable skills |
| `run_skill` | Always | Execute a skill by ID with optional inputs |
| `ssh` | Always | SSH into Tailnet devices — 9 actions ([full guide](/tools/ssh)) |
| `market_snapshot` | Always | SSH to Mac Mini to run tasty-coach for market data |
| `macos_calendar` | Always | macOS Calendar via native EventKit — list, get, add, delete events (~300ms) |
| `macos_mail` | Always | macOS Mail via AppleScript — inbox summary, recent messages, search |

**"Always"** tools are available in every conversation. **"Coding"** tools are only sent when a project workspace is active (set via `/project` command or `WORKSPACE_ROOT` env var).

The `macos_calendar` and `macos_mail` tools are **macOS-only** — they only register when `process.platform === "darwin"`. See [macOS tools guide](macos.md) for setup and TCC permissions.

## Skills vs Tools

Skills are higher-level — they're JSON definitions that compose existing tools into reusable workflows. Use `manage_skills` to create them at runtime (no code changes, no restart). New tools require TypeScript in `src/tools/` and a restart.

## Adding New Tools

1. Create `src/tools/<name>.ts` with a `registerTool()` call
2. Add `import "./<name>.js"` to `src/tools/index.ts`
3. All three providers pick it up automatically — no provider code changes needed

## Loop Detection

The registry tracks consecutive identical tool calls (same name + first 500 chars of args). After 3 identical calls in a row, returns an error message telling the AI to try a different approach. Covers both OpenAI/MiniMax dispatch and Claude MCP execution. State resets between conversations.
