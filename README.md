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
| **Web** | Searches and scrapes the web with Firecrawl, fetches URLs directly, and browses dynamic pages. |
| **Code** | Runs JavaScript, TypeScript, Python, and shell commands. Reads, writes, and edits files. Full git integration. |
| **Calendar & Mail** | Native macOS Calendar (EventKit) and Mail integration. "Move my dentist appointment to Friday at 3pm" just works. |
| **SSH** | Connects to Tailscale devices, runs commands in persistent tmux sessions you can attach to from your phone. |
| **Reminders** | Native Apple Reminders integration (EventKit). Create, complete, update, and search tasks. |
| **Scheduling** | "Check Hacker News every morning" — creates cron tasks that run with full AI + tool access. |
| **Skills** | Reusable workflows the AI can discover, execute, and create at runtime. Stored as JSON in the memory repo. |
| **Usage Tracking** | Token usage and cost tracking per model/provider. On-demand reports and daily cost summaries. |
| **Health Monitoring** | Heartbeat checks, service health status, and GitHub webhook server for PR monitoring. |
| **Memory Consolidation** | DreamTask — automatic background consolidation after conversations. Merges new facts, prunes stale data, and keeps memory files lean. |
| **Energy** | Octopus Energy API integration — consumption history, tariffs, balance, and billing. |
| **GUI Automation** | Peekaboo tool for screenshot capture and GUI automation on your Mac Mini via SSH. |

## How It Works

```
You send a message on Telegram
  → Auth guard (your user ID only)
  → Rate limiter (10 msgs/min)
  → Loads identity + memory from GitHub
  → Routes to AI provider (OpenAI Responses / Codex Agent / Grok Agent / DeepSeek)
  → Streams response back with live typing updates
  → AI calls tools as needed (web search, code, files, calendar...)
  → Conversation archived, memory updated
```

The assistant has its own identity (personality, voice, rules) and an evolving memory — all stored as markdown in a separate private GitHub repo. You can browse, edit, and roll back anything it knows.

For the runtime-accurate guide to what the assistant remembers, how recall works, and when to use each provider mode, see the [Operating Manual](docs/operating-manual.md).

### Multi-Provider AI

Switch between providers with a single command. The model string determines the backend:

| Provider | Best for | Assistant memory/tools | Auth |
|----------|----------|------------------------|------|
| **OpenAI Responses** | Everyday assistant, images, memory, and schedules | Full shared Chris tool set | `chris openai login` (ChatGPT OAuth) |
| **OpenAI Codex Agent** | Coding and workspace work | Agent-native workspace tools; selected memory context is injected | `codex login` |
| **Grok Agent** | Alternative agentic workspace work | Agent-native workspace tools; Chris-specific tools are limited initially | Grok CLI OAuth |
| **DeepSeek** | Economical text chat and reasoning | Full shared Chris text-tool set; images use the configured OpenAI image model | `DEEPSEEK_API_KEY` |

OpenAI Responses and Codex Agent are separate backends and use separate OAuth stores. DeepSeek is the only target provider that requires an API key. Grok uses its CLI's OAuth session; do not place browser session cookies or copied OAuth tokens in `.env`.

```bash
chris model set terra --effort medium       # OpenAI Responses
chris model set codex-agent --effort high   # OpenAI Codex Agent
chris model set grok --effort high          # Grok Agent
chris model set deepseek-flash --effort high # DeepSeek
```

### Memory Architecture

```
chris-assistant-memory/       ← Private GitHub repo
├── SOUL.md                   # Personality and purpose
├── IDENTITY.md               # Runtime identity and boundaries
├── USER.md                   # Facts, preferences, projects, people, decisions
├── memory/
│   ├── SUMMARY.md            # Weekly consolidated summary
│   ├── DASHBOARD.md          # Operator-facing status and notes
│   ├── learnings.md          # Self-improvement notes
├── journal/                  # Daily journal entries
├── skills/                   # Reusable skill definitions
├── archive/                  # Full conversation logs (JSONL)
└── conversations/summaries/  # AI-generated daily summaries
```

Every memory update is a git commit. DreamTask consolidation runs automatically after conversations — it merges new facts, prunes stale data, and updates `SUMMARY.md`.

## Web Dashboard

Built-in dark-mode web UI at `localhost:3000` — no extra dependencies, starts automatically with the bot.

**Tabs:** Status & Health, Schedules, Conversations, Memory viewer/editor, real-time log streaming (SSE).

Accessible over Tailnet with token auth.

## Getting Started

### Prerequisites

- Node.js 22+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A GitHub fine-grained PAT (Contents read/write on your memory repo)
- At least one configured provider: ChatGPT Plus/Pro, Grok CLI OAuth, or a DeepSeek API key

### Install

```bash
git clone https://github.com/theglove44/chris-assistant.git
cd chris-assistant
npm install
npm link              # Makes 'chris' available globally
chris setup           # Interactive wizard — creates .env
```

### Authenticate with an AI Provider

```bash
# OpenAI Responses — browser OAuth, uses your ChatGPT subscription
chris openai login

# Codex Agent — separate Codex CLI OAuth session
codex login

# Grok Agent — launch the installed CLI and complete its OAuth prompt if needed
grok

# DeepSeek — add DEEPSEEK_API_KEY to .env; never commit the key
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

Get an API key from [Firecrawl](https://www.firecrawl.dev/):

```bash
chris config set FIRECRAWL_API_KEY your_key
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
chris model set <name>           # Switch provider/model
chris model set <name> --effort <level> # Set a provider-valid thinking level
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

# Diagnostics
chris prompt inspect            # Redacted prompt section diagnostics
chris doctor                     # Health checks
chris doctor --fix               # Auto-diagnose and repair
chris setup                      # First-time setup wizard

# Memory consolidation
chris dream status               # Show DreamTask consolidation state
chris dream run                  # Force consolidation now (bypasses gates)
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
4. When Symphony reaches `symphony:human-review`, it lands the workspace changes onto a `codex/symphony/*` branch and opens a draft PR automatically.
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
| `AI_REASONING_EFFORT` | No | Requested thinking level; validated against the selected model |
| `DEEPSEEK_API_KEY` | No | DeepSeek API key. Required only for DeepSeek models; redact from output and never commit it |
| `DEEPSEEK_THINKING` | No | DeepSeek thinking mode: `enabled` (default) or `disabled` |
| `FIRECRAWL_API_KEY` | No | Enables Firecrawl web search and page scraping tools |
| `WORKSPACE_ROOT` | No | Root for file/git tools (default: `~/Projects`) |
| `IMAGE_MODEL` | No | Model for image generation (default: `gpt-5.2`) |
| `MAX_TOOL_TURNS` | No | Max tool call turns per conversation (default: 200) |
| `DISCORD_BOT_TOKEN` | No | Enables Discord bot |
| `DISCORD_ALLOWED_USER_ID` | No | Your Discord user ID |
| `DISCORD_GUILD_ID` | No | Discord server ID |
| `DASHBOARD_TOKEN` | No | Auth token for remote dashboard access |
| `WEBHOOK_PORT` | No | GitHub webhook server port (default: 3001) |
| `SYMPHONY_STATUS_URL` | No | Symphony status page URL (default: `http://127.0.0.1:3010`) |
| `NOTICE_LOOP_ENABLED` | No | Enable proactive notices (default: `false`) |
| `NOTICE_LOOP_INTERVAL_MINUTES` | No | Notice scan interval (default: `60`) |
| `NOTICE_QUIET_START_HOUR` | No | Local quiet-hours start, 0–23 (default: `22`) |
| `NOTICE_QUIET_END_HOUR` | No | Local quiet-hours end, 0–23 (default: `8`) |
| `NOTICE_JOURNAL_GAP_DAYS` | No | Days without journal activity before a nudge (default: `2`) |

Config is validated through a typed zod schema in `src/infra/config/` (`src/config.ts` is a compatibility facade). Run `chris setup` for guided configuration.

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
├── swift/                   # Swift source for EventKit binaries (Calendar, Reminders)
├── cli/                     # Commander.js CLI
└── symphony/                # Autonomous workflow/orchestration subsystem
```

### Runtime flow

```txt
Telegram / Discord message
  → channel handler
  → ChatService
  → provider routing (OpenAI Responses / Codex Agent / Grok Agent / DeepSeek)
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
- `src/providers/*` — OpenAI Responses, Codex Agent, Grok Agent, and DeepSeek adapters
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

Node.js 22+ / TypeScript / [grammY](https://grammy.dev) / [discord.js](https://discord.js.org) / [OpenAI Codex SDK](https://developers.openai.com/codex/sdk/) / [Octokit](https://github.com/octokit/rest.js) / [Commander.js](https://github.com/tj/commander.js) / pm2 / zod
