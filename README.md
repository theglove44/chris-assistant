# Chris Assistant

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots)
[![Discord](https://img.shields.io/badge/Discord-Bot-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)

A personal AI assistant that lives in your Telegram (and Discord). It remembers everything, manages your calendar, runs code, searches the web, SSHs into your machines, and gets smarter over time — all through natural conversation.

Built for a single user. Not a platform, not a framework — just a really good assistant that runs on your Mac.

## What It Does

**Talk to it like a person.** It streams responses in real-time, understands photos and documents, and has access to a growing set of tools:

| | |
|---|---|
| **Memory** | Learns about you over time. Facts stored as markdown in a private GitHub repo — fully auditable, version-controlled. |
| **Web** | Searches the web (Brave Search), fetches and reads URLs, browses pages. |
| **Code** | Runs JavaScript, TypeScript, Python, and shell commands. Reads, writes, and edits files. Full git integration. |
| **Calendar & Mail** | Native macOS Calendar (EventKit) and Mail integration. "Move my dentist appointment to Friday at 3pm" just works. |
| **SSH** | Connects to Tailscale devices, runs commands in persistent tmux sessions you can attach to from your phone. |
| **Scheduling** | "Check Hacker News every morning" — creates cron tasks that run with full AI + tool access. |
| **Skills** | Reusable workflows the AI can discover, execute, and create at runtime. Stored as JSON in the memory repo. |

## How It Works

```
You send a message on Telegram
  → Auth guard (your user ID only)
  → Rate limiter (10 msgs/min)
  → Loads identity + memory from GitHub
  → Routes to AI provider (Claude / OpenAI / MiniMax)
  → Streams response back with live typing updates
  → AI calls tools as needed (web search, code, files, calendar...)
  → Conversation archived, memory updated
```

The assistant has its own identity (personality, voice, rules) and an evolving memory — all stored as markdown in a separate private GitHub repo. You can browse, edit, and roll back anything it knows.

### Multi-Provider AI

Switch between providers with a single command. The model string determines the backend:

| Provider | Models | Auth |
|----------|--------|------|
| **Claude Agent** | Opus, Sonnet, Haiku | Claude CLI (`claude` — uses your Max subscription) |
| **OpenAI Responses** | GPT-5.x, GPT-4o, o3, o4-mini | ChatGPT Plus/Pro subscription (OAuth) |
| **OpenAI Codex Agent** | `codex-agent-*` models | Codex CLI (`codex login`) |
| **MiniMax** | M2.5, M2.5-highspeed | MiniMax subscription (OAuth) |

Claude uses the [Agent SDK](https://github.com/anthropics/claude-agent-sdk), which piggybacks on the Claude CLI's authentication — just run `claude` once to log in, and the bot picks it up automatically.

The Codex agent mode uses `@openai/codex-sdk`, which spawns the `codex` CLI under the hood for native coding tools and persistent threads.

```bash
chris model set sonnet         # Switch to Claude Sonnet
chris model set gpt5           # Switch to OpenAI GPT-5.2
chris model set codex-agent    # Switch to OpenAI Codex Agent
chris model set minimax        # Switch to MiniMax
```

### Memory Architecture

```
chris-assistant-memory/       ← Private GitHub repo
├── identity/
│   ├── SOUL.md               # Personality and purpose
│   ├── RULES.md              # Hard boundaries
│   └── VOICE.md              # Tone and language
├── knowledge/
│   ├── about-chris.md        # Facts about you
│   ├── preferences.md        # Likes, dislikes, style
│   ├── projects.md           # Current work
│   └── people.md             # People you mention
├── memory/
│   ├── decisions.md          # Important decisions
│   ├── learnings.md          # Self-improvement notes
│   └── SUMMARY.md            # Weekly consolidated summary
├── journal/                  # Daily journal entries
├── skills/                   # Reusable skill definitions
├── archive/                  # Full conversation logs (JSONL)
└── conversations/summaries/  # AI-generated daily summaries
```

Every memory update is a git commit. Weekly consolidation distills everything into a curated summary.

## Web Dashboard

Built-in dark-mode web UI at `localhost:3000` — no extra dependencies, starts automatically with the bot.

**Tabs:** Status & Health, Schedules, Conversations, Memory viewer/editor, real-time log streaming (SSE).

Accessible over Tailnet with token auth.

## Getting Started

### Prerequisites

- Node.js 22+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A GitHub fine-grained PAT (Contents read/write on your memory repo)
- At least one AI provider subscription (ChatGPT Plus/Pro, Claude Max, or MiniMax)

### Install

```bash
git clone https://github.com/christayloruk/chris-assistant.git
cd chris-assistant
npm install
npm link              # Makes 'chris' available globally
chris setup           # Interactive wizard — creates .env
```

### Authenticate with an AI Provider

```bash
# Claude — log in via the Claude CLI (Agent SDK reuses its auth)
claude

# OpenAI — browser OAuth, uses your ChatGPT subscription
chris openai login

# MiniMax — browser OAuth
chris minimax login
```

### Start

```bash
chris doctor          # Verify all connections
chris start           # Start via pm2
chris status          # Confirm it's running
```

Message your bot on Telegram. That's it.

### Optional Add-ons

<details>
<summary><strong>Discord bot</strong></summary>

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable **Message Content Intent**
3. Invite it with `bot` scope + Send Messages, Read Message History
4. Add to `.env`:
   ```
   DISCORD_BOT_TOKEN=your_token
   DISCORD_ALLOWED_USER_ID=your_discord_user_id
   ```
5. Restart — it connects automatically

</details>

<details>
<summary><strong>Web search</strong></summary>

Get a free API key at [brave.com/search/api](https://brave.com/search/api):

```bash
chris config set BRAVE_SEARCH_API_KEY your_key
chris restart
```

</details>

<details>
<summary><strong>macOS Calendar & Mail</strong></summary>

```bash
npm run setup:calendar-helper    # Compiles Swift binary, creates app bundle
```

First run triggers a macOS permission dialog. Calendar uses native EventKit for sub-second operations. Mail uses AppleScript.

</details>

## CLI Reference

```bash
# Process management
chris start / stop / restart / status
chris logs -f                    # Live tail logs

# Model switching
chris model                      # Show current model
chris model set <name>           # Switch (opus, sonnet, gpt5, codex, minimax, ...)
chris model search               # List all available models

# Memory
chris memory status              # List files with sizes
chris memory show <file>         # Print a file
chris memory edit <file>         # Open in $EDITOR, push to GitHub on save
chris memory search <query>      # Search across all memory files

# Identity
chris identity                   # Print SOUL.md
chris identity edit              # Edit personality in $EDITOR

# Config & auth
chris config                     # Show all config (secrets redacted)
chris config set <key> <value>   # Set a value
chris openai login / status      # OpenAI OAuth
chris minimax login / status     # MiniMax OAuth

# Diagnostics
chris doctor                     # Health checks
chris doctor --fix               # Auto-diagnose and repair
chris setup                      # First-time setup wizard
```

## GitHub-Backed Symphony

Symphony uses GitHub Issues by default. The workflow contract lives in [WORKFLOW.md](WORKFLOW.md), including the managed issue labels:

If you want the plain-English explanation and use cases first, read [docs/symphony-overview.md](docs/symphony-overview.md).

- `symphony:todo`
- `symphony:in-progress`
- `symphony:rework`
- `symphony:human-review`

Basic operator loop:

1. Label an issue with `symphony:todo`.
2. Run `chris symphony run-once WORKFLOW.md`.
3. Inspect progress with `chris symphony status` and `chris symphony logs <issue>`.
4. When Symphony reaches `symphony:human-review`, it lands the workspace changes onto a `codex/symphony/*` branch and opens a draft PR automatically. That draft PR targets the repo's main integration branch so CI runs immediately.
5. Reviewer assignment stays manual in v1; landing stops at a draft PR so a human can inspect before review handoff.

Maintenance:

- `chris symphony cleanup` shows finished workspaces that can be removed.
- `chris symphony cleanup --apply` removes them.
- `chris symphony cleanup --delete-remote-branches --apply` also prunes stale `codex/symphony/*` remote branches that no longer back an open PR.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/clear` | Reset conversation (long-term memory preserved) |
| `/model` | Show current model and provider |
| `/memory` | Show memory file status |
| `/project` | Show or set active workspace |
| `/reload` | Reload memory from GitHub |
| `/help` | List all commands |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | Yes | Your numeric Telegram user ID |
| `GITHUB_TOKEN` | Yes | Fine-grained PAT (Contents read/write on memory repo only) |
| `GITHUB_MEMORY_REPO` | Yes | `owner/repo` format |
| `AI_MODEL` | No | Model ID — determines provider (default: `gpt-4o`) |
| `BRAVE_SEARCH_API_KEY` | No | Enables web search tool |
| `WORKSPACE_ROOT` | No | Root for file/git tools (default: `~/Projects`) |
| `DISCORD_BOT_TOKEN` | No | Enables Discord bot |
| `DISCORD_ALLOWED_USER_ID` | No | Your Discord user ID |
| `DASHBOARD_TOKEN` | No | Auth token for remote dashboard access |

Full list in `src/config.ts`. Run `chris setup` for guided configuration.

## Architecture

The codebase is now organized into explicit layers:

```txt
src/
├── app/                     # Bootstrap, lifecycle, service registry
├── agent/                   # Chat orchestration + provider session handling
├── channels/                # Transport adapters (Telegram, Discord)
├── domain/                  # Core business domains
│   ├── conversations/       # History, archive, backup, summaries
│   ├── memory/              # Memory repo access, journals, consolidation, prompts
│   └── schedules/           # Cron matching, storage, execution
├── infra/                   # Shared infrastructure (config, storage)
├── providers/               # AI provider implementations
├── tools/                   # Tool registry platform + tool modules
├── dashboard/               # Dashboard runtime + UI template
├── skills/                  # Dynamic workflow system
├── cli/                     # Commander.js CLI
└── symphony/                # Autonomous workflow/orchestration subsystem
```

### Runtime flow

```txt
Telegram / Discord message
  → channel handler
  → ChatService
  → provider routing (Claude / OpenAI / Codex Agent / MiniMax)
  → tool execution via shared registry
  → conversation + archive persistence
  → memory/journal updates
```

### Key modules

- `src/app/` — app startup, shutdown, service registration
- `src/agent/chat-service.ts` — central provider routing, image routing, abort/session helpers
- `src/channels/telegram/*` — Telegram bot, commands, streaming handlers
- `src/channels/discord/*` — Discord client, message handling, outbound notifications
- `src/domain/conversations/*` — rolling history, archives, backups, daily/weekly summaries
- `src/domain/memory/*` — GitHub memory repository, prompt loading, journal service, consolidation
- `src/domain/schedules/*` — schedule CRUD, cron parsing, scheduled task execution
- `src/tools/*` — provider-agnostic tool registration, filtering, loop guard, adapters
- `src/providers/*` — Claude Agent SDK, OpenAI Responses, Codex Agent SDK, MiniMax
- `src/dashboard/*` — HTTP runtime/API layer and HTML UI

**Key design decisions:**
- Tool registration is provider-agnostic — define once in `src/tools/`, all providers discover it
- `ChatService` is the single orchestration layer used by channels and background jobs
- Domain services own persistence and runtime behavior; top-level files are mostly compatibility facades
- Config is validated through a typed `zod` loader in `src/infra/config/`
- No `git push` tool — deliberate safety choice
- Code execution is unsandboxed but has dangerous pattern blocking and timeout limits
- All file paths validated through `resolveSafePath()` — symlinks outside workspace rejected
- Memory writes validated for size, rate, and injection attempts

## Security

- **Single-user auth** — Telegram user ID guard, Discord user ID guard
- **Workspace scoping** — All file/git tools locked to `WORKSPACE_ROOT` with symlink-aware path validation
- **Dangerous command blocking** — `pm2`, `kill`, `reboot`, `shutdown`, `rm -rf /` blocked in code execution
- **Memory injection defense** — Size limits, rate throttling, content validation
- **No git push** — The AI can commit but never push
- **SSH safety** — `BatchMode=yes` (no password prompts), `execFile()` (no shell injection), bot session prefix enforcement

## Development

```bash
npm run dev              # Auto-reload dev server
npm run typecheck        # TypeScript + esbuild compat check
npm test                 # Vitest suite
```

## Tech Stack

Node.js 22+ / TypeScript / [grammY](https://grammy.dev) / [discord.js](https://discord.js.org) / [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) / [Octokit](https://github.com/octokit/rest.js) / [Commander.js](https://github.com/tj/commander.js) / pm2 / zod
