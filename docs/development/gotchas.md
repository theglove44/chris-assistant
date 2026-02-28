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

## Telegram MarkdownV2

`markdown.ts` converts standard AI markdown to Telegram MarkdownV2. Key differences from standard markdown:

- `*bold*` not `**bold**`
- `_italic_` not `*italic*`
- 18 special chars must be escaped in plain text, fewer in code/URL contexts

If conversion fails, `telegram.ts` falls back to plain text. Streaming preview uses no `parse_mode` (partial MarkdownV2 would fail).

## Telegram Message Limit

4096 characters max. `telegram.ts` has a `splitMessage()` function that breaks at paragraph then sentence boundaries. Splitting happens on original text before MarkdownV2 conversion (escaping inflates length).

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

## `chris doctor --fix`

Runs typecheck, checks error logs for common patterns (TransformError, missing modules), runs `npm install` if needed, then restarts the bot and verifies it comes back online. The regular `chris doctor` (without `--fix`) shows the last error message and restart count when the bot is errored.

## MiniMax OAuth API Quirks

- The `/oauth/code` endpoint requires `response_type: "code"` in the body
- The `expired_in` field is a unix timestamp in **milliseconds** (not a duration)
- Token poll responses use a `status` field (`"success"` / `"pending"` / `"error"`) — don't rely on HTTP status codes
- Tokens stored in `~/.chris-assistant/minimax-auth.json`

## OpenAI Codex OAuth

Authorization code + PKCE flow — opens browser to `auth.openai.com/oauth/authorize`, local callback server on port 1455 catches the redirect, exchanges code for tokens. Account ID extracted from JWT. Tokens auto-refresh via refresh_token grant.

## Codex Responses API Constraints

- Requires `stream: true` and `store: false` in every request — no non-streaming mode
- Headers must include `chatgpt-account-id` and `OpenAI-Beta: responses=experimental`
- Only GPT-5.x models work; older models return 400
- Tool definitions use a flat format instead of nested Chat Completions format
- Compaction requires parsing SSE responses (`compactCodexInput()` in `compaction.ts`)
