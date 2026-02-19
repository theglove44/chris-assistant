# Chris Assistant — Roadmap

Audit of blind spots, gaps, and improvements. Items ranked by impact within each category.

**Status:** ⬜ Not started · 🟡 In progress · ✅ Completed
**Impact:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

## Capabilities

The bot currently has one tool (`update_memory`). Everything below expands what it can actually do.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Web search tool** | `src/tools/web-search.ts` — Brave Search API tool, conditionally registered when `BRAVE_SEARCH_API_KEY` is set. Returns top 5 results with titles, URLs, and snippets. All three providers pick it up automatically via the tool registry. `chris doctor` checks API key validity. |
| 2 | 🟠 | ✅ | **Image and document handling** | Photos sent via Telegram are downloaded, base64-encoded, and passed to OpenAI/MiniMax vision APIs. Text-based documents (.txt, .md, .json, .csv, .py, .ts, etc.) are downloaded and prepended to the message. Claude gets a text-only fallback (SDK limitation). Unsupported files get a helpful error listing supported types. |
| 3 | 🟠 | ✅ | **File and URL reading** | `src/tools/fetch-url.ts` — fetches any URL via native `fetch`, strips HTML to readable text, 15s timeout, 50KB truncation. Always registered (no API key). |
| 4 | 🟡 | ✅ | **Code execution sandbox** | `src/tools/run-code.ts` — executes JS, TS, Python, and shell code via `child_process.execFile` (no shell injection). 10s timeout, 50KB output limit. TS uses project's tsx binary. |
| 5 | 🟢 | ⬜ | **Calendar/reminder integration** | No awareness of time, dates, or schedules. Can't set reminders or check what's on today. Would require an external integration (Google Calendar API, Apple Reminders, etc.). |

---

## User Experience

How the bot feels to use day-to-day.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Streaming responses** | OpenAI and MiniMax providers stream via `onChunk` callback. Telegram handler sends "..." placeholder, then edits it every 1.5s with accumulated text + cursor (▍). Final render replaces with Markdown. Claude SDK doesn't expose token streaming yet — `onChunk` param accepted but unused. |
| 2 | 🟠 | ✅ | **Persistent conversation history** | `src/conversation.ts` persists the last 20 messages per chat to `~/.chris-assistant/conversations.json`. Loads lazily on first access, saves after each message. Handles missing/corrupt files gracefully. No new dependencies. |
| 3 | 🟠 | ✅ | **MarkdownV2 rendering** | `src/markdown.ts` converts standard AI markdown to Telegram MarkdownV2 with proper context-aware escaping (plain text, code, URLs). `telegram.ts` uses `parse_mode: "MarkdownV2"` with plain text fallback. Streaming preview stays plain text. |
| 4 | 🟡 | ⬜ | **Voice message support** | Telegram voice messages are common on mobile. Transcribe incoming voice via Whisper API or similar, and optionally respond with TTS audio. |
| 5 | 🟢 | ✅ | **Telegram commands menu** | Added `/model` (show current model + provider), `/memory` (list memory files with sizes), `/help` (list all commands). Registered command menu via `setMyCommands` so commands appear in the Telegram bot UI. |

---

## Coding Agent

Giving the bot the ability to read, write, and modify code in local projects — turning it from a chat bot into a coding assistant. Inspired by Claude Code and OpenClaw's approach: primitive file/shell tools + a multi-turn tool loop. All tool calls use the same AI model as the active conversation — no separate model for execution.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **File tools** | `src/tools/files.ts` — 5 tools: `read_file`, `write_file`, `edit_file` (exact-match replacement), `list_files` (find with glob, excludes node_modules/.git), `search_files` (grep -rn). All paths resolved relative to `WORKSPACE_ROOT` (default `~/Projects`). Guard rejects path traversal outside workspace. 50KB output truncation. |
| 2 | 🔴 | ⬜ | **Workspace root & guard** | Configurable workspace root (default `~/Projects/`). All file tool paths resolved relative to it. Guard wrapper rejects any path that escapes the root (prevents `../../.env` or `/etc/passwd` access). Telegram `/project` command to set active workspace. |
| 3 | 🔴 | ⬜ | **Increase tool turn limit** | Providers currently cap at 3 tool turns. Coding work needs 10–20+. Increase `maxTurns` in OpenAI, MiniMax, and Claude providers. Add configurable limit. |
| 4 | 🟠 | ⬜ | **Result truncation** | Large file reads or command outputs need truncation before going back to the AI. Prevent a single `read_file` on a 5MB file from blowing the context window. Configurable per-result limit (e.g. 50KB). |
| 5 | 🟠 | ⬜ | **Tool loop detection** | Detect when the AI is stuck in a repetitive tool-calling cycle (reading the same file, retrying the same failing command). Break the loop with a helpful message after N repeated identical calls. |
| 6 | 🟡 | ⬜ | **Project bootstrap files** | Load a `CLAUDE.md` or `AGENTS.md` from the workspace root and inject it into the system prompt. Gives the AI project-specific context (architecture, conventions, gotchas) automatically. |
| 7 | 🟢 | ⬜ | **Git tools** | `git_status`, `git_diff`, `git_commit`, `git_push`. Let the AI commit its own changes and create PRs. Requires careful confirmation flow — don't auto-push without user approval. |

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
