# Chris Assistant — Project Guide

## What This Is

A personal AI assistant for Chris Taylor, powered by Claude via the Agent SDK, accessible through Telegram. Memory and identity are stored as markdown in a separate private GitHub repo (`theglove44/chris-assistant-memory`).

## Architecture

```
chris-assistant/              ← This repo (bot server + CLI)
├── bin/chris                 # Shell wrapper for global CLI command
├── src/
│   ├── index.ts              # Bot entry point (starts Telegram long-polling)
│   ├── config.ts             # Loads .env, exports typed config object
│   ├── telegram.ts           # grammY bot — message handler, user guard, typing indicator
│   ├── claude.ts             # Agent SDK query() — builds prompt, calls Claude, streams result
│   ├── conversation.ts       # In-memory short-term history (last 20 messages, resets on restart)
│   ├── memory/
│   │   ├── github.ts         # Octokit wrapper — read/write/append files in memory repo
│   │   ├── loader.ts         # Loads identity + knowledge + memory files, builds system prompt
│   │   └── tools.ts          # MCP tool: update_memory (Claude updates its own brain)
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
│           ├── model.ts       # chris model [set] — view/change Claude model
│           ├── doctor.ts      # chris doctor — diagnostic checks
│           └── setup.ts       # chris setup — interactive first-time wizard

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

- **Authentication**: Uses `CLAUDE_CODE_OAUTH_TOKEN` from a Max subscription (via `claude setup-token`). No per-call API costs.
- **Memory storage**: Markdown files in a private GitHub repo. Every assistant memory update is a git commit — fully auditable and rollback-able.
- **Memory tool**: Claude has an MCP tool (`update_memory`) to persist what it learns. Categories: about-chris, preferences, projects, people, decisions, learnings.
- **System prompt caching**: Memory files are loaded from GitHub and cached for 5 minutes to avoid excessive API calls. Cache invalidates after any conversation (in case memory was updated).
- **User guard**: Only responds to `TELEGRAM_ALLOWED_USER_ID`. All other users are silently ignored.
- **pm2 process management**: The bot runs as a pm2 process. The CLI uses pm2's programmatic API. pm2 can't find `tsx` via PATH so we use the absolute path from `node_modules/.bin/tsx` as the interpreter.
- **CLI global install**: `npm link` creates a global `chris` command. The `bin/chris` shell wrapper follows symlinks to resolve the real project root and finds tsx from node_modules.

## Tech Stack

- **Runtime**: Node.js 22+ / TypeScript
- **AI**: `@anthropic-ai/claude-agent-sdk` with Max subscription OAuth token
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
| `CLAUDE_MODEL` | Optional override, defaults to `claude-sonnet-4-5-20250929` |

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
