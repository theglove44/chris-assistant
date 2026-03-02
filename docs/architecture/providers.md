---
title: Providers
description: Multi-provider architecture — Claude, OpenAI, and MiniMax
---

# Providers

The model string determines the provider. No separate "provider" config key needed.

| Prefix | Provider | Implementation |
|--------|----------|---------------|
| `gpt-*`, `o3*`, `o4-*` | OpenAI | `src/providers/openai.ts` |
| `MiniMax-*` | MiniMax | `src/providers/minimax.ts` |
| Everything else | Claude | `src/providers/claude.ts` |

## Claude

Uses the `@anthropic-ai/claude-agent-sdk` as a full agent with Claude Code's native tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, etc.) running natively. Custom tools (memory, SSH, scheduler, recall, journal) are exposed via an in-process MCP server. See the [Agent SDKs](./agent-sdks) page for a deep dive into how this works, the MCP bridge, session persistence, and safety hooks.

**System prompt**: Uses `{ type: 'preset', preset: 'claude_code', append: <identity/memory> }` — extends Claude Code's default system prompt with personality, knowledge, and Telegram formatting rules.

**Session persistence**: Session IDs are stored per chat in `~/.chris-assistant/claude-sessions.json`. Each message passes `resume: sessionId` to continue the conversation. The SDK manages its own context — no manual conversation history formatting needed. `/clear` resets the session.

**Streaming**: The SDK streams `content_block_delta` events with `text_delta` parts via `includePartialMessages: true`. The provider extracts text from `SDKAssistantMessage` content blocks and calls `onChunk()` for real-time Telegram updates.

**Extended thinking**: Keyword-triggered — "think" → 10k tokens, "think hard" → 50k tokens.

**Abort support**: Per-chat `AbortController` map. `/stop` aborts the active query for the calling chat without affecting concurrent queries (e.g. scheduled tasks).

**Authentication**: Requires `CLAUDE_CODE_OAUTH_TOKEN` in `.env` from a Max subscription, or run `claude` CLI once to authenticate.

## OpenAI

Uses raw fetch to the Codex Responses API (`chatgpt.com/backend-api/codex/responses`) with SSE streaming.

**Authentication**: Authorization code OAuth + PKCE flow (`chris openai login`) — opens browser to `auth.openai.com/oauth/authorize`, local callback server on port 1455 catches the redirect, exchanges code for tokens. Account ID extracted from JWT (`payload["https://api.openai.com/auth"].chatgpt_account_id`). Tokens auto-refresh via refresh_token grant. Tokens + account ID stored in `~/.chris-assistant/openai-auth.json`.

**Streaming**: SSE from the Codex Responses API (`response.output_text.delta` events). Uses the `onChunk` callback in the Provider interface.

::: warning Codex API constraints
The endpoint requires `stream: true` and `store: false` in every request — there is no non-streaming mode. Headers must include `chatgpt-account-id` and `OpenAI-Beta: responses=experimental`. Only GPT-5.x models work; older models (gpt-4o, gpt-4.1) return a 400 error. Tool definitions use a flat format (`{ type, name, description, parameters }`) instead of the nested Chat Completions format.
:::

## MiniMax

Uses the `openai` npm package with custom baseURL (`https://api.minimax.io/v1`). Streams via the OpenAI SDK.

**Authentication**: OAuth device flow (`chris minimax login`) — tokens in `~/.chris-assistant/minimax-auth.json`.

::: tip MiniMax OAuth quirks
The `/oauth/code` endpoint requires `response_type: "code"` in the body. The `expired_in` field is a unix timestamp in **milliseconds** (not a duration). Token poll responses use a `status` field (`"success"` / `"pending"` / `"error"`) — don't rely on HTTP status codes.
:::

## Streaming

All three providers stream via the `onChunk` callback in the Provider interface. `telegram.ts` sends a "..." placeholder and edits it every 1.5s with accumulated text + cursor (▍). OpenAI streams via SSE, MiniMax via the OpenAI SDK, and Claude via the Agent SDK's `includePartialMessages` events. Final render uses Markdown with plain text fallback.

## Image and Document Handling

`telegram.ts` handles `message:photo` and `message:document` in addition to `message:text`. Photos are downloaded from Telegram, base64-encoded, and passed via `ImageAttachment` in the Provider interface. OpenAI/MiniMax use `image_url` content parts. Claude Agent SDK only accepts string prompts, so images get a text-only fallback. Text documents are downloaded, read as UTF-8, and prepended to the message (50KB truncation). Unsupported file types get a helpful error.

## Context Compaction

When the conversation approaches the model's context window limit, older tool turns are summarized into a structured checkpoint and the loop continues. No hard turn ceiling — the bot can handle arbitrarily long SSH investigations and multi-file coding tasks.

Since the Codex API has no non-streaming mode, `compactCodexInput()` in `compaction.ts` parses SSE responses to extract the summary text. MiniMax compaction uses the OpenAI SDK (`compactMessages()`).

## Adding a New Provider

1. Create `src/providers/<name>.ts` implementing the `Provider` interface
2. Add a prefix check in `src/providers/index.ts`
3. Add model shortcuts to `src/cli/commands/model.ts`
4. For OpenAI-compatible providers, use `getOpenAiToolDefinitions()` and `dispatchToolCall()` from `src/tools/index.ts`
