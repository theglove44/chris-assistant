# Chris Assistant — Project Guide

## What This Is

A personal AI assistant for Chris Taylor, accessible through Telegram. Supports multiple AI providers (Claude, OpenAI, MiniMax). Memory and identity are stored as markdown in a separate private GitHub repo (`theglove44/chris-assistant-memory`).

## Architecture

```
chris-assistant/              ← This repo (bot server + CLI)
├── bin/chris                 # Shell wrapper for global CLI command
├── src/
│   ├── index.ts              # Bot entry point (starts Telegram long-polling)
│   ├── config.ts             # Loads .env, exports typed config object
│   ├── telegram.ts           # grammY bot — message handler, user guard, typing indicator
│   ├── conversation.ts       # In-memory short-term history (last 20 messages, resets on restart)
│   ├── providers/
│   │   ├── types.ts          # Provider interface ({ name, chat() })
│   │   ├── shared.ts         # System prompt caching + model info injection
│   │   ├── claude.ts         # Claude Agent SDK provider
│   │   ├── minimax.ts        # MiniMax provider (OpenAI-compatible API)
│   │   ├── minimax-oauth.ts  # MiniMax OAuth device flow + token storage
│   │   ├── openai.ts         # OpenAI provider (GPT-4o, o3, etc.)
│   │   ├── openai-oauth.ts   # OpenAI Codex OAuth device flow + token storage
│   │   └── index.ts          # Provider router — model string determines provider
│   ├── memory/
│   │   ├── github.ts         # Octokit wrapper — read/write/append files in memory repo
│   │   ├── loader.ts         # Loads identity + knowledge + memory files, builds system prompt
│   │   └── tools.ts          # update_memory tool (MCP format + OpenAI function format)
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
- **Authentication**: Claude uses `CLAUDE_CODE_OAUTH_TOKEN` from a Max subscription. OpenAI uses Codex OAuth device flow (`chris openai login`) — tokens in `~/.chris-assistant/openai-auth.json` with auto-refresh. MiniMax uses OAuth device flow (`chris minimax login`) — tokens in `~/.chris-assistant/minimax-auth.json`.
- **Memory tool**: All providers support `update_memory`. Claude uses MCP (in-process server). OpenAI and MiniMax use OpenAI-format function calling. All delegate to the same `executeMemoryTool()` function.
- **Memory storage**: Markdown files in a private GitHub repo. Every update is a git commit — fully auditable and rollback-able.
- **System prompt caching**: Memory files are loaded from GitHub and cached for 5 minutes. Cache invalidates after any conversation (in case memory was updated). Shared across providers via `providers/shared.ts`.
- **User guard**: Only responds to `TELEGRAM_ALLOWED_USER_ID`. All other users are silently ignored.
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
| `CLAUDE_CODE_OAUTH_TOKEN` | Max subscription token from `claude setup-token` |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | Your numeric Telegram user ID |
| `GITHUB_TOKEN` | Fine-grained PAT with Contents read/write on memory repo only |
| `GITHUB_MEMORY_REPO` | `theglove44/chris-assistant-memory` |
| `CLAUDE_MODEL` | Model ID — determines provider. Defaults to `claude-sonnet-4-5-20250929` |
| ~~`MINIMAX_API_KEY`~~ | Removed — MiniMax now uses OAuth. Run `chris minimax login` instead |

Note: OpenAI and MiniMax do not use env vars for auth. They use OAuth device flows with tokens stored in `~/.chris-assistant/`.

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
- **Telegram message limit**: 4096 characters max. `telegram.ts` has a `splitMessage()` function that breaks at paragraph then sentence boundaries.
- **Memory cache**: System prompt is cached 5 minutes. After any conversation the cache is invalidated. Manually edited memory files via `chris memory edit` won't be picked up until the cache expires or the bot restarts.
- **GitHub fine-grained PAT expiry**: Max 1 year. Set a reminder to rotate.
- **Adding new providers**: Create `src/providers/<name>.ts` implementing the `Provider` interface, add a prefix check in `src/providers/index.ts`, and add model shortcuts to `src/cli/commands/model.ts`. If the provider supports tool calling, use `executeMemoryTool()` from `src/memory/tools.ts`.
- **MiniMax OAuth API**: The `/oauth/code` endpoint requires `response_type: "code"` in the body. The `expired_in` field is a unix timestamp in **milliseconds** (not a duration). Token poll responses use a `status` field (`"success"` / `"pending"` / `"error"`) — don't rely on HTTP status codes. Tokens are stored in `~/.chris-assistant/minimax-auth.json`.
- **OpenAI Codex OAuth**: Three-step device flow — request user code, poll for auth code (403/404 = pending), exchange auth code for tokens. Server provides PKCE code_verifier in the device auth response (unusual). Tokens auto-refresh via refresh_token grant. Tokens in `~/.chris-assistant/openai-auth.json`.
