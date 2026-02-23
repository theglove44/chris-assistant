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
| 5 | 🟢 | ✅ | **Scheduled tasks (cron-like)** | `src/scheduler.ts` — loads tasks from `~/.chris-assistant/schedules.json`, ticks every 60s, fires matching tasks by sending the prompt to the active AI provider with full tool access. Results sent to Telegram via raw fetch. `src/tools/scheduler.ts` — `manage_schedule` tool with create/list/delete/toggle actions. Supports standard 5-field cron expressions (*, specific values, comma-separated, step values). |

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
| 2 | 🟠 | ✅ | **MiniMax OAuth error-path bug** | Fixed `pollForToken` in `minimax-oauth.ts` — non-OK HTTP responses now throw instead of returning `{ status, message } as any`. The `as any` was silencing the type error and causing `saveTokens()` to persist invalid auth state. Error now propagates to the login flow's catch block with HTTP status code in the message. |
| 3 | 🟠 | ✅ | **Graceful error recovery** | `telegram.ts` now wraps `chat()` in `chatWithRetry()` — one automatic retry with a 2s delay on thrown exceptions. Covers all providers (OpenAI, MiniMax, Claude) from a single retry point. Both attempts logged for pm2 visibility. No provider fallback (overkill for single-user bot). |
| 4 | 🟡 | ✅ | **Token expiry monitoring** | Two-tier warnings in `health.ts` — MiniMax warns 30 minutes before expiry, OpenAI warns 1 hour before (only when no refresh token). Alert message includes minutes remaining. Fully expired tokens get stronger "expired" wording. Existing dedup/re-alert logic handles both tiers. |
| 5 | 🟡 | ✅ | **Conversation history backup to GitHub** | `src/conversation-backup.ts` — reads `~/.chris-assistant/conversations.json` every 6 hours, hashes content with SHA-256, and writes to `backups/conversations.json` in the memory repo only when changed. Runs an immediate backup on startup. Integrated into `index.ts` lifecycle alongside health monitor and scheduler. |
| 6 | 🟡 | ✅ | **Manual cache reload** | Added `/reload` Telegram command — calls `invalidatePromptCache()` so the next message reloads memory from GitHub. Registered in bot command menu via `setMyCommands`. |
| 7 | 🟢 | ✅ | **Async conversation I/O** | `conversation.ts` now uses `fs.promises` for all file I/O. A write queue (promise chain) serializes concurrent saves. All exports are async. Callers updated: `telegram.ts` uses fire-and-forget for `addMessage()`, awaits `clearHistory()`. Providers await `formatHistoryForPrompt()`. |

---

## Security

Protecting the bot, its tokens, and the memory repo.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🟠 | ✅ | **Rate limiting** | Sliding window rate limiter (10 messages/minute) in `src/rate-limit.ts`. Integrated into `telegram.ts` message handler. Replies with retry-after seconds when triggered. |
| 2 | 🟠 | ✅ | **Prompt injection defense** | Validation layer in `src/memory/tools.ts` — 2000 char limit, replace throttle (1 per 5 min per category), injection phrase detection, dangerous shell block detection, path traversal blocking. All rejections logged with `[memory-guard]` prefix. |
| 3 | 🔴 | ✅ | **Symlink workspace escape** | `resolveSafePath()` in `files.ts` now uses `fs.realpathSync` via a recursive `canonicalize()` helper to follow symlinks before the boundary check. Handles non-existent paths (for `write_file`) by resolving the deepest existing ancestor. A symlink inside the workspace pointing outside it will be correctly rejected. |
| 4 | 🟠 | ✅ | **Code execution env sanitization** | `run-code.ts` uses an allowlist (`SAFE_ENV_KEYS`) of safe env vars (PATH, HOME, SHELL, LANG, TMPDIR, etc.) — everything else is stripped. New secrets added to `.env` are automatically excluded without code changes. |
| 5 | 🟠 | ✅ | **SSRF protection in fetch_url** | `fetch-url.ts` resolves hostnames via `dns.promises.lookup()` and checks against private IP ranges (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0/8, ::1, fc00::/7, fe80::/10). Blocks `localhost` and `::1` hostnames directly. DNS failures pass through to let fetch surface natural errors. |
| 6 | 🟠 | ✅ | **Code execution missing cwd** | `run-code.ts` now sets `cwd: getWorkspaceRoot()` on `execFileAsync` so code executes in the active workspace directory, matching the file tools. |
| 7 | 🟡 | ✅ | **Token file permissions** | Already implemented — both `minimax-oauth.ts` and `openai-oauth.ts` use `writeFileSync` with `{ mode: 0o600 }` for token files. |
| 8 | 🟢 | ✅ | **Error message leakage** | Already handled — `telegram.ts` shows generic "Something went wrong. Check the logs." on errors. Photo/document handlers show "Sorry, I couldn't process that file." Raw error details stay in console logs only. |

---

## Architecture

Structural improvements that enable future work.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🔴 | ✅ | **Tool framework** | `src/tools/registry.ts` — shared tool registry. Tools register once with `registerTool()`, auto-generate both OpenAI and Claude MCP formats. Generic `dispatchToolCall()` replaces per-tool if/else in providers. New tools: create file in `src/tools/`, add import to `src/tools/index.ts`, done. |
| 2 | 🟡 | ✅ | **Automated tests and CI** | vitest test suite with 48 tests across 3 files: `tests/markdown.test.ts` (29 — MarkdownV2 conversion), `tests/path-guard.test.ts` (10 — workspace path boundary), `tests/loop-detection.test.ts` (9 — tool loop breaker). GitHub Actions workflow (`.github/workflows/ci.yml`) runs typecheck + tests on push/PR to main. |
| 3 | 🟡 | ✅ | **Plugin/middleware system** | `src/middleware.ts` — two grammY middleware functions composed via `bot.use()`: `authMiddleware` (user guard, silent reject except `/start`) and `rateLimitMiddleware` (sliding window check). Eliminated duplicate auth/rate-limit checks from all 10 handlers in `telegram.ts`. |
| 4 | 🟢 | ⬜ | **Multi-chat support** | The user guard allows one user, but conversation history is keyed by `chatId`. The architecture almost supports group chats or multiple users, but the guard and system prompt assume single-user. Worth deciding if this should be a deliberate constraint or an extensibility point. |
