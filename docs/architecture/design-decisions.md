---
title: Design Decisions
description: Key architectural decisions and their rationale
---

# Design Decisions

## Multi-Provider Routing

The model string determines the provider. `gpt-*`/`o3*`/`o4-*` → OpenAI, `MiniMax-*` → MiniMax, everything else → Claude. No separate "provider" config key.

## Tool Registry

`src/tools/registry.ts` — shared tool registry. Tools register once with `registerTool()`, auto-generate both OpenAI and Claude MCP formats. Generic `dispatchToolCall()` replaces per-tool if/else in providers. New tools: create file in `src/tools/`, add import to `src/tools/index.ts`, done.

All providers support `update_memory`. Claude uses MCP (in-process server). OpenAI and MiniMax use OpenAI-format function calling. All delegate to the same `executeMemoryTool()` function.

## Tool Categories

"Always" tools are available in every conversation. "Coding" tools are only sent when a project workspace is active (set via `/project` command or `WORKSPACE_ROOT` env var).

## Tool Loop Detection

`registry.ts` tracks consecutive identical tool calls (same name + first 500 chars of args). After 3 in a row, returns an error to the AI. Covers both `dispatchToolCall()` (OpenAI/MiniMax) and MCP executor (Claude). State resets between conversations via `invalidatePromptCache()`.

## Tool Turn Limit

All three providers share `config.maxToolTurns` (default 200, env `MAX_TOOL_TURNS`). Set high because SSH investigations and coding work need many turns; context compaction keeps conversations within the model's window. The "ran out of processing turns" message fires if exhausted.

## Claude Agent SDK as Primary Agent

When Claude is the active model, the bot uses the `@anthropic-ai/claude-agent-sdk` as a full agent. Claude Code's native tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, etc.) run natively — far better than hand-rolled equivalents. Custom tools (memory, SSH, scheduler, recall, journal) are exposed via an in-process MCP server using `createSdkMcpServer()`. The system prompt uses append mode (`{ type: 'preset', preset: 'claude_code', append: <identity/memory> }`) to extend Claude Code's default prompt with personality and knowledge. Session persistence via `resume` gives multi-turn conversation context without manual history management.

## Custom vs Native Tools

`registry.ts` has a `NATIVE_CLAUDE_TOOLS` set — tools Claude Code handles natively. `getCustomMcpTools()` returns only non-native tools for the Claude provider's MCP server. `getCustomMcpAllowedToolNames()` generates the corresponding allowed tool names. OpenAI/MiniMax providers still use all registered tools as before.

## Per-Schedule Tool Allowlists

Each schedule has an optional `allowedTools` field. When set, only those tools are available during execution (e.g. `["ssh", "web_search"]`). When omitted, all tools are available. Tool filtering threads through `chat()` → provider → `getOpenAiToolDefinitions()`/`getMcpAllowedToolNames()` via a `filterTools()` function in `registry.ts`.

## Persistent Conversation History

Last 20 messages per chat stored in `~/.chris-assistant/conversations.json`. Loaded lazily on first access, saved asynchronously via a write queue that serializes concurrent saves. Callers use fire-and-forget for `addMessage()` and await `clearHistory()`. Survives restarts. `/clear` wipes both memory and disk.

## Conversation Backup

`conversation-backup.ts` backs up `conversations.json` to `backups/conversations.json` in the memory repo every 6 hours. Uses SHA-256 hashing to skip unchanged content. Runs an immediate backup on startup.

## Conversation Archive

`conversation-archive.ts` appends every message (user + assistant) as a JSONL line to `~/.chris-assistant/archive/YYYY-MM-DD.jsonl` via synchronous `appendFileSync` (microseconds, never throws). Called from `addMessage()` in `conversation.ts` before the rolling window trims old messages. A periodic uploader (every 6 hours) pushes changed archive files to the memory repo using SHA-256 dedup.

## Daily Conversation Summaries

`conversation-summary.ts` is a built-in module (not a user-managed schedule — can't be accidentally deleted). Ticks every 60s, fires at 23:55 local time. Reads today's local archive, formats as conversation text, calls `chat()` with a summarization prompt, and writes the result to `conversations/summaries/YYYY-MM-DD.md` in the memory repo. On startup, backfills yesterday's summary if messages exist but no summary was generated (handles overnight restarts). Uses chatId 0 for internal system calls. Strips thinking tags from reasoning model output.

## Daily Memory Journal

The bot writes structured notes throughout the day via the `journal_entry` tool. Entries are appended to `~/.chris-assistant/journal/YYYY-MM-DD.md` as timestamped markdown. A periodic uploader (every 6 hours) pushes changed journals to the memory repo using SHA-256 dedup. Today's and yesterday's journals are loaded into the system prompt. The daily summary at 23:55 incorporates journal entries alongside raw messages for richer consolidation.

## Recent Summaries in System Prompt

`loader.ts` loads the last 7 days of daily summaries from the memory repo (in parallel with identity/knowledge/memory loads). Injected as a `# Recent Conversation History` section in `buildSystemPrompt()`. This gives the bot natural recall of recent conversations without needing a tool call.

## System Prompt Caching

Memory files are loaded from GitHub and cached for 5 minutes. Cache invalidates after any conversation (in case memory was updated). Shared across providers via `providers/shared.ts`.

## Project Bootstrap Files

`shared.ts` checks for `CLAUDE.md`, `AGENTS.md`, `README.md` (in that order) in the active workspace root. First found is loaded, truncated to 20K chars, and injected as a `# Project Context` section in the system prompt. Workspace change callback invalidates the prompt cache so bootstrap reloads for the new project.

## Workspace Root

File tools scope to `WORKSPACE_ROOT` (default `~/Projects`). Mutable at runtime via `/project` Telegram command or `setWorkspaceRoot()`. The guard in `resolveSafePath()` uses `fs.realpathSync` to canonicalize paths (following symlinks) before the boundary check — a symlink inside the workspace pointing outside it will be rejected.

## Middleware Pipeline

`src/middleware.ts` exports `authMiddleware` and `rateLimitMiddleware`, composed via `bot.use()` before all handlers. Auth guard only responds to `TELEGRAM_ALLOWED_USER_ID` (unauthorized `/start` gets a polite rejection; all others silently ignored). Rate limiter enforces 10 messages/minute sliding window.

## Health Monitor

`health.ts` sends a Telegram startup notification, runs health checks every 5 minutes (GitHub access, token expiry), and alerts the owner with dedup (1 hour re-alert) and recovery messages. Token checks use two-tier warnings: MiniMax warns 30 minutes before expiry, OpenAI warns 1 hour before (only when no refresh token). Fully expired tokens get stronger wording.

## Scheduled Tasks

`scheduler.ts` loads tasks from `~/.chris-assistant/schedules.json`, ticks every 60s, and fires matching tasks by sending the prompt to `chat()` with full tool access. Results sent to Telegram via raw fetch. Custom cron matcher supports `*`, specific values, commas, and `*/N` step values — no npm dependency. The `manage_schedule` tool lets the AI create, list, delete, and toggle schedules. Double-fire prevention checks that `lastRun` wasn't in the same minute.

## Memory Storage

Markdown files in a private GitHub repo. Every update is a git commit — fully auditable and rollback-able.

## pm2 Process Management

The bot runs as a pm2 process. The CLI uses pm2's programmatic API. pm2 can't find `tsx` via PATH so we use the absolute path from `node_modules/.bin/tsx` as the interpreter.

## CLI Global Install

`npm link` creates a global `chris` command. The `bin/chris` shell wrapper follows symlinks to resolve the real project root and finds tsx from node_modules.
