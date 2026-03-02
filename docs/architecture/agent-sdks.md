---
title: Agent SDKs
description: How and why the bot uses the Claude Agent SDK and OpenAI Codex API as its AI backends
---

# Agent SDKs

This page explains the agent SDK integrations in depth — why they exist, how they work, and how to enable them.

## Why Agent SDKs?

A basic AI chatbot sends a prompt to an API and gets text back. That's fine for conversation, but this bot needs to **do things**: search the web, SSH into servers, read and write files, run code, manage schedules, and update its own memory. That requires an agentic loop where the AI can call tools, inspect results, and decide what to do next — potentially for dozens of turns in a single user message.

There are two ways to build this:

1. **Hand-rolled tool loop** — You define tool schemas, send them to a Chat Completions-style API, parse function call responses, execute the tools yourself, feed results back, and repeat. You manage the conversation history, context window, and error handling.

2. **Agent SDK** — The SDK manages the loop for you. You provide the prompt, tools, and configuration. The SDK handles streaming, tool execution, context management, and session persistence.

This project uses **both approaches** depending on the provider:

| Provider | Approach | Why |
|----------|----------|-----|
| **Claude** | Agent SDK (`@anthropic-ai/claude-agent-sdk`) | Claude Code's native tools (Bash, file operations, web search) are dramatically better than hand-rolled versions. The SDK manages sessions, context, and tool execution natively. |
| **OpenAI** | Hand-rolled loop over Codex Responses API | OpenAI doesn't offer an equivalent agent SDK. We build the tool loop manually with SSE streaming. |
| **MiniMax** | Hand-rolled loop over OpenAI-compatible API | Same manual approach as OpenAI, using the `openai` npm package with a custom base URL. |

## Claude Agent SDK

### What It Is

The `@anthropic-ai/claude-agent-sdk` is a Node.js SDK that runs Claude as a full agent — the same agent that powers Claude Code (Anthropic's CLI tool). When the bot uses Claude, it gets **all of Claude Code's native capabilities** out of the box:

- **Bash** — run shell commands with full output capture
- **Read/Write/Edit** — file operations with line-number precision
- **Glob/Grep** — fast file search and content search
- **WebSearch/WebFetch** — web search and URL fetching
- **NotebookEdit** — Jupyter notebook editing

These native tools are significantly better than the hand-rolled equivalents in `src/tools/`. For example, Claude Code's native `Edit` tool understands code structure and handles edge cases that a simple find-and-replace can't. Its `Bash` tool captures output properly, handles timeouts, and understands interactive commands.

### How It Works

When a user sends a message and Claude is the active model, here's what happens:

```
User message arrives
  │
  ├── Load append prompt (identity + memory + formatting rules)
  ├── Look up existing session ID for this chat
  │
  ├── Call query() with:
  │   ├── prompt: the user's message
  │   ├── systemPrompt: { preset: "claude_code", append: <identity/memory> }
  │   ├── tools: { preset: "claude_code" }   ← native tools
  │   ├── mcpServers: { chris-tools: ... }   ← custom tools via MCP
  │   ├── resume: <sessionId>                ← continues the conversation
  │   ├── includePartialMessages: true       ← enables streaming
  │   └── hooks: { PreToolUse: [safetyHook] }
  │
  ├── SDK runs the agent loop internally:
  │   ├── Claude reads the prompt + full session history
  │   ├── Decides to respond or call tools
  │   ├── Tool calls execute (native or MCP)
  │   ├── Results feed back to Claude
  │   └── Repeat until Claude produces a final text response
  │
  ├── Stream partial messages to Telegram (1.5s update interval)
  ├── Capture session ID from response → save for next message
  └── Return final text
```

The key insight is that `query()` returns an **async iterable** of SDK messages. The bot iterates over these, extracting text content for streaming and capturing the session ID for continuity.

### Session Persistence

Session persistence is what makes Claude feel like an ongoing conversation rather than a series of isolated prompts.

**How it works:**
- Every chat (Telegram or Discord) has a unique `chatId`
- `src/claude-sessions.ts` maps `chatId → sessionId` in `~/.chris-assistant/claude-sessions.json`
- When a new message arrives, the bot passes `resume: sessionId` to `query()`
- The SDK loads the full conversation history from that session
- Claude sees everything you've discussed — no manual history management needed

**Without session persistence**, every message would start fresh. Claude wouldn't remember what you just asked, what tools it ran, or what files it was working on. You'd have to re-explain context every time.

**Session lifecycle:**
- First message in a chat → no `resume`, SDK creates a new session
- Subsequent messages → `resume: sessionId`, conversation continues
- `/clear` command → calls `clearSession(chatId)`, next message starts fresh
- `/purge` command → same as `/clear` plus archive redaction
- Scheduled tasks (chatId 0) → `persistSession: false`, always one-shot

### The MCP Bridge: Custom Tools

Claude Code's native tools cover file operations, shell commands, and web access. But the bot also has custom tools that don't exist in Claude Code:

- `update_memory` — write to the GitHub memory repo
- `ssh` — SSH into Tailnet devices with persistent tmux sessions
- `manage_schedule` — create/delete cron-scheduled tasks
- `recall_conversations` — search past conversation archives
- `journal_entry` — write daily journal notes
- `market_snapshot` — fetch market data via SSH

These are exposed to Claude via an **in-process MCP server**. MCP (Model Context Protocol) is a standard for connecting tools to AI models. The bot creates an MCP server using `createSdkMcpServer()` from the Agent SDK:

```typescript
const toolServer = createSdkMcpServer({
  name: "chris-tools",
  tools: getCustomMcpTools(), // only non-native tools
});
```

The tool registry (`src/tools/registry.ts`) knows which tools Claude Code handles natively via the `NATIVE_CLAUDE_TOOLS` set. `getCustomMcpTools()` returns only the tools that aren't in that set. This avoids conflicts — Claude Code's native `read_file` is better than the hand-rolled one, so the hand-rolled version is excluded from the MCP server.

When Claude calls a custom tool, the flow is:
1. Claude emits a tool call for `mcp__chris-tools__ssh` (MCP naming convention)
2. The SDK routes it to the in-process MCP server
3. The MCP server executes the tool via the same `executeToolCall()` function that OpenAI/MiniMax use
4. The result flows back to Claude through the SDK

### Safety: The PreToolUse Hook

Since Claude Code's native Bash tool bypasses the bot's tool registry (and therefore the dangerous command blocklist in `run-code.ts`), a `PreToolUse` hook intercepts every Bash command before execution:

```typescript
hooks: {
  PreToolUse: [{
    matcher: "Bash",
    hooks: [safetyHook],
  }],
}
```

The safety hook blocks patterns that could crash or restart the bot:
- `pm2` commands (restart, stop, delete)
- `kill` targeting chris-assistant
- `systemctl restart/stop`
- `reboot` / `shutdown`
- `rm -rf /` or `rm -rf ~`
- `npm run start/dev`
- `chris start/stop/restart`

Blocked commands return a message telling Claude to ask Chris to restart manually.

### Extended Thinking

Claude's extended thinking (chain-of-thought reasoning) is keyword-triggered:

| Keyword | Budget |
|---------|--------|
| "think", "consider", "reason", "analyze" | 10,000 tokens |
| "think hard", "think deeply", "ultrathink" | 50,000 tokens |

The thinking budget is passed as `maxThinkingTokens` in the query options. When not triggered, no thinking budget is set (standard response mode).

### Abort Support

Each chat has its own `AbortController`. When a user sends `/stop`, the controller for that chat is aborted, which cancels the active `query()` call without affecting other concurrent queries (e.g. scheduled tasks running on chatId 0).

### How to Enable Claude

1. You need a **Claude Max subscription** (the plan that includes Claude Code)
2. Run `claude` CLI once to authenticate, or get a token via `claude setup-token`
3. Add the token to your `.env`:
   ```
   CLAUDE_CODE_OAUTH_TOKEN=your_token_here
   ```
4. Switch to a Claude model:
   ```bash
   chris model set sonnet    # Claude Sonnet 4.6
   chris model set opus      # Claude Opus 4.6
   chris model set haiku     # Claude Haiku 4.5
   ```

Without `CLAUDE_CODE_OAUTH_TOKEN`, the Claude provider will fail on the first message. The bot defaults to OpenAI if no Claude token is configured.

## OpenAI: Hand-Rolled Agent Loop

### What It Is

The OpenAI provider uses the **Codex Responses API** (`chatgpt.com/backend-api/codex/responses`) — a backend API that powers ChatGPT's code interpreter. It's authenticated via your ChatGPT Plus/Pro subscription through browser-based OAuth, not via API keys or prepaid credits.

### How It Works

Unlike the Claude Agent SDK which manages the agentic loop internally, the OpenAI provider builds the loop manually:

```
User message arrives
  │
  ├── Get valid access token (auto-refresh if expired)
  ├── Build system prompt + conversation history
  ├── Format tool definitions (flat Responses API format)
  │
  ├── Tool loop (up to maxToolTurns iterations):
  │   ├── Check if context needs compaction
  │   ├── Send request to Codex API (always streaming)
  │   ├── Parse SSE events:
  │   │   ├── response.output_text.delta → stream to Telegram
  │   │   ├── response.output_item.added (function_call) → collect tool calls
  │   │   └── response.function_call_arguments.delta → accumulate args
  │   │
  │   ├── If tool calls received:
  │   │   ├── Execute each tool via dispatchToolCall()
  │   │   ├── Append tool calls + results to input array
  │   │   └── Continue loop
  │   │
  │   └── If no tool calls → return final text
  │
  └── If turn limit reached → request a summary from the model
```

Key differences from Claude:

- **No session persistence** — every message rebuilds context from the conversation history (last 20 messages stored locally)
- **Manual context management** — the provider tracks the full input array and runs compaction when approaching the context window limit
- **Manual tool dispatch** — tool calls are parsed from SSE events, executed via the tool registry, and results are appended to the input for the next turn
- **SSE streaming** — raw Server-Sent Events parsing rather than SDK-managed streaming

### Context Compaction

Since there's no session persistence, long tool-use conversations can blow through the context window. `compaction.ts` handles this:

1. Before each API call, `needsCompaction()` estimates the current input size
2. If it exceeds 70% of the model's context window, `compactCodexInput()` fires
3. Older turns are sent to the model with a summarization prompt
4. The summary replaces the old turns, freeing up context for more tool calls

This allows arbitrarily long SSH investigations and multi-file coding tasks without hitting a hard ceiling.

### How to Enable OpenAI

1. You need a **ChatGPT Plus or Pro subscription**
2. Authenticate via browser OAuth:
   ```bash
   chris openai login    # Opens browser, callback on localhost:1455
   chris openai status   # Verify token + account ID
   ```
3. Switch to an OpenAI model:
   ```bash
   chris model set gpt5     # GPT-5.2
   chris model set codex    # GPT-5.3-Codex
   ```

Tokens auto-refresh via the refresh token grant. Stored in `~/.chris-assistant/openai-auth.json`.

::: warning Codex API Constraints
- Every request must have `stream: true` and `store: false`
- Headers must include `chatgpt-account-id` and `OpenAI-Beta: responses=experimental`
- Only GPT-5.x models work — older models (gpt-4o, gpt-4.1) return a 400 error
- Tool definitions use a flat format, not the nested Chat Completions format
:::

## Comparison: Claude Agent SDK vs OpenAI Hand-Rolled

| Aspect | Claude (Agent SDK) | OpenAI (Hand-Rolled) |
|--------|-------------------|---------------------|
| **Tool execution** | SDK handles natively | Manual dispatch loop |
| **Session persistence** | Built-in via `resume` | Manual via conversation history |
| **Context management** | SDK manages internally | Manual compaction at 70% threshold |
| **Native tools** | Bash, files, web, grep, glob | None — all tools are custom |
| **Streaming** | SDK events → `onChunk` | SSE parsing → `onChunk` |
| **Tool quality** | Claude Code's battle-tested tools | Hand-rolled in `src/tools/` |
| **Abort support** | `AbortController` on query | Not supported |
| **Authentication** | Max subscription OAuth token | ChatGPT OAuth (browser flow) |
| **Image support** | Text fallback only (SDK limitation) | Native `input_image` content parts |

## How Tools Are Shared

All three providers use the same tool registry (`src/tools/registry.ts`). The registry provides different output formats depending on the consumer:

- `getOpenAiToolDefinitions()` — OpenAI function calling format (used by OpenAI and MiniMax)
- `getCustomMcpTools()` — MCP tool format (used by Claude, excludes native tools)
- `dispatchToolCall()` — executes a tool by name (used by OpenAI and MiniMax)

When you add a new tool via `registerTool()` in the registry, all providers pick it up automatically. Claude's native tools take precedence — if a registered tool name matches a native Claude Code tool, it's excluded from the MCP server.

## Source Files

| File | Purpose |
|------|---------|
| `src/providers/claude.ts` | Claude Agent SDK provider — query, streaming, hooks, abort |
| `src/providers/openai.ts` | OpenAI Codex provider — SSE streaming, manual tool loop |
| `src/providers/minimax.ts` | MiniMax provider — OpenAI SDK with custom base URL |
| `src/providers/types.ts` | `Provider` interface shared by all providers |
| `src/providers/index.ts` | Router — model string determines which provider to use |
| `src/providers/compaction.ts` | Context compaction for OpenAI and MiniMax |
| `src/providers/context-limits.ts` | Model context window sizes and thresholds |
| `src/claude-sessions.ts` | Session ID persistence (chatId → sessionId mapping) |
| `src/tools/registry.ts` | Tool registry — MCP format, OpenAI format, dispatch |
