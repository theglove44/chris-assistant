# Architecture Internals — Detailed Reference

This document contains the full implementation details for every module in the codebase. Referenced from `CLAUDE.md` for on-demand lookup when working on specific subsystems.

## Full File Tree

The codebase was refactored into layered modules. The top-level shape now looks like this:

```txt
chris-assistant/
├── bin/chris
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── app/                  # bootstrap, lifecycle, service registry
│   ├── agent/                # ChatService, session persistence helpers
│   ├── channels/             # telegram/, discord/
│   ├── domain/               # conversations/, memory/, schedules/
│   ├── infra/                # config/, storage/
│   ├── providers/            # Claude, OpenAI, Codex Agent, MiniMax
│   ├── tools/                # tool platform + tool modules
│   ├── dashboard/            # runtime + UI template
│   ├── skills/
│   ├── symphony/
│   ├── cli/
│   └── swift/
```

Important note: several legacy top-level files still exist as compatibility facades (`telegram.ts`, `discord.ts`, `dashboard.ts`, `scheduler.ts`, `conversation*.ts`, `memory/*`). They delegate into the new structure and are kept to reduce import churn.

```txt
chris-assistant-memory/       ← Separate private repo (the brain)
├── HEARTBEAT.md              # Bot self-reported status snapshot (updated every 3h by heartbeat.ts)
├── identity/SOUL.md          # Personality, purpose, onboarding instructions
├── identity/RULES.md         # Hard boundaries
├── identity/VOICE.md         # Tone and language
├── knowledge/about-chris.md  # Facts about Chris
├── knowledge/preferences.md  # Likes, dislikes, style
├── knowledge/projects.md     # Current work
├── knowledge/people.md       # People mentioned
├── memory/decisions.md       # Important decisions
├── memory/learnings.md       # Self-improvement notes
├── memory/SUMMARY.md         # Weekly-consolidated curated summary
├── archive/YYYY-MM-DD.jsonl  # Daily JSONL message logs (uploaded every 30 minutes)
├── journal/YYYY-MM-DD.md     # Bot's daily journal notes (uploaded every 6 hours)
├── conversations/summaries/YYYY-MM-DD.md  # AI-generated daily conversation summaries
├── conversations/channels/<name>/YYYY-WXX.md  # Weekly per-channel summaries
└── skills/                       # Reusable skill definitions (JSON)
    ├── _index.json               # Lightweight skill index for system prompt discovery
    └── *.json                    # Individual skill definitions
```
## Provider Details

### Claude Agent SDK

The bot uses `@anthropic-ai/claude-agent-sdk` as a full agent when Claude is the active model. Claude Code's native tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, etc.) run natively — far better than hand-rolled versions. Custom tools (memory, SSH, scheduler, recall, journal, market_snapshot) are exposed via an in-process MCP server.

The system prompt uses `{ type: 'preset', preset: 'claude_code', append: <identity/memory> }` to extend Claude Code's default prompt with personality and knowledge. Session persistence via `resume` gives multi-turn conversation context without manual history management. Extended thinking is keyword-triggered ("think" → 10k tokens, "think hard" → 50k). Authenticated through Max subscription via the `claude` CLI (same auth Claude Code uses).

Telegram commands: `/stop` aborts the active query via AbortController, `/session` shows the active session ID, `/clear` resets both conversation history and Claude session.

### OpenAI (Codex Responses API)

Raw fetch to `chatgpt.com/backend-api/codex/responses` with ChatGPT OAuth. Streams via SSE (`response.output_text.delta` events).

**API constraints**: Requires `stream: true` and `store: false` in every request — there is no non-streaming mode. Headers must include `chatgpt-account-id` and `OpenAI-Beta: responses=experimental`. Only GPT-5.x models work; older models return a 400 error. Tool definitions use a flat format (`{ type, name, description, parameters }`) instead of the nested Chat Completions format.

**OAuth**: Authorization code + PKCE flow — opens browser to `auth.openai.com/oauth/authorize`, local callback server on port 1455 catches the redirect, exchanges code for tokens. Account ID extracted from JWT (`payload["https://api.openai.com/auth"].chatgpt_account_id`). Tokens auto-refresh via refresh_token grant. Tokens + account ID in `~/.chris-assistant/openai-auth.json`.

### MiniMax

Uses the `openai` npm package with custom baseURL (`https://api.minimax.io/v1`). Streams via the OpenAI SDK.

**OAuth**: Device flow — the `/oauth/code` endpoint requires `response_type: "code"` in the body. The `expired_in` field is a unix timestamp in **milliseconds** (not a duration). Token poll responses use a `status` field (`"success"` / `"pending"` / `"error"`) — don't rely on HTTP status codes. Tokens stored in `~/.chris-assistant/minimax-auth.json`.

### Context Compaction

`providers/compaction.ts` summarizes older conversation turns when approaching the model's context window limit (70% threshold, defined in `providers/context-limits.ts`). OpenAI compaction parses SSE responses (`compactCodexInput()`). MiniMax compaction uses the OpenAI SDK (`compactMessages()`).

## Web Dashboard

`src/dashboard/` now contains the implementation split by concern:
- `runtime.ts` — HTTP server, auth, API routing, SSE log stream
- `ui.ts` — inlined HTML/CSS/JS template

`src/dashboard.ts` remains as a thin façade over those modules.

**Tabs**: Status & Health (uptime, model, pm2 stats, health check indicators), Schedules (cron jobs with config/lastRun/tools), Conversations (browse archives by date, daily summaries), Memory (view/edit GitHub memory files), Logs (real-time SSE tail of pm2 logs via `fs.watch`).

**API**: JSON endpoints at `/api/*` power the frontend. Auth: if `DASHBOARD_TOKEN` env var is set, requires token via query param or Bearer header; otherwise localhost-only. Port configurable via `DASHBOARD_PORT` (default 3000). Gracefully handles port-in-use.

**UI components**: toast notifications (`showToast(msg, type)` — success/error/info, auto-dismiss 3s, bottom-right), designed empty states (icon + heading + description per tab), skeleton loaders (shimmer animation), top-of-page progress bar (reference-counted via `progressCount`), CSS-only tooltips (`[data-tooltip]`), inline alert banners for failing health checks, segmented control (`Live | Snapshot` in Logs tab), unified `.badge-pill` class system (success/error/neutral/accent variants), right-side drawer for schedule editor (480px slide-in with `drawerCloseTimer` race condition protection).

**CSS placement**: New CSS goes after `.progress-bar.done` and before `.flex-between` in the style block.

## Discord Bot

Discord is now implemented under `src/channels/discord/`:
- `client.ts` — shared discord.js client
- `handlers.ts` — inbound message handling
- `channels.ts` — configured channel/category provisioning
- `messaging.ts` — outbound channel posting
- `formatting.ts` — chunking + markdown conversion

`src/discord.ts` remains as a thin façade for start/stop/send exports.

Shows typing indicator via `sendTyping()` (guarded with `"sendTyping" in message.channel` for `PartialGroupDMChannel` compat). No streaming (Discord API doesn't support live edits cleanly). Strips `<think>` tags. Converts Markdown headers to Discord bold via `toDiscordMarkdown()`. Splits at 2000 char limit. Fallback: `stripMarkdown()` if reply fails.

Discord channelIds are strings — uses `parseInt(channelId.slice(-9), 10)` as numeric chatId for conversation tracking. Silently skips startup if `DISCORD_BOT_TOKEN` not set.

## Telegram Bot

Telegram is now implemented under `src/channels/telegram/`:
- `bot.ts` — bot creation + file download helper
- `commands.ts` — command registration
- `handlers.ts` — text/photo/document handling + streaming updates
- `index.ts` — transport entrypoint

`src/telegram.ts` remains as a thin façade.

## Conversation System

### Persistent History
Last 20 messages per chat in `~/.chris-assistant/conversations.json`. Loaded lazily, saved async via write queue. Fire-and-forget `addMessage()`, await `clearHistory()`. Metadata (`{ source?, channelName? }`) passed through to archive. `/clear` wipes history + Claude session. `/purge` also redacts today's archive.

### Archive
`conversation-archive.ts` — sync `appendFileSync` to `~/.chris-assistant/archive/YYYY-MM-DD.jsonl`. Each entry has optional `source` and `channelName` fields. Uploads to GitHub every 30 minutes (SHA-256 dedup). Exports: `readLocalArchive()`, `listLocalArchiveDates()`, `datestamp()`, `localArchivePath()`, `uploadArchives()`, `redactArchiveEntries()`.

### Daily Summaries
`conversation-summary.ts` — fires at 23:55 local time. Reads today's archive, calls `chat()` with summarization prompt, writes to `conversations/summaries/YYYY-MM-DD.md` in memory repo. Backfills yesterday on startup if missing.

### Weekly Channel Summaries
`conversation-channel-summary.ts` — fires Sunday at 23:50. Groups past 7 days by `channelName`, generates per-channel summaries. Written to `conversations/channels/<sanitized-name>/YYYY-WXX.md`. ISO week numbering.

### Recent Summaries in Prompt
`loader.ts` loads last 7 days of daily summaries and injects as `# Recent Conversation History` section.

### Backup
`conversation-backup.ts` — backs up `conversations.json` to GitHub every 6 hours (SHA-256 dedup). Immediate backup on startup.

### Purge
`/purge` clears rolling window, resets Claude session, redacts today's archive entries, writes empty file so GitHub copy gets overwritten, triggers immediate upload.

## Tool Details

### SSH Tool
`src/tools/ssh.ts` — single tool with 8 actions: `exec` (persistent tmux sessions `chris-bot-<host>-<id>`), `send_keys`, `read_pane`, `devices` (tailscale status), `scp_push`, `scp_pull`, plus session management. All use `execFile` (no shell injection), absolute binary paths, `BatchMode=yes`, `ConnectTimeout=10`.

### Scheduled Tasks
`scheduler.ts` loads from `~/.chris-assistant/schedules.json`, ticks every 60s. Custom cron matcher (no npm dep) supports `*`, values, commas, `*/N` steps. Double-fire prevention via `lastRun`. Optional `allowedTools` field per schedule — filters via `filterTools()` in `registry.ts`. Results sent to Telegram with bold header.

### File Tools
5 tools (`read_file`, `write_file`, `edit_file`, `list_files`, `search_files`) scoped to `WORKSPACE_ROOT`. `edit_file` requires exactly one match. `list_files` prunes `node_modules`/`.git`, cap 200. `search_files` uses `grep -rn`.

### Web Search
Brave Search API, only registered when `BRAVE_SEARCH_API_KEY` set. Supports `count` (1-10), `freshness`, `country`.

### URL Fetch
Native fetch, 15s timeout. HTML extracted via Readability + linkedom, regex fallback. 50KB truncation. SSRF protection blocks private IPs.

### Code Execution
`execFile` (not `exec`). JS/TS/Python/shell. 10s timeout, 1MB buffer, 50KB output. Env vars allowlisted (no secrets). `DANGEROUS_PATTERNS` blocklist.

### Git Tools
`git_status`, `git_diff` (optional `staged`), `git_commit` (optional `files` array). No `git_push` (safety). 50KB diff truncation.

### Memory Tool
All providers support `update_memory`. Claude via MCP, OpenAI/MiniMax via function calling. All delegate to `executeMemoryTool()`.

### Market Snapshot
SSHes to Mac Mini (via `MAC_MINI_HOST` env var or SSH config alias) to run `tasty-coach --snapshot --json`. Parses JSON output into structured objects. Formats for Telegram with categorized sections (Futures, ETFs, Commodities, Crypto, Volatility) and auto-generated insights.

### Journal
`journal_entry` tool — appends timestamped entries to `~/.chris-assistant/journal/YYYY-MM-DD.md`. Uploads to GitHub every 6 hours. Today's + yesterday's journals loaded into system prompt. 2000 char limit per entry.

### Recall
`recall_conversations` tool with actions: `list`, `read_day`, `search` (grep, 50 results cap), `summarize`, `read_journal`.

### Skills
`src/skills/` + `src/tools/skills.ts` — reusable workflows defined as JSON in the memory repo (`skills/<id>.json`). Two static tools handle everything: `manage_skills` (CRUD: create, list, get, update, delete, toggle, update_state) and `run_skill` (execution). Skills are discovered via the system prompt (enabled skills with triggers injected alongside memory, capped at 20) and executed via `run_skill` which loads the full definition, validates inputs, substitutes `{placeholder}` values, and calls `chat(0, prompt, undefined, undefined, skill.tools)` with filtered tool access. Guardrails: 50 skill cap, 5000 char instruction limit, 10KB state cap, tool names validated against registry. `invalidatePromptCache()` called after skill CRUD so discovery updates immediately.

## Weekly Memory Consolidation

`src/memory-consolidation.ts` — fires Sunday at 23:00. Reads all knowledge, memory, past 7 days of summaries and journal entries, plus existing `memory/SUMMARY.md`. Produces a curated, topic-organized markdown document (32K cap). `loader.ts` injects as `# Curated Memory` section. The split knowledge files remain the source of truth for `update_memory` — SUMMARY.md is read-only.

## Heartbeat

`src/heartbeat.ts` — writes `HEARTBEAT.md` to GitHub memory repo every 3 hours (+ startup). Collects uptime, model/provider, health status, scheduled tasks, last message time, today's message count. SHA-256 dedup. Reads `conversations.json` directly via `fs` (not importing `conversation.ts`) to avoid circular deps.

## Health Monitor

`health.ts` — startup notification, 5min health checks (GitHub, tokens), deduped alerts (1hr re-alert), recovery messages. Two-tier token warnings: MiniMax 30min, OpenAI 1hr (only without refresh token).

## Middleware

`middleware.ts` exports `authMiddleware` (only responds to `TELEGRAM_ALLOWED_USER_ID`) and `rateLimitMiddleware` (10 msg/min sliding window). Composed via `bot.use()` before handlers.

## Telegram Commands

Registered via `setMyCommands`: `/start`, `/clear`, `/purge`, `/stop`, `/session`, `/model`, `/memory`, `/project`, `/reload`, `/restart`, `/help`.

## Image & Document Handling

`telegram.ts` handles `message:photo` and `message:document`. Photos downloaded, base64-encoded, sent as `ImageAttachment`. `providers/index.ts` intercepts images before provider dispatch. Text documents read as UTF-8, prepended to message (50KB truncation).

## CLI Global Install

`npm link` creates global `chris` command. Shell wrapper in `bin/chris` follows symlinks to find project root and tsx from node_modules.

## `chris doctor --fix`

Runs typecheck, checks error logs for common patterns (TransformError, missing modules), runs `npm install` if needed, restarts bot and verifies it comes back online.

## Tests

vitest in `tests/` — `markdown.test.ts`, `path-guard.test.ts`, `loop-detection.test.ts` (48 tests). CI via `.github/workflows/ci.yml`. Test files set dummy env vars before imports.
