---
title: Gotchas
description: Common pitfalls and things to watch out for
---

# Gotchas

## esbuild Regex Parsing

Never use `</` inside regex literals anywhere in the codebase — esbuild misparses it as an HTML closing tag and throws a `TransformError` that crashes the bot.

```typescript
// BAD — esbuild will crash
const re = /<\/think>/g

// GOOD — use RegExp constructor
const re = new RegExp("<" + "/think>", "g")
```

The `npm run typecheck` command includes an automated check (`scripts/check-esbuild-compat.js`) that catches this.

## pm2 PATH Isolation

pm2 spawns processes in its own daemon. It doesn't inherit your shell PATH. That's why `pm2-helper.ts` exports `TSX_BIN` as an absolute path to `node_modules/.bin/tsx`.

## Telegram Message Formatting

See "Telegram HTML Formatting" section below — the bot now uses HTML mode, not MarkdownV2.

## Telegram Message Limit

4096 characters max. `telegram.ts` has a `splitMessage()` function that breaks at paragraph then sentence boundaries.

## Telegram Streaming Rate Limit

`telegram.ts` rate-limits `editMessageText` calls to one per 1.5 seconds during streaming. Edits are fire-and-forget (`.catch(() => {})`) so failures don't interrupt the stream.

## Thinking Tags

Reasoning models (o3, MiniMax, etc.) may emit `<think>...</think>` blocks. `telegram.ts` strips these both during streaming preview and in the final response. Providers (`minimax.ts`, `openai.ts`) also strip them during streaming.

## Node.js console.log

Does not support C-style `%-16s` padding. Use `String.padEnd()` instead.

## Memory Cache Timing

System prompt is cached 5 minutes. After any conversation the cache is invalidated. Manually edited memory files via `chris memory edit` won't be picked up until the cache expires or the bot restarts.

## GitHub PAT Expiry

Fine-grained PATs have a max expiry of 1 year. Set a reminder to rotate.

## Web Search Tool

Only registered when `BRAVE_SEARCH_API_KEY` is set. When absent, the tool definition is not sent to any provider — no dead tools in the API call.

## Dashboard Inline JS

The dashboard (`dashboard.ts`) serves all JS inline in a template literal. Backslash escapes like `\'` are consumed by the template literal — they don't appear in the browser. Use `data-*` attributes with `addEventListener` instead of inline `onclick` handlers with dynamic values. Use `var` (not `const`/`let`) for inline JS consistency. Animations use double `requestAnimationFrame` for enter transitions. The drawer's `closeScheduleModal()` stores its hide-timeout in `drawerCloseTimer` so `openScheduleModal()` can cancel it (prevents race conditions). The progress bar uses `progressCount` reference counter for overlapping API calls. Escape `"` as `&quot;` in `data-tooltip` attributes.

## SSH Config and pm2

The SSH tool uses hostnames/aliases from `~/.ssh/config`. The `Host` line must include both the alias and the IP (e.g. `Host office <tailnet-ip>`) for SSH to resolve the correct user and identity file when the bot connects by IP.

## Telegram HTML Formatting

`markdown.ts` now converts to Telegram HTML (`parse_mode: "HTML"`), not MarkdownV2. `**bold**` → `<b>`, `*italic*` → `<i>`, `` `code` `` → `<code>`, fenced code → `<pre>`. Only `&`, `<`, `>` need escaping.

## `chris doctor --fix`

Runs typecheck, checks error logs for common patterns (TransformError, missing modules), runs `npm install` if needed, then restarts the bot and verifies it comes back online. The regular `chris doctor` (without `--fix`) shows the last error message and restart count when the bot is errored.

## MiniMax OAuth API Quirks

- The `/oauth/code` endpoint requires `response_type: "code"` in the body
- The `expired_in` field is a unix timestamp in **milliseconds** (not a duration)
- Token poll responses use a `status` field (`"success"` / `"pending"` / `"error"`) — don't rely on HTTP status codes
- Tokens stored in `~/.chris-assistant/minimax-auth.json`

## OpenAI Codex OAuth

Authorization code + PKCE flow — opens browser to `auth.openai.com/oauth/authorize`, local callback server on port 1455 catches the redirect, exchanges code for tokens. Account ID extracted from JWT. Tokens auto-refresh via refresh_token grant.

## macOS Calendar: `open` Flags

The calendar helper must be launched with `open -n -W`:
- `-n` forces a new instance — without it, `open` rejects sequential calls while the app is still running, silently dropping the new `--args` and `--stdout` redirect. This causes stale results.
- `-W` waits for exit — output file is ready when `open` returns, no polling needed.

## macOS Calendar: Zero-Width Date Range

EventKit's `predicateForEvents(withStart:end:)` with equal start/end dates (zero-width range) only returns multi-day spanning events — it misses events that start on that day. The Node.js wrapper bumps `end_date` to the next day when it equals `start_date`.

## macOS Calendar TCC Permissions

The Swift calendar helper (`ChrisCalendar.app`) requires a macOS TCC grant for Calendar access. Each recompile + codesign changes the code signature hash, which invalidates the grant. After rebuilding:

```bash
tccutil reset Calendar com.chris-assistant.calendar-helper
open ~/.chris-assistant/ChrisCalendar.app --args list-calendars
# Approve the permission dialog
```

This only applies when `src/swift/chris-calendar.swift` is modified and rebuilt. Normal usage never triggers it.

The app uses `LSUIElement` (not `LSBackgroundOnly`) in its Info.plist — `LSBackgroundOnly` suppresses TCC dialogs entirely.

## AppleScript and osascript

Multi-line AppleScript must be written to temp files and passed as a file path to `/usr/bin/osascript`. The `-e` flag doesn't handle multi-line scripts reliably. The `macos.ts` Mail functions use this temp file pattern.

## Codex Responses API Constraints

- Requires `stream: true` and `store: false` in every request — no non-streaming mode
- Headers must include `chatgpt-account-id` and `OpenAI-Beta: responses=experimental`
- Only GPT-5.x models work; older models return 400
- Tool definitions use a flat format instead of nested Chat Completions format
- Compaction requires parsing SSE responses (`compactCodexInput()` in `compaction.ts`)
