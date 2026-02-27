# Chris Assistant — Project Guide

## What This Is

A personal AI assistant for Chris Taylor, accessible through Telegram. Supports multiple AI providers (Claude, OpenAI, MiniMax). Memory and identity are stored as markdown in a separate private GitHub repo (configured via `GITHUB_MEMORY_REPO`).

## Architecture

```
chris-assistant/              ← This repo (bot server + CLI)
├── bin/chris                 # Shell wrapper for global CLI command
├── src/
│   ├── index.ts              # Bot entry point (starts Telegram long-polling)
│   ├── config.ts             # Loads .env, exports typed config object
│   ├── telegram.ts           # grammY bot — message handler (text/photo/document), streaming edits
│   ├── markdown.ts           # Standard markdown → Telegram MarkdownV2 converter
│   ├── middleware.ts          # grammY middleware — auth guard + rate limiting
│   ├── rate-limit.ts         # Sliding window rate limiter (10 msgs/min per user)
│   ├── health.ts             # Periodic health checks + Telegram alerts (startup, token expiry, GitHub)
│   ├── scheduler.ts          # Cron-like scheduled tasks — tick loop, AI execution, Telegram delivery
│   ├── conversation.ts       # Persistent short-term history (async I/O, write queue, last 20 messages)
│   ├── conversation-archive.ts # Daily JSONL archiver — every message saved to ~/.chris-assistant/archive/
│   ├── conversation-backup.ts # Periodic backup of conversations to GitHub memory repo (every 6 hours)
│   ├── conversation-summary.ts # Daily AI summarizer — generates conversation summaries at 23:55
│   ├── memory-consolidation.ts # Weekly memory consolidation — curates SUMMARY.md from all sources
│   ├── heartbeat.ts          # Periodic HEARTBEAT.md writer — bot status snapshot to GitHub (every 3h)
│   ├── claude-sessions.ts    # Claude Agent SDK session persistence (per-chat session IDs)
│   ├── providers/
│   │   ├── types.ts          # Provider interface ({ name, chat() }) + ImageAttachment type
│   │   ├── shared.ts         # System prompt builder — capabilities, formatting rules, project bootstrap, caching
│   │   ├── claude.ts         # Claude Agent SDK provider — full agent mode with native tools + streaming
│   │   ├── minimax.ts        # MiniMax provider (OpenAI-compatible API)
│   │   ├── minimax-oauth.ts  # MiniMax OAuth device flow + token storage
│   │   ├── openai.ts         # OpenAI provider — Codex Responses API + SSE streaming
│   │   ├── openai-oauth.ts   # OpenAI OAuth — authorization code + PKCE + account ID
│   │   ├── compaction.ts     # Context compaction — summarizes older turns when approaching context limit
│   │   ├── context-limits.ts # Model context window sizes + compaction thresholds (70% trigger)
│   │   └── index.ts          # Provider router — model string determines provider
│   ├── tools/
│   │   ├── registry.ts       # Shared tool registry — registerTool(), dispatch, MCP/OpenAI format gen
│   │   ├── index.ts          # Imports tool modules, re-exports registry functions
│   │   ├── memory.ts         # Registers update_memory tool with the registry
│   │   ├── web-search.ts     # Brave Search API tool (conditionally registered if API key set)
│   │   ├── fetch-url.ts      # URL fetcher tool — strips HTML, 15s timeout, 50KB truncation
│   │   ├── run-code.ts       # Code execution tool — JS/TS/Python/shell, 10s timeout, execFile
│   │   ├── files.ts          # File tools — read, write, edit, list, search (workspace-scoped)
│   │   ├── git.ts            # Git tools — status, diff, commit (workspace-scoped)
│   │   ├── scheduler.ts      # manage_schedule tool — create, list, delete, toggle scheduled tasks
│   │   ├── ssh.ts            # SSH tool — exec, tmux, SCP, Tailnet device discovery (8 actions)
│   │   ├── recall.ts         # Conversation recall tool — list, read, search, summarize past conversations
│   │   ├── journal.ts        # journal_entry tool — bot writes daily notes via tool call
│   │   └── market-snapshot.ts # market_snapshot tool — SSHes to Mac Mini to run tasty-coach market data
│   ├── memory/
│   │   ├── github.ts         # Octokit wrapper — read/write/append files in memory repo
│   │   ├── journal.ts        # Daily memory journal — local storage + periodic GitHub upload
│   │   ├── loader.ts         # Loads identity + knowledge + memory + summaries + journal, builds system prompt
│   │   └── tools.ts          # Memory tool executor + prompt injection validation
│   └── cli/
│       ├── index.ts           # Commander.js program — registers all subcommands
│       ├── pm2-helper.ts      # pm2 connection helper, process info, constants
│       └── commands/
│           ├── start.ts       # chris start — pm2 start with tsx interpreter
│           ├── stop.ts        # chris stop
│           ├── restart.ts     # chris restart
│           ├── status.ts      # chris status — pid, uptime, memory, restarts
│           ├── logs.ts        # chris logs [-f] — tail pm2 logs
│           ├── memory.ts      # chris memory status|show|edit|search
│           ├── identity.ts    # chris identity [edit] — view/edit SOUL.md
│           ├── config.ts      # chris config [get|set] — manage .env
│           ├── model.ts       # chris model [set] — view/change AI model + provider
│           ├── doctor.ts      # chris doctor [--fix] — diagnostic checks + auto-repair
│           ├── setup.ts       # chris setup — interactive first-time wizard
│           ├── minimax-login.ts # chris minimax login|status — OAuth device flow
│           └── openai-login.ts  # chris openai login|status — browser OAuth + callback server

chris-assistant-memory/       ← Separate private repo (the brain)
├── HEARTBEAT.md              # Bot self-reported status snapshot (updated every 3h by heartbeat.ts)
├── identity/SOUL.md          # Personality, purpose, onboarding instructions
├── identity/RULES.md         # Hard boundaries
├── identity/VOICE.md         # Tone and language
├── knowledge/about-chris.md  # Facts about Chris
├── knowledge/preferences.md  # Likes, dislikes, style
├── knowledge/projects.md     # Current work
├── knowledge/people.md       # People mentioned
├── memory/decisions.md       # Important decisions
├── memory/learnings.md       # Self-improvement notes
├── memory/SUMMARY.md         # Weekly-consolidated curated summary (generated by memory-consolidation.ts)
├── archive/2026-02-25.jsonl  # Daily JSONL message logs (uploaded every 6 hours)
├── journal/2026-02-25.md     # Bot's daily journal notes (uploaded every 6 hours)
└── conversations/summaries/2026-02-25.md  # AI-generated daily conversation summaries
```

## Key Design Decisions

- **Multi-provider**: The model string determines the provider. `gpt-*`/`o3*`/`o4-*` → OpenAI, `MiniMax-*` → MiniMax, everything else → Claude. No separate "provider" config key.
- **Claude Agent SDK as primary agent**: When Claude is the active model, the bot uses the `@anthropic-ai/claude-agent-sdk` as a full agent. Claude Code's native tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, etc.) run natively — far better than hand-rolled versions. Custom tools (memory, SSH, scheduler, recall, journal, market_snapshot) are exposed via an in-process MCP server. The system prompt uses `{ type: 'preset', preset: 'claude_code', append: <identity/memory> }` to extend Claude Code's default prompt with personality and knowledge. Session persistence via `resume` gives multi-turn conversation context without manual history management. Extended thinking is keyword-triggered ("think" → 10k tokens, "think hard" → 50k). Authenticated through Max subscription via the `claude` CLI (same auth Claude Code uses). `/stop` aborts the active query, `/session` shows session info, `/clear` resets the session.
- **Claude session persistence**: `src/claude-sessions.ts` stores session IDs per chat in `~/.chris-assistant/claude-sessions.json`. Each message passes `resume: sessionId` to continue the conversation. Scheduled tasks (chatId 0) use one-shot queries with `persistSession: false`. The SDK manages its own context window — no manual conversation history formatting needed for Claude.
- **Custom vs native tools**: `registry.ts` has `NATIVE_CLAUDE_TOOLS` set — tools Claude Code handles natively. `getCustomMcpTools()` returns only non-native tools for the Claude provider's MCP server. `getCustomMcpAllowedToolNames()` generates the corresponding allowed tool names. OpenAI/MiniMax providers still use all registered tools as before.
- **Authentication**: OpenAI uses authorization code OAuth + PKCE (`chris openai login`) — opens browser, local callback server on port 1455. Tokens + account ID in `~/.chris-assistant/openai-auth.json` with auto-refresh. Account ID is extracted from JWT for `chatgpt-account-id` header. MiniMax uses OAuth device flow (`chris minimax login`) — tokens in `~/.chris-assistant/minimax-auth.json`. Claude is optional — requires `CLAUDE_CODE_OAUTH_TOKEN` in `.env` from a Max subscription.
- **Streaming responses**: All three providers stream via the `onChunk` callback in the Provider interface. OpenAI streams via SSE from the Codex Responses API (`response.output_text.delta` events). MiniMax streams via the OpenAI SDK. Claude streams via the Agent SDK's `includePartialMessages` option — `SDKAssistantMessage` content blocks are extracted and fed to `onChunk()`. `telegram.ts` sends a "..." placeholder and edits it every 1.5s with accumulated text + cursor (▍). Final render uses Markdown with plain text fallback.
- **Image and document handling**: `telegram.ts` handles `message:photo` and `message:document` in addition to `message:text`. Photos are downloaded from Telegram, base64-encoded, and passed via `ImageAttachment` in the Provider interface. All images are routed to `config.imageModel` (default `gpt-5.2`) via OpenAI regardless of the active provider — `providers/index.ts` intercepts images before provider dispatch. Claude Agent SDK only accepts string prompts, so images get a text-only fallback if Claude is the image model (it shouldn't be). Text documents are downloaded, read as UTF-8, and prepended to the message (50KB truncation). Unsupported file types get a helpful error.
- **Web search tool**: `src/tools/web-search.ts` — Brave Search API, conditionally registered only when `BRAVE_SEARCH_API_KEY` is set. Supports optional `count` (1-10, default 5), `freshness` (pd/pw/pm/py), and `country` params. No new npm deps (native fetch). All providers pick it up automatically via the tool registry.
- **URL fetch tool**: `src/tools/fetch-url.ts` — always registered, native `fetch` with 15s timeout (AbortController). HTML pages are extracted via Mozilla Readability + linkedom for clean article content (strips nav, ads, footers), falling back to regex stripping if Readability returns nothing. 50KB truncation. No API key needed. SSRF protection blocks private/internal IPs (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10) and `localhost` via DNS resolution before fetching.
- **File tools**: `src/tools/files.ts` — 5 tools (`read_file`, `write_file`, `edit_file`, `list_files`, `search_files`) scoped to `WORKSPACE_ROOT` (default `~/Projects`). All paths resolved relative to workspace root with a guard that rejects traversal outside it. `edit_file` requires exactly one match of `old_string`. `list_files` uses `find` with `node_modules`/`.git` pruning, capped at 200 results. `search_files` uses `grep -rn` with optional `--include` glob filter.
- **Code execution tool**: `src/tools/run-code.ts` — uses `child_process.execFile` (not `exec`) to avoid shell injection. Supports JS (`node -e`), TS (tsx binary from node_modules), Python (`python3 -c`), shell (`bash -c`). 10s timeout, 1MB buffer, 50KB output truncation. `NODE_NO_WARNINGS=1` suppresses experimental warnings. Env vars are allowlisted (PATH, HOME, SHELL, LANG, TMPDIR, etc.) — secrets are never passed to child processes. `cwd` is set to `getWorkspaceRoot()`. Dangerous command blocklist (`DANGEROUS_PATTERNS`) blocks `pm2`, `kill.*chris-assistant`, `systemctl restart/stop`, `reboot`, `shutdown`, and `rm -rf /` — prevents the bot from restarting or destroying itself via code execution.
- **Claude Bash safety hook**: When Claude is the primary agent, its native Bash tool bypasses the tool registry (and therefore `DANGEROUS_PATTERNS` in `run-code.ts`). A `PreToolUse` hook in `src/providers/claude.ts` intercepts every Bash command before execution and blocks the same dangerous patterns plus `npm run start/dev` and `chris start/stop/restart`. Denied commands return a message telling Claude to ask Chris to restart manually. This prevents the restart loop that occurs when Claude runs `pm2 restart` via native Bash.
- **Memory tool**: All providers support `update_memory`. Claude uses MCP (in-process server). OpenAI and MiniMax use OpenAI-format function calling. All delegate to the same `executeMemoryTool()` function.
- **Memory storage**: Markdown files in a private GitHub repo. Every update is a git commit — fully auditable and rollback-able.
- **Persistent conversation history**: Last 20 messages per chat stored in `~/.chris-assistant/conversations.json`. Loaded lazily on first access, saved asynchronously via a write queue that serializes concurrent saves. Callers use fire-and-forget for `addMessage()` and await `clearHistory()`. Survives restarts. `/clear` wipes both memory and disk.
- **Conversation backup**: `conversation-backup.ts` backs up `conversations.json` to `backups/conversations.json` in the memory repo every 6 hours. Uses SHA-256 hashing to skip unchanged content. Runs an immediate backup on startup. Integrated into `index.ts` lifecycle.
- **Conversation archive**: `conversation-archive.ts` appends every message (user + assistant) as a JSONL line to `~/.chris-assistant/archive/YYYY-MM-DD.jsonl` via synchronous `appendFileSync` (microseconds, never throws). Called from `addMessage()` in `conversation.ts` before the rolling window trims old messages. A periodic uploader (every 6 hours, like conversation-backup) pushes changed archive files to `archive/YYYY-MM-DD.jsonl` in the memory repo using SHA-256 dedup. Exports `readLocalArchive(date)`, `listLocalArchiveDates()`, `datestamp()`, and `localArchivePath()` for use by the recall tool and summarizer.
- **Daily conversation summaries**: `conversation-summary.ts` is a built-in module (not a user-managed schedule — can't be accidentally deleted). Ticks every 60s, fires at 23:55 local time. Reads today's local archive, formats as conversation text, calls `chat()` with a summarization prompt, and writes the result to `conversations/summaries/YYYY-MM-DD.md` in the memory repo. On startup, backfills yesterday's summary if messages exist but no summary was generated (handles overnight restarts). Uses chatId 0 for internal system calls. Strips thinking tags from reasoning model output.
- **Conversation recall tool**: `src/tools/recall.ts` — single `recall_conversations` tool (category `"always"`) with 4 actions: `list` (show available archive dates with message counts), `read_day` (read a day's AI summary or full conversation log), `search` (grep across all local JSONL archives for a keyword, capped at 50 results), `summarize` (generate an on-demand AI summary for any date). Follows the same multi-action pattern as the SSH tool.
- **Recent summaries in system prompt**: `loader.ts` loads the last 7 days of daily summaries from `conversations/summaries/YYYY-MM-DD.md` in the memory repo (in parallel with identity/knowledge/memory loads). Added to the `LoadedMemory` interface as `recentSummaries`. Injected as a `# Recent Conversation History` section in `buildSystemPrompt()`. This gives the bot natural recall of recent conversations without needing a tool call.
- **Daily memory journal**: `src/memory/journal.ts` — the bot writes structured notes throughout the day via the `journal_entry` tool (`src/tools/journal.ts`). Entries are appended to `~/.chris-assistant/journal/YYYY-MM-DD.md` as timestamped markdown (sync `appendFileSync`, never throws). Each entry gets a `**HH:MM AM/PM** — text` format with a date header auto-added for new files. A periodic uploader (every 6 hours) pushes changed journals to `journal/YYYY-MM-DD.md` in the memory repo using SHA-256 dedup. Today's and yesterday's journals are loaded into the system prompt via `loader.ts` as a `# Your Recent Journal` section. The daily summary at 23:55 now incorporates journal entries alongside raw messages for richer consolidation. The `recall_conversations` tool has a `read_journal` action for reading past journal entries. The tool has a 2000 char limit per entry to keep notes concise.
- **Weekly memory consolidation**: `src/memory-consolidation.ts` — built-in module (like the daily summarizer) that fires Sunday at 23:00 local time. Reads all knowledge files, memory files, past 7 days of conversation summaries and journal entries, plus the existing `memory/SUMMARY.md`. Calls `chat(0, prompt)` with a consolidation prompt that produces a curated, topic-organized markdown document about Chris. Writes to `memory/SUMMARY.md` in the GitHub memory repo (32K char cap). ISO week tracking prevents double-fire. On startup, runs immediately if SUMMARY.md doesn't exist yet. `loader.ts` loads SUMMARY.md in parallel and injects it as a `# Curated Memory` section in the system prompt between Identity and Knowledge. The split knowledge files remain the source of truth for `update_memory` tool calls — SUMMARY.md is a read-only consolidated view.
- **Heartbeat file**: `src/heartbeat.ts` — writes `HEARTBEAT.md` to the root of the GitHub memory repo every 3 hours (+ immediately on startup). Collects uptime, started-at timestamp, current model/provider, health status for GitHub repo and MiniMax/OpenAI tokens (with warning thresholds matching `health.ts`), all scheduled tasks with cron expressions and last-run times, last message relative time (from `conversations.json`), and today's message count (from JSONL archive line count). SHA-256 dedup skips unchanged writes. Reads `conversations.json` directly via `fs` (no import from `conversation.ts`) to avoid circular deps. Integrated into `index.ts` lifecycle.
- **System prompt caching**: Memory files are loaded from GitHub and cached for 5 minutes. Cache invalidates after any conversation (in case memory was updated). Shared across providers via `providers/shared.ts`.
- **Tool loop detection**: `registry.ts` has two layers: (1) exact-duplicate check — 3 consecutive identical calls (same name + args) triggers a break; (2) per-tool frequency counter — 20 calls to the same tool name in one conversation triggers a hard stop. Both cover `dispatchToolCall()` (OpenAI/MiniMax) and MCP executor (Claude). State resets between conversations via `invalidatePromptCache()`.
- **Tool turn limit**: All three providers share `config.maxToolTurns` (default 200, env `MAX_TOOL_TURNS`). Set high because SSH investigations and coding work need many turns; context compaction keeps conversations within the model's window. The "ran out of processing turns" message fires if exhausted.
- **Context compaction**: `providers/compaction.ts` summarizes older conversation turns when approaching the model's context window limit (70% threshold, defined in `providers/context-limits.ts`). OpenAI compaction parses SSE responses (`compactCodexInput()`). MiniMax compaction uses the OpenAI SDK (`compactMessages()`). This allows the tool loop to continue indefinitely instead of hitting a hard context ceiling.
- **Git tools**: `src/tools/git.ts` — 3 tools: `git_status` (short format), `git_diff` (optional `staged` flag for `--cached`), `git_commit` (optional `files` array to stage before committing). All use `git -C <workspaceRoot>`. No `git_push` — deliberate safety choice to prevent unreviewed pushes. 50KB truncation on diff output.
- **Project bootstrap files**: `shared.ts` checks for `CLAUDE.md`, `AGENTS.md`, `README.md` (in that order) in the active workspace root. First found is loaded, truncated to 20K chars, and injected as a `# Project Context` section in the system prompt. Workspace change callback invalidates the prompt cache so bootstrap reloads for the new project.
- **Workspace root**: File tools scope to `WORKSPACE_ROOT` (default `~/Projects`). Mutable at runtime via `/project` Telegram command or `setWorkspaceRoot()`. The guard in `resolveSafePath()` uses `fs.realpathSync` to canonicalize paths (following symlinks) before the boundary check — a symlink inside the workspace pointing outside it will be rejected.
- **Telegram command menu**: Bot registers `/start`, `/clear`, `/stop`, `/session`, `/model`, `/memory`, `/project`, `/reload`, `/restart`, `/help` via `setMyCommands` on startup. Commands appear in Telegram's bot menu. `/model` shows current model/provider. `/memory` lists all memory files with sizes from GitHub. `/reload` invalidates the system prompt cache so the next message reloads memory from GitHub. `/stop` aborts the current Claude query via AbortController. `/session` shows the active Claude session ID. `/clear` resets both conversation history and Claude session.
- **Middleware pipeline**: `src/middleware.ts` exports `authMiddleware` and `rateLimitMiddleware`, composed via `bot.use()` before all handlers. Auth guard only responds to `TELEGRAM_ALLOWED_USER_ID` (unauthorized `/start` gets a polite rejection; all others silently ignored). Rate limiter enforces 10 messages/minute sliding window. Both concerns are removed from individual handlers.
- **Automated tests**: vitest suite in `tests/` — `markdown.test.ts`, `path-guard.test.ts`, `loop-detection.test.ts` (48 tests). CI via `.github/workflows/ci.yml` runs typecheck + tests on push/PR. Test files set dummy env vars before imports to avoid config.ts throwing. Run with `npm test`.
- **Memory guard**: `validateMemoryContent()` in `memory/tools.ts` defends against prompt injection — 2000 char limit, replace throttle (1 per 5 min per category), injection phrase detection, dangerous shell block detection, path traversal blocking.
- **Health monitor**: `health.ts` sends a Telegram startup notification, runs health checks every 5 minutes (GitHub access, token expiry), and alerts the owner with dedup (1 hour re-alert) and recovery messages. Token checks use two-tier warnings: MiniMax warns 30 minutes before expiry, OpenAI warns 1 hour before (only when no refresh token). Fully expired tokens get stronger wording.
- **Scheduled tasks**: `scheduler.ts` loads tasks from `~/.chris-assistant/schedules.json`, ticks every 60s, and fires matching tasks by sending the prompt to `chat()`. Results sent to Telegram via raw fetch (same pattern as `health.ts`). Custom cron matcher supports `*`, specific values, commas, and `*/N` step values — no npm dependency. The `manage_schedule` tool (category `"always"`) lets the AI create, list, delete, and toggle schedules. Double-fire prevention checks that `lastRun` wasn't in the same minute. Each schedule has an optional `allowedTools` field — when set, only those tools are available during execution (e.g. `["ssh", "web_search"]`). When omitted, all tools are available. The `allowed_tools` parameter on `manage_schedule` create action passes through to the schedule. Tool filtering threads through `chat()` → provider → `getOpenAiToolDefinitions()`/`getMcpAllowedToolNames()` via a `filterTools(includeCoding, allowedTools?)` function in `registry.ts`.
- **SSH tool**: `src/tools/ssh.ts` — single tool with 8 actions for remote device management via Tailscale. `exec` creates persistent tmux sessions (`chris-bot-<host>-<id>`) and SSHs in to run commands, polling until the shell prompt returns or timeout. `send_keys` / `read_pane` interact with existing sessions. `devices` queries `tailscale status --json`. `scp_push` / `scp_pull` transfer files with local path validation via `resolveSafePath()`. All commands use `execFile` (no shell injection), absolute binary paths (works under pm2), `BatchMode=yes` (no password prompts), and `ConnectTimeout=10`. Tmux sessions are attachable from any device (e.g. iPhone via SSH).
- **pm2 process management**: The bot runs as a pm2 process. The CLI uses pm2's programmatic API. pm2 can't find `tsx` via PATH so we use the absolute path from `node_modules/.bin/tsx` as the interpreter.
- **CLI global install**: `npm link` creates a global `chris` command. The `bin/chris` shell wrapper follows symlinks to resolve the real project root and finds tsx from node_modules.

## Tech Stack

- **Runtime**: Node.js 22+ / TypeScript
- **AI (Claude)**: `@anthropic-ai/claude-agent-sdk` with Max subscription OAuth token
- **AI (OpenAI)**: Raw fetch to Codex Responses API (`chatgpt.com/backend-api/codex/responses`) with ChatGPT OAuth
- **AI (MiniMax)**: `openai` npm package with custom baseURL (`https://api.minimax.io/v1`)
- **Telegram**: grammY
- **Memory**: `@octokit/rest` for GitHub API
- **CLI**: Commander.js
- **Process management**: pm2
- **Dev**: tsx for TypeScript execution without build step

## Environment Variables (.env)

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | Your numeric Telegram user ID |
| `GITHUB_TOKEN` | Fine-grained PAT with Contents read/write on memory repo only |
| `GITHUB_MEMORY_REPO` | `owner/repo` format — your private memory repo |
| `AI_MODEL` | Model ID — determines provider. Defaults to `gpt-4o`. Accepts `CLAUDE_MODEL` for back-compat. |
| `IMAGE_MODEL` | Optional — model for image processing. Defaults to `gpt-5.2`. All image messages route here regardless of active provider. |
| `BRAVE_SEARCH_API_KEY` | Optional — Brave Search API key for web search tool |
| `WORKSPACE_ROOT` | Optional — root directory for file tools. Defaults to `~/Projects`. Changeable at runtime via `/project` command. |
| `MAX_TOOL_TURNS` | Optional — max tool call rounds per message. Defaults to `200`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Optional — only needed to use Claude models |

Note: OpenAI uses authorization code OAuth (browser-based, `chris openai login`). MiniMax uses OAuth device flow (`chris minimax login`). Tokens stored in `~/.chris-assistant/`. Claude is optional and requires `CLAUDE_CODE_OAUTH_TOKEN` in `.env`.

## Common Operations

```bash
# First-time setup
chris setup              # Interactive wizard to create .env
chris doctor             # Verify all connections

# Daily use
chris start              # Start (or restart) the bot via pm2
chris status             # Check if running, uptime, memory usage
chris logs -f            # Live tail logs
chris stop               # Stop the bot

# Model / provider
chris model              # Show current model, provider, and shortcuts
chris model set gpt5     # Switch to OpenAI GPT-5.2
chris model set codex    # Switch to GPT-5.3-Codex
chris model set sonnet   # Switch back to Claude Sonnet
chris model search       # List all models across all providers
chris model search openai # Filter by provider/name/description

# OpenAI OAuth
chris openai login       # Authenticate via browser OAuth (opens browser, callback on port 1455)
chris openai status      # Check token + account ID status

# MiniMax OAuth
chris minimax login      # Authenticate via OAuth device flow (no API key needed)
chris minimax status     # Check token expiry

# Memory management
chris memory status      # List files with sizes
chris memory show <file> # Print a file (e.g. about-chris, soul, preferences)
chris memory edit <file> # Edit in $EDITOR, push to GitHub
chris memory search <q>  # Search across all memory files

# Identity
chris identity           # Print SOUL.md
chris identity edit      # Edit SOUL.md in $EDITOR

# Config
chris config             # Show all (secrets redacted)
chris config set KEY val # Update .env value

# Running as daemon on Mac Mini
pm2 startup              # Enable pm2 auto-start on reboot
pm2 save                 # Save current process list
```

## Development

```bash
npm run dev              # Run bot with tsx watch (auto-reload on changes)
npm run typecheck        # TypeScript type checking
npm test                 # Run vitest test suite (48 tests)
npx tsx src/cli/index.ts # Run CLI directly without global install
```

## Important Gotchas

- **pm2 PATH isolation**: pm2 spawns processes in its own daemon. It doesn't inherit your shell PATH. That's why `pm2-helper.ts` exports `TSX_BIN` as an absolute path to `node_modules/.bin/tsx`.
- **Node.js console.log**: Does not support C-style `%-16s` padding. Use `String.padEnd()` instead.
- **Telegram MarkdownV2**: `markdown.ts` converts standard AI markdown to MarkdownV2. Key difference: `*bold*` not `**bold**`, `_italic_` not `*italic*`. 18 special chars must be escaped in plain text, fewer in code/URL contexts. If conversion fails, `telegram.ts` falls back to plain text. Streaming preview uses no parse_mode (partial MarkdownV2 would fail).
- **Telegram message limit**: 4096 characters max. `telegram.ts` has a `splitMessage()` function that breaks at paragraph then sentence boundaries. Splitting happens on original text before MarkdownV2 conversion (escaping inflates length).
- **Telegram streaming rate limit**: `telegram.ts` rate-limits `editMessageText` calls to one per 1.5 seconds during streaming. Edits are fire-and-forget (`.catch(() => {})`) so failures don't interrupt the stream.
- **Thinking tags**: Reasoning models (o3, MiniMax, etc.) may emit `<think>...</think>` blocks. `telegram.ts` strips these both during streaming preview and in the final response. Providers (`minimax.ts`, `openai.ts`) also strip them during streaming. **Important**: Never use `</` inside regex literals anywhere in the codebase — esbuild misparses it as an HTML closing tag and throws a `TransformError` that crashes the bot. Use `new RegExp("<" + "/tag>", "g")` instead. The `npm run typecheck` command includes an automated check (`scripts/check-esbuild-compat.js`) that catches this.
- **`chris doctor --fix`**: Runs typecheck, checks error logs for common patterns (TransformError, missing modules), runs `npm install` if needed, then restarts the bot and verifies it comes back online. The regular `chris doctor` (without `--fix`) now shows the last error message and restart count when the bot is errored.
- **Web search tool is optional**: Only registered when `BRAVE_SEARCH_API_KEY` is set. When absent, the tool definition is not sent to any provider — no dead tools in the API call.
- **Memory cache**: System prompt is cached 5 minutes. After any conversation the cache is invalidated. Manually edited memory files via `chris memory edit` won't be picked up until the cache expires or the bot restarts.
- **GitHub fine-grained PAT expiry**: Max 1 year. Set a reminder to rotate.
- **Adding new tools**: Create `src/tools/<name>.ts` with a `registerTool()` call, then add `import "./<name>.js"` to `src/tools/index.ts`. All three providers pick it up automatically — no provider code changes needed.
- **Adding new providers**: Create `src/providers/<name>.ts` implementing the `Provider` interface, add a prefix check in `src/providers/index.ts`, and add model shortcuts to `src/cli/commands/model.ts`. For OpenAI-compatible providers, use `getOpenAiToolDefinitions()` and `dispatchToolCall()` from `src/tools/index.ts`.
- **MiniMax OAuth API**: The `/oauth/code` endpoint requires `response_type: "code"` in the body. The `expired_in` field is a unix timestamp in **milliseconds** (not a duration). Token poll responses use a `status` field (`"success"` / `"pending"` / `"error"`) — don't rely on HTTP status codes. Tokens are stored in `~/.chris-assistant/minimax-auth.json`.
- **OpenAI Codex OAuth**: Authorization code + PKCE flow — opens browser to `auth.openai.com/oauth/authorize`, local callback server on port 1455 catches the redirect, exchanges code for tokens. Account ID extracted from JWT (`payload["https://api.openai.com/auth"].chatgpt_account_id`). Tokens auto-refresh via refresh_token grant. Tokens + account ID in `~/.chris-assistant/openai-auth.json`.
- **Codex Responses API constraints**: The `chatgpt.com/backend-api/codex/responses` endpoint requires `stream: true` and `store: false` in every request — there is no non-streaming mode. Headers must include `chatgpt-account-id` and `OpenAI-Beta: responses=experimental`. Only GPT-5.x models work; older models (gpt-4o, gpt-4.1) return a 400 error. Tool definitions use a flat format (`{ type, name, description, parameters }`) instead of the nested Chat Completions format.
- **SSH config and pm2**: The SSH tool uses raw IPs/hostnames from Tailscale. The `~/.ssh/config` `Host` line must include both the alias and the IP (e.g. `Host office 100.99.188.80`) for SSH to resolve the correct user and identity file when the bot connects by IP. Without the IP in the `Host` line, SSH falls through to defaults (wrong user).
