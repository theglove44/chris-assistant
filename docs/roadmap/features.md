---
title: Feature Roadmap
description: Planned features, improvements, and blind spots
---

# Feature Roadmap

Audit of blind spots, gaps, and improvements. Items ranked by impact within each category.

**Status:** ⬜ Not started · 🟡 In progress · ✅ Completed
**Impact:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

## Capabilities

Tools and features that expand what the bot can do.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Web search and scraping** | Firecrawl v2 powers `web_search` and `scrape_url`, conditionally registered when `FIRECRAWL_API_KEY` is set. |
| 2 | 🟠 | ✅ | **Image and document handling** | Photos route through the configured OpenAI image model. Text documents are read inline; the other text providers remain image-agnostic. |
| 3 | 🟠 | ✅ | **File and URL reading** | Fetches any URL, strips HTML to readable text, 15s timeout, 50KB truncation. |
| 4 | 🟡 | ✅ | **Code execution sandbox** | JS, TS, Python, shell via `execFile`. 10s timeout, 50KB output limit. |
| 5 | 🟢 | ✅ | **Scheduled tasks** | Cron-like tasks with AI execution and full tool access. |
| 6 | 🟠 | ✅ | **Conversation recall** | Full archive + daily AI summaries + recall tool with list/read/search/summarize actions. |
| 7 | 🟠 | ✅ | **Dynamic skills system** | Reusable workflows as JSON in memory repo. `manage_skills` for CRUD, `run_skill` for execution. Discovered via system prompt, executed with filtered tool access. |

## User Experience

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Streaming responses** | Providers stream via `onChunk`; Telegram edits every 1.5s with a cursor. |
| 2 | 🟠 | ✅ | **Persistent conversation history** | Last 20 messages per chat, async I/O with write queue. |
| 3 | 🟠 | ✅ | **Telegram HTML rendering** | Markdown-like input converted to Telegram HTML (`parse_mode: "HTML"`), with plain text fallback. |
| 4 | 🟡 | ⬜ | **Voice message support** | Transcribe incoming voice via Whisper, optionally respond with TTS. |
| 5 | 🟢 | ✅ | **Telegram commands menu** | `/model`, `/memory`, `/help` registered via `setMyCommands`. |

## Coding Agent

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **File tools** | 5 tools: read, write, edit, list, search. Workspace-scoped with path guard. |
| 2 | 🔴 | ✅ | **Workspace root & guard** | Mutable workspace root, `/project` command, symlink-aware path guard. |
| 3 | 🔴 | ✅ | **Increase tool turn limit** | Configurable via `MAX_TOOL_TURNS`, shared across all providers. |
| 4 | 🟠 | ✅ | **Result truncation** | 50KB truncation across all tools. |
| 5 | 🟠 | ✅ | **Tool loop detection** | 3 consecutive identical calls = break. |
| 6 | 🟡 | ⬜ | **Fuzzy loop detection** | Normalize args before fingerprinting, per-tool-name frequency tracking. |
| 7 | 🟡 | ✅ | **Project bootstrap files** | Provider-neutral `AGENTS.md` / `README.md` guidance is loaded into the system prompt. |
| 8 | 🟢 | ✅ | **Git tools** | status, diff, commit. No push (safety choice). |

## Reliability

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Health check and alerting** | Startup notification, periodic checks, alert dedup, recovery messages. |
| 2 | 🟠 | ✅ | **Graceful error recovery** | `chatWithRetry()` — one auto retry with 2s delay. |
| 3 | 🟡 | ✅ | **Provider readiness monitoring** | Redacted OAuth/key readiness checks and recovery alerts. |
| 4 | 🟡 | ✅ | **Conversation history backup** | SHA-256 dedup, every 6 hours, immediate on startup. |
| 5 | 🟡 | ✅ | **Manual cache reload** | `/reload` Telegram command. |

## Security

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🟠 | ✅ | **Rate limiting** | 10 msg/min sliding window. |
| 2 | 🟠 | ✅ | **Prompt injection defense** | 2000 char limit, replace throttle, injection detection. |
| 3 | 🔴 | ✅ | **Symlink workspace escape** | `realpathSync` via recursive `canonicalize()`. |
| 4 | 🟠 | ✅ | **SSRF protection** | DNS resolution + private IP blocking. |
| 5 | 🟠 | ✅ | **Code execution env sanitization** | Allowlisted env vars only. |

## Architecture

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Tool framework** | Shared registry, auto-format generation, generic dispatch. |
| 2 | 🟡 | ✅ | **Automated tests and CI** | 48 tests, GitHub Actions workflow. |
| 3 | 🟡 | ✅ | **Middleware system** | Auth guard + rate limiter as grammY middleware. |
| 4 | 🟢 | ⬜ | **Multi-chat support** | Architecture almost supports it, but guard assumes single-user. |

## Memory & Continuity

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Daily memory journal** | Bot writes notes via `journal_entry` tool, uploaded every 6 hours. |
| 2 | 🟠 | ✅ | **Curated MEMORY.md** | `memory-consolidation.ts` — weekly consolidation into SUMMARY.md from all sources. |
| 3 | 🟡 | ✅ | **Heartbeat file** | `heartbeat.ts` — writes HEARTBEAT.md every 3h with uptime, model, health, schedules, message count. |
| 4 | 🟡 | ✅ | **Memory consolidation loop** | Sunday 23:00, reads USER.md/memory/summaries/journal, produces curated SUMMARY.md (32K cap). |
| 5 | 🟢 | ⬜ | **Conversation analytics** | Track patterns: messages/day, peak hours, tool usage, topic distribution. |
