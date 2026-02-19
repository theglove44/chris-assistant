# Chris Assistant — Roadmap

Audit of blind spots, gaps, and improvements. Items ranked by impact within each category.

**Status:** ⬜ Not started · 🟡 In progress · ✅ Completed
**Impact:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

## Capabilities

The bot currently has one tool (`update_memory`). Everything below expands what it can actually do.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ⬜ | **Web search tool** | No access to real-time information (news, weather, prices, URLs). Every factual answer relies on training data with a knowledge cutoff. Adding a web search tool (e.g. Brave Search, Tavily, or SearXNG) makes the bot genuinely useful for day-to-day questions. |
| 2 | 🟠 | ⬜ | **Image and document handling** | Telegram supports photos, PDFs, voice messages, locations. The bot only handles `message:text` — everything else is silently ignored. At minimum, support photos via vision APIs (all three providers support image inputs) and document text extraction. |
| 3 | 🟠 | ⬜ | **File and URL reading** | No ability to fetch a URL you paste in chat or read a file you send. A simple HTTP fetch tool would cover link previews, article summaries, and checking endpoints. |
| 4 | 🟡 | ⬜ | **Code execution sandbox** | If asked to run code or verify output, the bot can only guess. A sandboxed execution environment (e.g. a Docker container, or a tool that runs code snippets) would let it actually test and validate code. |
| 5 | 🟢 | ⬜ | **Calendar/reminder integration** | No awareness of time, dates, or schedules. Can't set reminders or check what's on today. Would require an external integration (Google Calendar API, Apple Reminders, etc.). |

---

## User Experience

How the bot feels to use day-to-day.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ⬜ | **Streaming responses** | User sees "typing..." until the full response is generated. Reasoning models (o3) can take 30+ seconds. Telegram supports progressive updates via `editMessageText` — send a partial response and keep updating it as tokens stream in. Night-and-day improvement. |
| 2 | 🟠 | ⬜ | **Persistent conversation history** | 20 messages, in-memory, lost on every restart. The bot can't recall yesterday's conversation. Store conversations in SQLite or the memory repo so context survives restarts and the bot can reference past chats. |
| 3 | 🟠 | ⬜ | **MarkdownV2 rendering** | Currently using legacy `parse_mode: "Markdown"` which breaks on common characters (`.`, `!`, `-`, `(`, `)`). Many responses silently fall back to plain text via the catch handler. Switching to MarkdownV2 with proper escaping fixes formatting reliability. |
| 4 | 🟡 | ⬜ | **Voice message support** | Telegram voice messages are common on mobile. Transcribe incoming voice via Whisper API or similar, and optionally respond with TTS audio. |
| 5 | 🟢 | ⬜ | **Telegram commands menu** | Only `/start` and `/clear` exist. Could add `/model` (show/switch model), `/memory` (show memory status), `/forget` (clear a specific memory) accessible directly from Telegram without the CLI. |

---

## Reliability

Keeping the bot running and recovering from failures.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Health check and alerting** | `src/health.ts` — startup notification via Telegram, periodic checks every 5 min (GitHub repo access, MiniMax/OpenAI token expiry), alert dedup (1 hour re-alert), recovery notifications. Integrated into `index.ts` lifecycle. |
| 2 | 🟠 | ⬜ | **Graceful error recovery** | If a provider fails mid-conversation (token expired, API down), the bot returns a generic error. Could auto-retry with exponential backoff, or fall back to a different provider. |
| 3 | 🟡 | ⬜ | **Token expiry monitoring** | MiniMax tokens expire after a few hours with no auto-refresh. OpenAI tokens auto-refresh but the refresh token itself could expire. `chris doctor` checks these, but the bot should proactively warn when tokens are about to expire. |
| 4 | 🟡 | ⬜ | **Conversation history backup** | In-memory history is lost on crash. Even before building persistent storage, periodically flushing recent conversation to disk (or the memory repo) would prevent total context loss. |

---

## Security

Protecting the bot, its tokens, and the memory repo.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🟠 | ✅ | **Rate limiting** | Sliding window rate limiter (10 messages/minute) in `src/rate-limit.ts`. Integrated into `telegram.ts` message handler. Replies with retry-after seconds when triggered. |
| 2 | 🟠 | ✅ | **Prompt injection defense** | Validation layer in `src/memory/tools.ts` — 2000 char limit, replace throttle (1 per 5 min per category), injection phrase detection, dangerous shell block detection, path traversal blocking. All rejections logged with `[memory-guard]` prefix. |
| 3 | 🟡 | ⬜ | **Token file permissions** | `~/.chris-assistant/*.json` files containing OAuth tokens are readable by any process running as the user. Set file permissions to `0600` on write. Low risk on a personal Mac Mini, but good hygiene. |
| 4 | 🟢 | ⬜ | **Error message leakage** | Provider catch blocks log full errors to console. If error handling changes, stack traces or API details could accidentally leak to Telegram. Ensure user-facing error messages never include raw error details. |

---

## Architecture

Structural improvements that enable future work.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Tool framework** | `src/tools/registry.ts` — shared tool registry. Tools register once with `registerTool()`, auto-generate both OpenAI and Claude MCP formats. Generic `dispatchToolCall()` replaces per-tool if/else in providers. New tools: create file in `src/tools/`, add import to `src/tools/index.ts`, done. |
| 2 | 🟡 | ⬜ | **Plugin/middleware system** | Features like rate limiting, input sanitization, logging, and response post-processing (think tag stripping) are all inline in `telegram.ts`. A middleware pipeline would make these composable and testable. |
| 3 | 🟢 | ⬜ | **Multi-chat support** | The user guard allows one user, but conversation history is keyed by `chatId`. The architecture almost supports group chats or multiple users, but the guard and system prompt assume single-user. Worth deciding if this should be a deliberate constraint or an extensibility point. |
