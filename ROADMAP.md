# Chris Assistant — Roadmap

Audit of blind spots, gaps, and improvements. Items ranked by impact within each category.

**Status:** ⬜ Not started · 🟡 In progress · ✅ Completed
**Impact:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

## Capabilities

Tools and features that expand what the bot can do.

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
| 2 | 🔴 | ✅ | **Workspace root & guard** | Mutable workspace root in `files.ts` with exported `getWorkspaceRoot()`/`setWorkspaceRoot()`. Telegram `/project` command shows or sets active workspace at runtime (validates directory exists). Default `~/Projects`, override with `WORKSPACE_ROOT` env var. Registered in bot command menu. |
| 3 | 🔴 | ✅ | **Increase tool turn limit** | All three providers now use `config.maxToolTurns` (default 15, configurable via `MAX_TOOL_TURNS` env var). Claude's `maxTurns`, OpenAI and MiniMax loop limits all read from the same config. |
| 4 | 🟠 | ✅ | **Result truncation** | Already implemented across all tools — 50KB truncation in `files.ts` (read_file, search_files, list_files), `run-code.ts` (stdout), `fetch-url.ts` (HTML content), and `git.ts` (diff output). |
| 5 | 🟠 | ✅ | **Tool loop detection** | Loop detector in `registry.ts` — tracks consecutive identical tool calls (same name + args). After 3 identical calls in a row, returns an error message telling the AI to try a different approach. Covers both OpenAI/MiniMax dispatch and Claude MCP execution. Resets between conversations via `invalidatePromptCache()`. |
| 8 | 🟡 | ⬜ | **Fuzzy loop detection** | Current loop detector uses exact string fingerprints on raw JSON args. LLMs can trivially bypass by rephrasing arguments (changing whitespace, reordering keys). Improve by either hashing parsed/normalized args or tracking per-tool-name call frequency with a decaying counter (e.g. 5 calls to the same tool in one turn trips the breaker regardless of args). |
| 6 | 🟡 | ✅ | **Project bootstrap files** | `shared.ts` loads the first found of `CLAUDE.md`, `AGENTS.md`, `README.md` from the active workspace root, truncates to 20K chars, and injects it as a `# Project Context` section in the system prompt. Cache invalidates on workspace change via callback pattern (avoids circular deps between `shared.ts` and `files.ts`). |
| 7 | 🟢 | ✅ | **Git tools** | `src/tools/git.ts` — 3 tools: `git_status` (short format), `git_diff` (with optional `staged` flag), `git_commit` (with optional file staging). All use `git -C <workspace>` to target the active project. No `git_push` — too risky for auto-execution. 50KB output truncation on diffs. |

---

## Reliability

Keeping the bot running and recovering from failures.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Health check and alerting** | `src/health.ts` — startup notification via Telegram, periodic checks every 5 min (GitHub repo access, MiniMax/OpenAI token expiry), alert dedup (1 hour re-alert), recovery notifications. Integrated into `index.ts` lifecycle. |
| 2 | 🟠 | ⬜ | **MiniMax OAuth error-path bug** | `minimax-oauth.ts` line 121: on non-OK HTTP response, `pollForToken` returns `{ status: "error", message }` cast with `as any` instead of throwing. The login flow then calls `saveTokens()` with this invalid object, persisting garbage auth state. Fix: throw instead of returning on error. |
| 3 | 🟠 | ⬜ | **Graceful error recovery** | If a provider fails mid-conversation (token expired, API down), the bot returns a generic error. Could auto-retry with exponential backoff, or fall back to a different provider. |
| 3 | 🟡 | ⬜ | **Token expiry monitoring** | MiniMax tokens expire after a few hours with no auto-refresh. OpenAI tokens auto-refresh but the refresh token itself could expire. `chris doctor` checks these, but the bot should proactively warn when tokens are about to expire. |
| 4 | 🟡 | ⬜ | **Conversation history backup** | In-memory history is lost on crash. Even before building persistent storage, periodically flushing recent conversation to disk (or the memory repo) would prevent total context loss. |
| 5 | 🟡 | ⬜ | **Manual cache reload** | Add a `/reload` Telegram command to invalidate the system prompt cache on demand. Currently the only way to pick up manually-edited memory files is to wait 5 minutes or restart the bot. |
| 6 | 🟢 | ⬜ | **Async conversation I/O** | `conversation.ts` uses synchronous `fs.readFileSync`/`writeFileSync` which blocks the event loop during writes. Low risk for a single-user bot but poor hygiene. Switch to `fs.promises` with a simple write queue to prevent any theoretical race conditions. |

---

## Security

Protecting the bot, its tokens, and the memory repo.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🟠 | ✅ | **Rate limiting** | Sliding window rate limiter (10 messages/minute) in `src/rate-limit.ts`. Integrated into `telegram.ts` message handler. Replies with retry-after seconds when triggered. |
| 2 | 🟠 | ✅ | **Prompt injection defense** | Validation layer in `src/memory/tools.ts` — 2000 char limit, replace throttle (1 per 5 min per category), injection phrase detection, dangerous shell block detection, path traversal blocking. All rejections logged with `[memory-guard]` prefix. |
| 3 | 🔴 | ⬜ | **Symlink workspace escape** | `resolveSafePath()` in `files.ts` uses `path.resolve` which doesn't follow symlinks. A symlink inside the workspace could point to files outside it (e.g. `~/Projects/myproject/link → /etc/passwd`). Fix: use `fs.realpathSync` to canonicalize paths before the boundary check. |
| 4 | 🟠 | ⬜ | **Code execution env sanitization** | `run-code.ts` passes `...process.env` to child processes — the AI can read all secrets (GitHub token, Telegram token, OAuth tokens) via `echo $GITHUB_TOKEN`. Strip sensitive env vars before spawning. Not true sandboxing (would need Docker/Deno for that), but prevents casual secret exfiltration. |
| 5 | 🟠 | ⬜ | **SSRF protection in fetch_url** | `fetch-url.ts` accepts any `http(s)` URL with no host/IP policy. The AI could fetch `http://localhost:*`, `http://192.168.*`, or cloud metadata endpoints (`169.254.169.254`). Block private/internal IP ranges and localhost before fetching. |
| 6 | 🟠 | ⬜ | **Code execution missing cwd** | `run-code.ts` doesn't set `cwd` on `execFile` — code runs in whatever directory pm2 started from, not the active workspace. Shell commands like `ls` or `cat file.txt` operate on the wrong directory. Set `cwd: getWorkspaceRoot()`. |
| 7 | 🟡 | ⬜ | **Token file permissions** | `~/.chris-assistant/*.json` files containing OAuth tokens are readable by any process running as the user. Set file permissions to `0600` on write. Low risk on a personal Mac Mini, but good hygiene. |
| 8 | 🟢 | ⬜ | **Error message leakage** | Provider catch blocks log full errors to console. If error handling changes, stack traces or API details could accidentally leak to Telegram. Ensure user-facing error messages never include raw error details. |

---

## Architecture

Structural improvements that enable future work.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Tool framework** | `src/tools/registry.ts` — shared tool registry. Tools register once with `registerTool()`, auto-generate both OpenAI and Claude MCP formats. Generic `dispatchToolCall()` replaces per-tool if/else in providers. New tools: create file in `src/tools/`, add import to `src/tools/index.ts`, done. |
| 2 | 🟡 | ⬜ | **Automated tests and CI** | No test suite or CI pipeline. `package.json` only has typecheck. Add unit tests for critical paths (path guard, loop detection, memory validation, markdown conversion) plus a GitHub Actions workflow running typecheck + tests on push. |
| 3 | 🟡 | ⬜ | **Plugin/middleware system** | Features like rate limiting, input sanitization, logging, and response post-processing (think tag stripping) are all inline in `telegram.ts`. A middleware pipeline would make these composable and testable. |
| 4 | 🟢 | ⬜ | **Multi-chat support** | The user guard allows one user, but conversation history is keyed by `chatId`. The architecture almost supports group chats or multiple users, but the guard and system prompt assume single-user. Worth deciding if this should be a deliberate constraint or an extensibility point. |
