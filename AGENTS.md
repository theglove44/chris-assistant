# Project: My Trading Agent

## Reference Documentation
- Codex SDK: https://developers.openai.com/codex/sdk/
- Agents SDK integration: https://developers.openai.com/codex/guides/agents-sdk/
- Codex CLI: https://developers.openai.com/codex/cli/reference/

## Architecture Notes
- Using Codex SDK in TypeScript for core agent
- Docker containerized
- Integrates with TastyTrade API via [existing work]

## Constraints
- Must support non-interactive/headless execution
- Needs persistent thread management

---

# Build Plan: OpenAI Codex Agent SDK Integration

## Context

The assistant currently has two OpenAI modes:
1. **Codex Responses API** (`src/providers/openai.ts`) — raw HTTP to `chatgpt.com/backend-api/codex/responses` using ChatGPT OAuth. Manual tool loop, manual streaming. This is a web API wrapper, not an agent.
2. **Claude Agent SDK** (`src/providers/claude.ts`) — `@anthropic-ai/claude-agent-sdk` as a full agent with native tools (Bash, Read, Write, Edit, Glob, Grep, etc.), MCP server for custom tools, session persistence, streaming, and safety hooks.

The goal is to add a **third mode**: the `@openai/codex-sdk` as a full agent, mirroring the Claude Agent SDK integration. When a user selects a `codex-agent-*` model, the bot uses the Codex SDK which spawns the `codex` CLI under the hood, giving the AI native Bash, file, and code tools — the same concept as Claude's native tools.

## Authentication

The Codex SDK spawns the `codex` CLI, which authenticates via `codex login` — browser-based ChatGPT OAuth. This uses the **same ChatGPT Plus/Pro subscription** as the existing `openai.ts` provider. No separate API key or prepaid credits needed.

Auth chain: `Codex SDK → spawns codex CLI → codex CLI's stored OAuth credentials → ChatGPT subscription`

**Setup:** Run `codex login` once on the host machine. The CLI stores credentials in `~/.codex/`. The SDK inherits them automatically. Same pattern as Claude requiring `claude` CLI auth for Claude Code.

**pm2 consideration:** Since the SDK spawns the `codex` CLI as a subprocess, the CLI binary must be findable. Install globally (`npm install -g @openai/codex`) or add to the project and reference via absolute path (same `TSX_BIN` pattern from `pm2-helper.ts`). The stored OAuth tokens in `~/.codex/` are filesystem-based, so pm2 can access them.

## How the Codex SDK Works

The `@openai/codex-sdk` is a TypeScript library that **spawns the `codex` CLI as a subprocess** and communicates via JSONL over stdin/stdout. Key concepts:

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex({ config: { ... } });
const thread = codex.startThread({ workingDirectory: "/path" });

// Buffered execution
const result = await thread.run("Fix the bug");
// result.finalResponse — the text answer
// result.items — tool calls, file changes, etc.

// Streaming execution
const { events } = await thread.runStreamed("Add tests");
for await (const event of events) {
  if (event.type === "item.completed") { /* tool output, text chunk */ }
  if (event.type === "turn.completed") { /* done, has token usage */ }
}

// Thread persistence — resume later
const threadId = thread.id; // save this
const resumed = codex.resumeThread(threadId);
await resumed.run("Continue where you left off");
```

**Comparison with Claude Agent SDK:**

| Aspect | Claude Agent SDK | Codex SDK |
|--------|-----------------|-----------|
| Mechanism | Direct API calls via `query()` | Spawns `codex` CLI subprocess |
| Auth | `CLAUDE_CODE_OAUTH_TOKEN` env var | `codex login` (ChatGPT subscription OAuth) |
| Native tools | Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch | Bash, file operations (codex CLI built-in) |
| Custom tools | In-process MCP server (`createSdkMcpServer`) | MCP servers via `codex mcp add` (external process) |
| Streaming | `includePartialMessages` → async iterable | `runStreamed()` → async iterable of events |
| Sessions | `resume: sessionId` option | `resumeThread(threadId)` method |
| Sandbox | `permissionMode: "bypassPermissions"` | `--full-auto` (approval: on-request + sandbox: workspace-write) |
| System prompt | `systemPrompt: { preset: "claude_code", append: ... }` | Prepend to first message or `codex` CLI config |
| Working dir | `cwd` option | `workingDirectory` in `startThread()` |

## Architecture

### New Files

1. **`src/providers/codex-agent.ts`** — The Codex Agent SDK provider. Mirrors `claude.ts` in structure.
2. **`src/codex-sessions.ts`** — Thread ID persistence per chat (mirrors `claude-sessions.ts`).

### Modified Files

3. **`src/providers/index.ts`** — Add routing for `codex-agent-*` model prefixes.
4. **`src/cli/commands/model.ts`** — Add model shortcuts (`codex-agent`, etc.).
5. **`CLAUDE.md`** — Document the new provider.

### Dependencies

```bash
npm install @openai/codex-sdk
```

The `codex` CLI must be installed on the host (the SDK spawns it as a subprocess):
```bash
npm install -g @openai/codex
codex login    # One-time ChatGPT OAuth — uses your existing subscription
```

## Implementation Plan

### Step 1: Install dependencies

```bash
npm install @openai/codex-sdk
```

Verify `codex` CLI is available. If not globally installed, install it as a project dependency and reference the binary via absolute path (same pattern as `TSX_BIN` in `pm2-helper.ts` — required for pm2 daemon which doesn't inherit PATH).

### Step 2: Create `src/codex-sessions.ts`

Clone `src/claude-sessions.ts` with s/claude/codex/ — same pattern:
- Store `{ [chatId]: { threadId: string, updatedAt: number } }` in `~/.chris-assistant/codex-sessions.json`
- Export `getThreadId(chatId)`, `setThreadId(chatId, threadId)`, `clearThread(chatId)`, `clearAllThreads()`

### Step 3: Create `src/providers/codex-agent.ts`

The core provider, following the same structure as `claude.ts`:

```typescript
import { Codex } from "@openai/codex-sdk";
import type { Provider, ImageAttachment } from "./types.js";
import { config } from "../config.js";
import { getCodexSystemPrompt, invalidatePromptCache } from "./shared.js";
import { getWorkspaceRoot } from "../tools/files.js";
import { getThreadId, setThreadId } from "../codex-sessions.js";

// Single Codex instance per process (reused across messages)
let codexInstance: Codex | null = null;

function getCodex(): Codex {
  if (!codexInstance) {
    codexInstance = new Codex({
      // SDK spawns codex CLI, inherits auth from ~/.codex/
    });
  }
  return codexInstance;
}

export function createCodexAgentProvider(model: string): Provider {
  // Extract the underlying model from "codex-agent-o4-mini" → "o4-mini"
  const underlyingModel = model.replace(/^codex-agent-?/, "") || "o4-mini";

  return {
    name: "codex-agent",
    async chat(chatId, userMessage, onChunk, _image, allowedTools) {
      const codex = getCodex();

      // Resume existing thread or start new one
      const existingThreadId = chatId !== 0 ? getThreadId(chatId) : null;
      const thread = existingThreadId
        ? codex.resumeThread(existingThreadId)
        : codex.startThread({
            workingDirectory: getWorkspaceRoot(),
            skipGitRepoCheck: true,
          });

      // For new threads, prepend identity/memory context to the first message
      let prompt = userMessage;
      if (!existingThreadId) {
        const systemContext = await getCodexSystemPrompt();
        prompt = `<system>\n${systemContext}\n</system>\n\n${userMessage}`;
      }

      let responseText = "";

      try {
        const { events } = await thread.runStreamed(prompt);

        for await (const event of events) {
          if (event.type === "item.completed") {
            const text = extractTextFromEvent(event);
            if (text) {
              responseText = text;
              onChunk?.(responseText);
            }
          }
        }

        // Persist thread ID for session continuity
        if (chatId !== 0 && thread.id) {
          setThreadId(chatId, thread.id);
        }
      } catch (error: any) {
        console.error("[codex-agent] Error:", error.message);
        responseText = responseText || "Sorry, I hit an error. Try again.";
      }

      invalidatePromptCache();
      return responseText;
    },
  };
}
```

### Key Design Decisions

**System prompt injection:** The Codex SDK doesn't have a dedicated `systemPrompt` option. Prepend identity/memory context to the first message of a new thread, wrapped in `<system>` tags. On resumed threads, skip it — the context is already in the thread history. Same approach the current `openai.ts` uses with `instructions`.

**Custom tools — phased approach:**
- **Phase 1 (this PR):** No custom MCP tools. The Codex agent gets native Bash and file tools from the CLI. For memory, SSH, web search, etc., it can use Bash to run scripts or curl commands. This gets 80% of the value with minimal complexity.
- **Phase 2 (follow-up):** Add our custom tools via MCP. The `codex` CLI supports `codex mcp add <name> -- <command>` for stdio-based MCP servers. We'd create a standalone MCP server script that wraps our tool registry, and register it with the codex CLI. This gives the agent direct access to `update_memory`, `ssh`, `manage_schedule`, etc.

**Safety hooks:** Use the Codex SDK's `--full-auto` mode (`approval-policy: on-request` + `sandbox: workspace-write`). This allows file writes within the workspace but blocks dangerous system operations. For additional protection, the same `BLOCKED_BASH_PATTERNS` from `claude.ts` can be applied by intercepting events — but the codex CLI's sandbox should handle most cases. Start with the sandbox and add pattern blocking if needed.

**Streaming:** `thread.runStreamed()` returns an async iterable of events. Map `item.completed` events with assistant message content to `onChunk()` calls for Telegram streaming updates. Same 1.5s rate-limited edit pattern already in `telegram.ts`.

**Thread persistence:** `thread.id` is available after the first run. Store it via `codex-sessions.ts` (same pattern as `claude-sessions.ts`). `codex.resumeThread(threadId)` resumes with full context — the codex CLI manages session storage in `~/.codex/sessions`.

**Abort support:** The Codex SDK spawns a child process. To abort, we can kill the process. Track the active thread per chatId and provide an `abortCodexQuery(chatId)` function (mirroring `abortClaudeQuery`). Wire into the `/stop` Telegram command.

**Image handling:** Same as Claude — the Codex agent SDK accepts string prompts only. Images continue to route to the `imageModel` (GPT-5.2 via the Responses API). The codex-agent provider gets a text-only note when an image was attached.

### Step 4: Update provider routing

In `src/providers/index.ts`, add `codex-agent` routing before the existing OpenAI check:

```typescript
import { createCodexAgentProvider } from "./codex-agent.js";

function isCodexAgentModel(model: string): boolean {
  return model.startsWith("codex-agent");
}

function resolveProvider(): Provider {
  const model = config.model;
  if (isCodexAgentModel(model)) return createCodexAgentProvider(model);
  if (isOpenAiModel(model)) return createOpenAiProvider(model);
  // ... rest unchanged
}
```

### Step 5: Add model shortcuts

In `src/cli/commands/model.ts`:

| Shortcut | Model ID | Provider |
|----------|----------|----------|
| `codex-agent` | `codex-agent-o4-mini` | Codex Agent |
| `codex-agent-o3` | `codex-agent-o3` | Codex Agent |

The `codex-agent-` prefix triggers the provider routing. The suffix is the underlying OpenAI model passed to the codex CLI.

### Step 6: Handle Telegram commands

- **`/clear`** — call `clearThread(chatId)` (from `codex-sessions.ts`) in addition to `clearSession(chatId)` (Claude). The command handler in `telegram.ts` should call both.
- **`/stop`** — call `abortCodexQuery(chatId)` if the active provider is codex-agent. Same pattern as `abortClaudeQuery`.
- **`/session`** — show thread ID from `getThreadId(chatId)` when codex-agent is active.

### Step 7: CLI setup command

Add `chris codex login` / `chris codex status` commands (or document that users should run `codex login` directly). The codex CLI handles its own OAuth flow — we just need to verify the credentials exist.

## Verification Plan

1. `npm run typecheck` passes
2. `codex login` authenticates successfully (one-time)
3. `chris model set codex-agent` switches provider
4. Send a message — Codex agent responds with text
5. Send "list files in the current project" — agent uses native Bash/file tools
6. Send a follow-up — thread resumes (session persistence works)
7. `/clear` resets the thread
8. `/stop` aborts the running query
9. Streaming updates appear in Telegram during long operations
10. Scheduled tasks with `chatId: 0` use one-shot threads (no persistence)
