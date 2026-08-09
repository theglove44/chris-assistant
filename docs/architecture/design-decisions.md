---
title: Design Decisions
description: Key architectural decisions and their rationale
---

# Design Decisions

## Multi-Provider Routing

One central registry maps every accepted model and alias to OpenAI Responses, Codex Agent, Grok Agent, or DeepSeek. Unknown values fail startup validation; there is no catch-all provider. The registry also owns capabilities, context limits, and valid reasoning-effort values.

## Tool Registry

`src/tools/registry.ts` is the shared text-tool registry. Tools register once and expose OpenAI-compatible definitions to OpenAI Responses and DeepSeek. Codex and Grok receive only explicitly bridged agent tools.

OpenAI Responses and DeepSeek support direct guarded memory writes through the shared function-tool path. Codex receives injected identity and recalled context but no direct memory tools. Grok currently receives neither private memory context nor direct memory tools.

## Tool Categories

"Always" tools are available in every conversation. "Coding" tools are only sent when a project workspace is active (set via `/project` command or `WORKSPACE_ROOT` env var).

## Tool Loop Detection

`registry.ts` tracks consecutive identical shared-tool calls. After three in a row it returns an error to the provider. State resets between conversations via `invalidatePromptCache()`.

## Tool Turn Limit

Shared-loop providers use `config.maxToolTurns`. CLI agents use their own bounded-turn and elapsed-time controls. Every provider must expose cancellation.

## Shared tools vs agent-native tools

OpenAI Responses and DeepSeek use the guarded shared tool registry. Codex and Grok are agent-native workspace providers. Their sandbox and process controls are part of the security boundary, and they do not receive live private runtime data by default.

## Per-Schedule Tool Allowlists

Each schedule has an optional `allowedTools` field. When set, only those tools are available during execution (e.g. `["ssh", "web_search"]`). When omitted, all tools are available. Tool filtering threads through `chat()` → provider → `getOpenAiToolDefinitions()`/`getMcpAllowedToolNames()` via a `filterTools()` function in `registry.ts`.

## Agent sandbox policy

Codex and Grok must run with explicit workspaces, non-bypass permissions, bounded execution, cancellation, and secret-free environments. A command deny-list is supplementary; it is not a substitute for the sandbox boundary.

## Persistent Conversation History

Last 20 messages per chat stored in `~/.chris-assistant/conversations.json`. Loaded lazily on first access, saved asynchronously via a write queue that serializes concurrent saves. Callers use fire-and-forget for `addMessage()` and await `clearHistory()`. Survives restarts. `/clear` wipes both memory and disk.

## Conversation Backup

`conversation-backup.ts` backs up `conversations.json` to `backups/conversations.json` in the memory repo every 6 hours. Uses SHA-256 hashing to skip unchanged content. Runs an immediate backup on startup.

## Conversation Archive

`conversation-archive.ts` appends every message (user + assistant) as a JSONL line to `~/.chris-assistant/archive/YYYY-MM-DD.jsonl` via synchronous `appendFileSync` (microseconds, never throws). Called from `addMessage()` in `conversation.ts` before the rolling window trims old messages. A periodic uploader (every 5 minutes) pushes changed archive files to the memory repo using SHA-256 dedup.

## Daily Conversation Summaries

`conversation-summary.ts` is a built-in module (not a user-managed schedule — can't be accidentally deleted). Ticks every 60s, fires at 23:55 local time. Reads today's local archive, formats as conversation text, calls `chat()` with a summarization prompt, and writes the result to `conversations/summaries/YYYY-MM-DD.md` in the memory repo. On startup, backfills yesterday's summary if messages exist but no summary was generated (handles overnight restarts). Uses chatId 0 for internal system calls. Strips thinking tags from reasoning model output.

## Daily Memory Journal

The bot writes structured notes throughout the day via the `journal_entry` tool. Entries are appended to `~/.chris-assistant/journal/YYYY-MM-DD.md` as timestamped markdown. A periodic uploader (every 6 hours) pushes changed journals to the memory repo using SHA-256 dedup. Today's and yesterday's journals are loaded into the system prompt. The daily summary at 23:55 incorporates journal entries alongside raw messages for richer consolidation.

## Recent Summaries in System Prompt

`loader.ts` loads the last 7 days of daily summaries from the memory repo in parallel with the canonical identity, user, and memory files. Injected as a `# Recent Conversation History` section in `buildSystemPrompt()`. This gives the bot natural recall of recent conversations without needing a tool call.

## System Prompt Caching

Memory files are loaded from GitHub and cached for 5 minutes. Cache invalidates after any conversation (in case memory was updated). Shared across providers via `providers/shared.ts`.

## Project Bootstrap Files

The prompt loader checks provider-neutral project guidance such as `AGENTS.md` and `README.md`, truncates it to a safe limit, and injects it as project context. Workspace changes invalidate the prompt cache.

## Workspace Root

File tools scope to `WORKSPACE_ROOT` (default `~/Projects`). Mutable at runtime via `/project` Telegram command or `setWorkspaceRoot()`. The guard in `resolveSafePath()` uses `fs.realpathSync` to canonicalize paths (following symlinks) before the boundary check — a symlink inside the workspace pointing outside it will be rejected.

## Middleware Pipeline

`src/middleware.ts` exports `authMiddleware` and `rateLimitMiddleware`, composed via `bot.use()` before all handlers. Auth guard only responds to `TELEGRAM_ALLOWED_USER_ID` (unauthorized `/start` gets a polite rejection; all others silently ignored). Rate limiter enforces 10 messages/minute sliding window.

## Health Monitor

`health.ts` sends a Telegram startup notification and runs periodic GitHub/provider readiness checks with deduplicated recovery alerts. Diagnostics report presence and expiry state, never credential values.

## Scheduled Tasks

`scheduler.ts` loads tasks from `~/.chris-assistant/schedules.json`, ticks every 60s, and fires matching tasks by sending the prompt to `chat()` with full tool access. Results sent to Telegram via raw fetch. Custom cron matcher supports `*`, specific values, commas, and `*/N` step values — no npm dependency. The `manage_schedule` tool lets the AI create, list, delete, and toggle schedules. Double-fire prevention checks that `lastRun` wasn't in the same minute.

## Dynamic Skills System

`src/skills/` + `src/tools/skills.ts` — reusable workflows defined as JSON in the memory repo (`skills/<id>.json`). Skills are NOT registered as dynamic tools in the registry. Instead, two static tools handle everything: `manage_skills` (CRUD: create, list, get, update, delete, toggle, update_state) and `run_skill` (execution).

**Discovery**: Skill index loaded into system prompt alongside memory. Only enabled skills with non-empty triggers are shown (capped at 20 to prevent prompt bloat). AI sees available skills and can proactively suggest them.

**Execution**: `run_skill` loads the full skill definition, validates inputs, substitutes `{placeholder}` values in instructions, and calls `chat(0, prompt, undefined, undefined, skill.tools)` with filtered tool access. Same nested-`chat()` pattern the scheduler uses.

**Why not register skills as real tools**: The registry is designed for stable startup definitions. `run_skill` remains a stable entry point without regenerating provider tool schemas mid-conversation.

**Guardrails**: 50 skill cap, 5000 char instruction limit, 10KB state cap, tool names validated against registry, input keys constrained to `[a-zA-Z0-9_-]+`, per-entry resilience in system prompt parsing.

## Discord Bot

`src/discord.ts` — discord.js `Client` with `Guilds`, `GuildMessages`, `MessageContent`, `DirectMessages` intents + `Partials.Channel` for DMs. Restricted to `DISCORD_ALLOWED_USER_ID`. Calls `chat()` directly (no streaming — Discord doesn't support live message edits cleanly). Strips `<think>` tags, converts headers to bold via `toDiscordMarkdown()`, splits at 2000 char limit. Discord channelIds use `parseInt(channelId.slice(-9), 10)` as numeric chatId for conversation tracking. Silently skips startup if `DISCORD_BOT_TOKEN` unset.

## Web Dashboard

`src/dashboard.ts` — built-in HTTP server using Node's `http` module (zero new deps). Single HTML page with all CSS/JS inlined as template strings. 5 tabs: Status & Health, Schedules, Conversations, Memory, Logs (SSE tail via `fs.watch`). JSON API at `/api/*`. Auth via `DASHBOARD_TOKEN` env var (Bearer/query param for Tailnet access) or localhost-only. Port via `DASHBOARD_PORT` (default 3000). Gracefully handles port-in-use.

## GitHub Webhook Server

`src/webhook.ts` — HTTP server for GitHub webhook events. Verifies HMAC signatures via `GITHUB_WEBHOOK_SECRET`. On PR merge events, posts a notification to a configured Discord channel with PR title, author, and link. Port via `WEBHOOK_PORT` (default 3001). Silently skips startup if `GITHUB_WEBHOOK_SECRET` unset.

## Weekly Memory Consolidation

`src/memory-consolidation.ts` — built-in module, fires Sunday at 23:00. Reads `USER.md`, memory files, past 7 days of summaries and journal entries, plus existing `memory/SUMMARY.md`. Produces a curated, topic-organized markdown document (32K cap). SUMMARY.md is a read-only consolidated view; `USER.md` and `memory/learnings.md` remain the writable source files for `update_memory`.

## Weekly Channel Summaries

`src/conversation-channel-summary.ts` — built-in module, fires Sunday at 23:50. Groups past 7 days of archives by `channelName`, generates per-channel Discord summaries. Written to `conversations/channels/<sanitized-name>/YYYY-WXX.md`. ISO week numbering with double-fire prevention.

## Heartbeat

`src/heartbeat.ts` — writes `HEARTBEAT.md` to memory repo root every 3 hours (+ startup). Collects uptime, model, health status, schedules, message stats. SHA-256 dedup skips unchanged writes. Reads `conversations.json` directly via `fs` to avoid circular deps.

## Memory Storage

Markdown files in a private GitHub repo. Every update is a git commit — fully auditable and rollback-able.

## pm2 Process Management

The bot runs as a pm2 process. The CLI uses pm2's programmatic API. pm2 can't find `tsx` via PATH so we use the absolute path from `node_modules/.bin/tsx` as the interpreter.

## CLI Global Install

`npm link` creates a global `chris` command. The `bin/chris` shell wrapper follows symlinks to resolve the real project root and finds tsx from node_modules.
