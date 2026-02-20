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
│   ├── rate-limit.ts         # Sliding window rate limiter (10 msgs/min per user)
│   ├── health.ts             # Periodic health checks + Telegram alerts (startup, token expiry, GitHub)
│   ├── scheduler.ts          # Cron-like scheduled tasks — tick loop, AI execution, Telegram delivery
│   ├── conversation.ts       # Persistent short-term history (last 20 messages, saved to ~/.chris-assistant/conversations.json)
│   ├── providers/
│   │   ├── types.ts          # Provider interface ({ name, chat() }) + ImageAttachment type
│   │   ├── shared.ts         # System prompt caching + model info injection
│   │   ├── claude.ts         # Claude Agent SDK provider
│   │   ├── minimax.ts        # MiniMax provider (OpenAI-compatible API)
│   │   ├── minimax-oauth.ts  # MiniMax OAuth device flow + token storage
│   │   ├── openai.ts         # OpenAI provider (GPT-4o, o3, etc.)
│   │   ├── openai-oauth.ts   # OpenAI Codex OAuth device flow + token storage
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
│   │   └── scheduler.ts      # manage_schedule tool — create, list, delete, toggle scheduled tasks
│   ├── memory/
│   │   ├── github.ts         # Octokit wrapper — read/write/append files in memory repo
│   │   ├── loader.ts         # Loads identity + knowledge + memory files, builds system prompt
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
│           ├── doctor.ts      # chris doctor — diagnostic checks
│           ├── setup.ts       # chris setup — interactive first-time wizard
│           ├── minimax-login.ts # chris minimax login|status — OAuth device flow
│           └── openai-login.ts  # chris openai login|status — Codex OAuth device flow

chris-assistant-memory/       ← Separate private repo (the brain)
├── identity/SOUL.md          # Personality, purpose, onboarding instructions
├── identity/RULES.md         # Hard boundaries
├── identity/VOICE.md         # Tone and language
├── knowledge/about-chris.md  # Facts about Chris
├── knowledge/preferences.md  # Likes, dislikes, style
├── knowledge/projects.md     # Current work
├── knowledge/people.md       # People mentioned
├── memory/decisions.md       # Important decisions
└── memory/learnings.md       # Self-improvement notes
```

## Key Design Decisions

- **Multi-provider**: The model string determines the provider. `gpt-*`/`o3*`/`o4-*` → OpenAI, `MiniMax-*` → MiniMax, everything else → Claude. No separate "provider" config key.
- **Authentication**: OpenAI (default) uses Codex OAuth device flow (`chris openai login`) — tokens in `~/.chris-assistant/openai-auth.json` with auto-refresh. MiniMax uses OAuth device flow (`chris minimax login`) — tokens in `~/.chris-assistant/minimax-auth.json`. Claude is optional — requires `CLAUDE_CODE_OAUTH_TOKEN` in `.env` from a Max subscription.
- **Streaming responses**: OpenAI and MiniMax providers stream via `onChunk` callback in the Provider interface. `telegram.ts` sends a "..." placeholder and edits it every 1.5s with accumulated text + cursor (▍). Claude SDK doesn't expose token streaming yet. Final render uses Markdown with plain text fallback.
- **Image and document handling**: `telegram.ts` handles `message:photo` and `message:document` in addition to `message:text`. Photos are downloaded from Telegram, base64-encoded, and passed via `ImageAttachment` in the Provider interface. OpenAI/MiniMax use `image_url` content parts. Claude Agent SDK only accepts string prompts, so images get a text-only fallback. Text documents are downloaded, read as UTF-8, and prepended to the message (50KB truncation). Unsupported file types get a helpful error.
- **Web search tool**: `src/tools/web-search.ts` — Brave Search API, conditionally registered only when `BRAVE_SEARCH_API_KEY` is set. Returns top 5 results. No new npm deps (native fetch). All providers pick it up automatically via the tool registry.
- **URL fetch tool**: `src/tools/fetch-url.ts` — always registered, native `fetch` with 15s timeout (AbortController), HTML stripping (script/style removal, tag stripping, entity decoding), 50KB truncation. No API key needed.
- **File tools**: `src/tools/files.ts` — 5 tools (`read_file`, `write_file`, `edit_file`, `list_files`, `search_files`) scoped to `WORKSPACE_ROOT` (default `~/Projects`). All paths resolved relative to workspace root with a guard that rejects traversal outside it. `edit_file` requires exactly one match of `old_string`. `list_files` uses `find` with `node_modules`/`.git` pruning, capped at 200 results. `search_files` uses `grep -rn` with optional `--include` glob filter.
- **Code execution tool**: `src/tools/run-code.ts` — uses `child_process.execFile` (not `exec`) to avoid shell injection. Supports JS (`node -e`), TS (tsx binary from node_modules), Python (`python3 -c`), shell (`bash -c`). 10s timeout, 1MB buffer, 50KB output truncation. `NODE_NO_WARNINGS=1` suppresses experimental warnings.
- **Memory tool**: All providers support `update_memory`. Claude uses MCP (in-process server). OpenAI and MiniMax use OpenAI-format function calling. All delegate to the same `executeMemoryTool()` function.
- **Memory storage**: Markdown files in a private GitHub repo. Every update is a git commit — fully auditable and rollback-able.
- **Persistent conversation history**: Last 20 messages per chat stored in `~/.chris-assistant/conversations.json`. Loaded lazily on first access, saved synchronously after each message. Survives restarts. `/clear` wipes both memory and disk.
- **System prompt caching**: Memory files are loaded from GitHub and cached for 5 minutes. Cache invalidates after any conversation (in case memory was updated). Shared across providers via `providers/shared.ts`.
- **Tool loop detection**: `registry.ts` tracks consecutive identical tool calls (same name + first 500 chars of args). After 3 in a row, returns an error to the AI. Covers both `dispatchToolCall()` (OpenAI/MiniMax) and MCP executor (Claude). State resets between conversations via `invalidatePromptCache()`.
- **Tool turn limit**: All three providers share `config.maxToolTurns` (default 15, env `MAX_TOOL_TURNS`). Coding work needs many turns (read → edit → test → fix). The "ran out of processing turns" message fires if exhausted.
- **Git tools**: `src/tools/git.ts` — 3 tools: `git_status` (short format), `git_diff` (optional `staged` flag for `--cached`), `git_commit` (optional `files` array to stage before committing). All use `git -C <workspaceRoot>`. No `git_push` — deliberate safety choice to prevent unreviewed pushes. 50KB truncation on diff output.
- **Project bootstrap files**: `shared.ts` checks for `CLAUDE.md`, `AGENTS.md`, `README.md` (in that order) in the active workspace root. First found is loaded, truncated to 20K chars, and injected as a `# Project Context` section in the system prompt. Workspace change callback invalidates the prompt cache so bootstrap reloads for the new project.
- **Workspace root**: File tools scope to `WORKSPACE_ROOT` (default `~/Projects`). Mutable at runtime via `/project` Telegram command or `setWorkspaceRoot()`. The guard in `resolveSafePath()` uses `fs.realpathSync` to canonicalize paths (following symlinks) before the boundary check — a symlink inside the workspace pointing outside it will be rejected.
- **Telegram command menu**: Bot registers `/start`, `/clear`, `/model`, `/memory`, `/project`, `/reload`, `/help` via `setMyCommands` on startup. Commands appear in Telegram's bot menu. `/model` shows current model/provider. `/memory` lists all memory files with sizes from GitHub. `/reload` invalidates the system prompt cache so the next message reloads memory from GitHub.
- **User guard**: Only responds to `TELEGRAM_ALLOWED_USER_ID`. All other users are silently ignored.
- **Rate limiting**: Sliding window limiter (10 messages/minute per user) in `rate-limit.ts`. Checked in `telegram.ts` before processing. Returns retry-after seconds when triggered.
- **Memory guard**: `validateMemoryContent()` in `memory/tools.ts` defends against prompt injection — 2000 char limit, replace throttle (1 per 5 min per category), injection phrase detection, dangerous shell block detection, path traversal blocking.
- **Health monitor**: `health.ts` sends a Telegram startup notification, runs health checks every 5 minutes (GitHub access, token expiry), and alerts the owner with dedup (1 hour re-alert) and recovery messages.
- **Scheduled tasks**: `scheduler.ts` loads tasks from `~/.chris-assistant/schedules.json`, ticks every 60s, and fires matching tasks by sending the prompt to `chat()` with full tool access. Results sent to Telegram via raw fetch (same pattern as `health.ts`). Custom cron matcher supports `*`, specific values, commas, and `*/N` step values — no npm dependency. The `manage_schedule` tool (category `"always"`) lets the AI create, list, delete, and toggle schedules. Double-fire prevention checks that `lastRun` wasn't in the same minute.
- **pm2 process management**: The bot runs as a pm2 process. The CLI uses pm2's programmatic API. pm2 can't find `tsx` via PATH so we use the absolute path from `node_modules/.bin/tsx` as the interpreter.
- **CLI global install**: `npm link` creates a global `chris` command. The `bin/chris` shell wrapper follows symlinks to resolve the real project root and finds tsx from node_modules.

## Tech Stack

- **Runtime**: Node.js 22+ / TypeScript
- **AI (Claude)**: `@anthropic-ai/claude-agent-sdk` with Max subscription OAuth token
- **AI (OpenAI)**: `openai` npm package with Codex OAuth (ChatGPT Plus/Pro subscription)
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
| `BRAVE_SEARCH_API_KEY` | Optional — Brave Search API key for web search tool |
| `WORKSPACE_ROOT` | Optional — root directory for file tools. Defaults to `~/Projects`. Changeable at runtime via `/project` command. |
| `MAX_TOOL_TURNS` | Optional — max tool call rounds per message. Defaults to `15`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Optional — only needed to use Claude models |

Note: OpenAI and MiniMax use OAuth device flows with tokens stored in `~/.chris-assistant/`. Claude is optional and requires `CLAUDE_CODE_OAUTH_TOKEN` in `.env`.

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
chris openai login       # Authenticate via Codex OAuth device flow (uses ChatGPT subscription)
chris openai status      # Check token status

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
npx tsx src/cli/index.ts # Run CLI directly without global install
```

## Important Gotchas

- **pm2 PATH isolation**: pm2 spawns processes in its own daemon. It doesn't inherit your shell PATH. That's why `pm2-helper.ts` exports `TSX_BIN` as an absolute path to `node_modules/.bin/tsx`.
- **Node.js console.log**: Does not support C-style `%-16s` padding. Use `String.padEnd()` instead.
- **Telegram MarkdownV2**: `markdown.ts` converts standard AI markdown to MarkdownV2. Key difference: `*bold*` not `**bold**`, `_italic_` not `*italic*`. 18 special chars must be escaped in plain text, fewer in code/URL contexts. If conversion fails, `telegram.ts` falls back to plain text. Streaming preview uses no parse_mode (partial MarkdownV2 would fail).
- **Telegram message limit**: 4096 characters max. `telegram.ts` has a `splitMessage()` function that breaks at paragraph then sentence boundaries. Splitting happens on original text before MarkdownV2 conversion (escaping inflates length).
- **Telegram streaming rate limit**: `telegram.ts` rate-limits `editMessageText` calls to one per 1.5 seconds during streaming. Edits are fire-and-forget (`.catch(() => {})`) so failures don't interrupt the stream.
- **Thinking tags**: Reasoning models (o3, MiniMax, etc.) may emit `<think>...</think>` blocks. `telegram.ts` strips these both during streaming preview and in the final response.
- **Web search tool is optional**: Only registered when `BRAVE_SEARCH_API_KEY` is set. When absent, the tool definition is not sent to any provider — no dead tools in the API call.
- **Memory cache**: System prompt is cached 5 minutes. After any conversation the cache is invalidated. Manually edited memory files via `chris memory edit` won't be picked up until the cache expires or the bot restarts.
- **GitHub fine-grained PAT expiry**: Max 1 year. Set a reminder to rotate.
- **Adding new tools**: Create `src/tools/<name>.ts` with a `registerTool()` call, then add `import "./<name>.js"` to `src/tools/index.ts`. All three providers pick it up automatically — no provider code changes needed.
- **Adding new providers**: Create `src/providers/<name>.ts` implementing the `Provider` interface, add a prefix check in `src/providers/index.ts`, and add model shortcuts to `src/cli/commands/model.ts`. For OpenAI-compatible providers, use `getOpenAiToolDefinitions()` and `dispatchToolCall()` from `src/tools/index.ts`.
- **MiniMax OAuth API**: The `/oauth/code` endpoint requires `response_type: "code"` in the body. The `expired_in` field is a unix timestamp in **milliseconds** (not a duration). Token poll responses use a `status` field (`"success"` / `"pending"` / `"error"`) — don't rely on HTTP status codes. Tokens are stored in `~/.chris-assistant/minimax-auth.json`.
- **OpenAI Codex OAuth**: Three-step device flow — request user code, poll for auth code (403/404 = pending), exchange auth code for tokens. Server provides PKCE code_verifier in the device auth response (unusual). Tokens auto-refresh via refresh_token grant. Tokens in `~/.chris-assistant/openai-auth.json`.
