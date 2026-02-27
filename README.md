# Chris Assistant

A personal AI assistant accessible through Telegram. Supports multiple AI providers (Claude, OpenAI, MiniMax) with persistent memory stored in GitHub.

## How It Works

```
Telegram message (text, photo, or document)
  → grammY bot (guards to your user ID only)
  → Rate limiter (10 msgs/min)
  → Loads identity + memory from GitHub private repo (5-min cache)
  → Loads project context (CLAUDE.md/AGENTS.md/README.md from active workspace)
  → Builds system prompt with personality, knowledge, conversation history
  → Routes to active provider (Claude, OpenAI, or MiniMax)
  → Streams response back to Telegram with live updates
  → AI can call tools: memory, web search, fetch URLs, run code,
    read/write/edit files, git operations, manage scheduled tasks
  → Response rendered as Telegram MarkdownV2 (with plain text fallback)

Scheduler (background):
  → Ticks every 60s, checks cron expressions
  → Fires matching tasks by sending prompt to active AI provider
  → AI gets full tool access (web search, code execution, files, etc.)
  → Response delivered to Telegram via raw fetch
```

The assistant has its own identity, personality, and evolving memory. Everything it learns about you is stored as markdown files in a separate private GitHub repo, giving you full visibility and version control over its brain.

## Features

- **Multi-provider AI** — Claude (Agent SDK), OpenAI, and MiniMax via a single bot. Switch models with `chris model set <name>`.
- **Streaming responses** — All three providers stream tokens in real-time. Telegram message updates every 1.5s with a typing cursor.
- **Image understanding** — Send a photo and the AI will describe/analyze it. Images route to `IMAGE_MODEL` (default `gpt-5.2`) regardless of active provider.
- **Document reading** — Send text files (.txt, .json, .csv, .md, etc.) and the AI reads the contents inline.
- **Web search** — AI can search the web via Brave Search API (optional, needs API key).
- **URL fetching** — AI can read any URL, with HTML stripping and 50KB truncation.
- **Code execution** — AI can run JavaScript, TypeScript, Python, or shell commands via `child_process.execFile` (10s timeout, 50KB output limit). Not sandboxed — runs with bot's user privileges.
- **File tools** — AI can read, write, edit, list, and search files in the active workspace. All paths scoped to `WORKSPACE_ROOT` (default `~/Projects`) with symlink-aware traversal guard.
- **Git tools** — AI can check `git status`, view diffs, and commit changes in the active workspace. No `git push` — deliberate safety choice.
- **SSH & remote access** — AI can SSH into Tailnet devices, run commands in persistent tmux sessions (attachable from iPhone), transfer files via SCP, and discover online devices. See the [SSH Tool Guide](docs/ssh-tool.md) for full details.
- **Scheduled tasks** — Tell the bot "check X every morning" and it creates a cron-scheduled task. Tasks fire by sending the prompt to the AI with per-task tool allowlists, and the response is delivered via Telegram. Managed via `manage_schedule` tool or by editing `~/.chris-assistant/schedules.json`.
- **Conversation archive & recall** — Every message archived as JSONL. AI-generated daily summaries at 23:55. Last 7 days of summaries loaded into system prompt. `recall_conversations` tool for searching past conversations.
- **Daily journal** — The bot writes structured notes throughout the day via `journal_entry` tool. Today's and yesterday's journals included in system prompt.
- **Weekly memory consolidation** — Curated `SUMMARY.md` generated weekly from all knowledge, summaries, and journal entries.
- **Heartbeat file** — Bot writes `HEARTBEAT.md` to memory repo every 3 hours with status snapshot (uptime, model, health, schedules, message count).
- **Project context** — When a workspace has a `CLAUDE.md`, `AGENTS.md`, or `README.md`, it's loaded into the system prompt so the AI understands the project.
- **Persistent memory** — Long-term facts stored as markdown in a GitHub repo. Every update is a git commit.
- **Persistent conversation history** — Last 20 messages per chat saved to disk. Survives restarts. `/clear` wipes it.
- **MarkdownV2 rendering** — AI responses are formatted for Telegram with bold, italic, code blocks, and links.
- **Rate limiting** — Sliding window limiter (10 messages/minute per user).
- **Health monitoring** — Startup notification, periodic checks (GitHub access, token expiry), alerts with dedup.
- **Context compaction** — When the conversation approaches the model's context window limit, older tool turns are summarized into a structured checkpoint and the loop continues. No hard turn ceiling — the bot can handle arbitrarily long SSH investigations and multi-file coding tasks.
- **Prompt injection defense** — Memory writes are validated for size, rate, and suspicious content.

## Architecture

```
chris-assistant/              ← This repo (bot server + CLI)
├── bin/chris                 # Shell wrapper for global CLI command
├── src/
│   ├── index.ts              # Bot entry point
│   ├── config.ts             # Environment config
│   ├── telegram.ts           # Telegram bot — text/photo/document handlers, streaming
│   ├── markdown.ts           # Standard markdown → Telegram MarkdownV2 converter
│   ├── rate-limit.ts         # Sliding window rate limiter
│   ├── health.ts             # Periodic health checks + Telegram alerts
│   ├── scheduler.ts          # Cron-like scheduled tasks — tick loop, AI execution, Telegram delivery
│   ├── conversation.ts       # Persistent conversation history (~/.chris-assistant/)
│   ├── conversation-archive.ts # Daily JSONL archiver — every message to ~/.chris-assistant/archive/
│   ├── conversation-backup.ts # Periodic backup of conversations to GitHub (every 6 hours)
│   ├── conversation-summary.ts # Daily AI summarizer — generates summaries at 23:55
│   ├── memory-consolidation.ts # Weekly memory consolidation — curates SUMMARY.md
│   ├── heartbeat.ts          # Periodic HEARTBEAT.md writer — status snapshot every 3h
│   ├── claude-sessions.ts    # Claude Agent SDK session persistence (per-chat)
│   ├── providers/
│   │   ├── types.ts          # Provider interface + ImageAttachment type
│   │   ├── shared.ts         # System prompt caching + model info injection
│   │   ├── claude.ts         # Claude Agent SDK provider
│   │   ├── openai.ts         # OpenAI provider (streaming, images, tools, compaction)
│   │   ├── openai-oauth.ts   # OpenAI Codex OAuth device flow + token storage
│   │   ├── minimax.ts        # MiniMax provider (OpenAI-compatible API, compaction)
│   │   ├── minimax-oauth.ts  # MiniMax OAuth device flow + token storage
│   │   ├── compaction.ts     # Context compaction — summarizes old turns to stay in window
│   │   ├── context-limits.ts # Model context window sizes and compaction thresholds
│   │   └── index.ts          # Provider router — model string determines provider
│   ├── tools/
│   │   ├── registry.ts       # Tool registry — registerTool(), dispatch, MCP/OpenAI format
│   │   ├── index.ts          # Imports all tool modules, re-exports registry
│   │   ├── memory.ts         # update_memory tool
│   │   ├── web-search.ts     # Brave Search API (conditional on API key)
│   │   ├── fetch-url.ts      # URL fetcher — HTML stripping, 15s timeout
│   │   ├── run-code.ts       # Code execution — JS/TS/Python/shell, 10s timeout
│   │   ├── files.ts          # File tools — read, write, edit, list, search (workspace-scoped)
│   │   ├── git.ts            # Git tools — status, diff, commit (workspace-scoped)
│   │   ├── scheduler.ts      # manage_schedule tool — create, list, delete, toggle
│   │   ├── ssh.ts            # SSH tool — exec, tmux, SCP, Tailnet device discovery
│   │   ├── recall.ts         # Conversation recall — list, read, search, summarize
│   │   ├── journal.ts        # journal_entry tool — bot writes daily notes
│   │   └── market-snapshot.ts # market_snapshot tool — market data via SSH
│   ├── memory/
│   │   ├── github.ts         # Read/write memory files via GitHub API
│   │   ├── journal.ts        # Daily memory journal — local storage + GitHub upload
│   │   ├── loader.ts         # Assembles system prompt from memory
│   │   └── tools.ts          # Memory tool executor + prompt injection validation
│   └── cli/
│       ├── index.ts           # Commander.js program entry point
│       ├── pm2-helper.ts      # pm2 connection helper and constants
│       └── commands/          # One file per CLI command
│           ├── start.ts       # chris start
│           ├── stop.ts        # chris stop
│           ├── restart.ts     # chris restart
│           ├── status.ts      # chris status
│           ├── logs.ts        # chris logs
│           ├── memory.ts      # chris memory status|show|edit|search
│           ├── identity.ts    # chris identity [edit]
│           ├── config.ts      # chris config [get|set]
│           ├── model.ts       # chris model [set|search]
│           ├── doctor.ts      # chris doctor [--fix]
│           ├── setup.ts       # chris setup
│           ├── openai-login.ts  # chris openai login|status
│           └── minimax-login.ts # chris minimax login|status

chris-assistant-memory/       ← Separate private repo (the brain)
├── HEARTBEAT.md              # Bot status snapshot (updated every 3h)
├── identity/
│   ├── SOUL.md               # Personality, purpose, communication style
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
│   └── SUMMARY.md            # Weekly-consolidated curated summary
├── archive/YYYY-MM-DD.jsonl  # Daily JSONL message logs
├── journal/YYYY-MM-DD.md     # Bot's daily journal notes
└── conversations/summaries/YYYY-MM-DD.md  # AI-generated daily summaries
```

## Setup

### Prerequisites

- Node.js 22+
- A [ChatGPT Plus or Pro subscription](https://chat.openai.com) (for the default OpenAI provider)
- A Telegram account

### 1. Create your Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow the prompts
3. Save the bot token

### 2. Get your Telegram user ID

Message [@userinfobot](https://t.me/userinfobot) on Telegram — it will reply with your numeric user ID.

### 3. Create a GitHub fine-grained PAT

The bot needs a GitHub token to read and write memory files. Use a **fine-grained** token (not classic) so you can lock it down to just the memory repo.

1. Go to [GitHub Settings → Developer settings → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click **"Generate new token"**
3. Fill in the settings:

| Setting | Value |
|---------|-------|
| **Token name** | `chris-assistant` (or whatever you like) |
| **Expiration** | 90 days, or custom — you'll need to rotate it when it expires |
| **Resource owner** | Your GitHub account |

4. Under **Repository access**, select **"Only select repositories"**
   - Choose your memory repo from the dropdown
   - Do NOT give it access to any other repos

5. Under **Permissions → Repository permissions**, set:

| Permission | Access level |
|------------|-------------|
| **Contents** | **Read and write** |
| Everything else | No access (default) |

   You only need `Contents`. Don't enable `Administration`, `Actions`, `Workflows`, or anything else.

6. Click **"Generate token"**
7. **Copy the token immediately** — GitHub only shows it once. It starts with `github_pat_`

> **Security note**: This token can only read/write file contents in the memory repo. It cannot delete the repo, manage settings, access other repos, or do anything else. If it leaks, the blast radius is limited to your memory markdown files.

### 4. Install and set up the CLI

```bash
npm install
npm link          # Makes 'chris' available globally
chris setup       # Interactive wizard to create .env
```

### 5. Authenticate with OpenAI

The default provider is OpenAI, authenticated via browser-based OAuth (authorization code + PKCE). This uses your ChatGPT Plus/Pro subscription — no API key or prepaid credits needed.

```bash
chris openai login       # Opens browser for OAuth approval (callback on port 1455)
chris openai status      # Check token status
```

Tokens are stored in `~/.chris-assistant/openai-auth.json` and auto-refresh when they expire.

### 6. Verify and start

```bash
chris doctor      # Verify all connections are working
chris start       # Start the bot via pm2
chris status      # Confirm it's running
```

### 7. (Optional) Set up additional providers

**MiniMax** — uses your MiniMax Coding Plan subscription via OAuth. No API credits needed.

```bash
chris minimax login      # Opens browser for OAuth approval
chris minimax status     # Check token expiry
```

**Claude** — requires a Claude Max subscription. Add `CLAUDE_CODE_OAUTH_TOKEN` to your `.env` file (get it via `claude setup-token`), then switch with `chris model set sonnet`.

### 8. (Optional) Set up web search

Get a free Brave Search API key at [brave.com/search/api](https://brave.com/search/api), then:

```bash
chris config set BRAVE_SEARCH_API_KEY your_key_here
chris restart
```

When the key is set, the AI gains a `web_search` tool. When absent, the tool is simply not registered — no dead tools in API calls.

## Usage

Message your bot on Telegram. That's it. On first contact, the assistant will introduce itself and begin learning about you through natural conversation.

### What You Can Send

- **Text messages** — normal conversation
- **Photos** — the AI will describe or analyze them (OpenAI/MiniMax providers)
- **Text documents** — .txt, .json, .csv, .md, .py, etc. are read inline and discussed

### Telegram Commands

- `/start` — Initial greeting
- `/clear` — Reset conversation history and Claude session (long-term memory is preserved)
- `/stop` — Abort the current Claude query
- `/session` — Show active Claude session info
- `/model` — Show current AI model and provider
- `/memory` — Show memory file status with sizes
- `/project` — Show or set the active project/workspace directory
- `/reload` — Reload memory from GitHub (invalidates system prompt cache)
- `/restart` — Graceful bot restart (pm2 auto-restarts the process)
- `/help` — List all available commands

### How Memory Works

- **Short-term**: Last 20 messages per chat, persisted to `~/.chris-assistant/conversations.json`. Survives restarts. `/clear` wipes it.
- **Long-term**: The assistant uses its `update_memory` tool to persist important facts to GitHub.
- **Identity**: SOUL.md, RULES.md, VOICE.md define who the assistant is.
- **All memory changes are git commits** — fully auditable and rollback-able.

### AI Tools

The assistant has access to these tools (all providers pick them up automatically):

| Tool | Category | Description |
|------|----------|-------------|
| `update_memory` | Always | Persist facts to GitHub memory repo |
| `web_search` | Always | Search the web via Brave Search API (optional — needs API key) |
| `fetch_url` | Always | Read any URL with HTML stripping, 15s timeout, 50KB truncation |
| `run_code` | Always | Execute JS, TS, Python, or shell commands (10s timeout) |
| `manage_schedule` | Always | Create, list, delete, or toggle cron-scheduled tasks |
| `read_file` | Coding | Read a file from the active workspace |
| `write_file` | Coding | Write a file to the active workspace |
| `edit_file` | Coding | Exact-match find-and-replace edit within a file |
| `list_files` | Coding | List files with glob pattern matching (excludes node_modules/.git) |
| `search_files` | Coding | Search file contents with grep (optional glob filter) |
| `git_status` | Coding | Show git status of the active workspace |
| `git_diff` | Coding | Show git diff (staged or unstaged) |
| `git_commit` | Coding | Stage files and commit (no push — safety choice) |
| `ssh` | Always | SSH into Tailnet devices — 8 actions ([full guide](docs/ssh-tool.md)) |
| `recall_conversations` | Always | List, read, search, and summarize past conversations |
| `journal_entry` | Always | Bot writes structured daily notes (timestamped markdown) |
| `market_snapshot` | Always | Fetch market data via SSH to Mac Mini |

"Always" tools are available in every conversation. "Coding" tools are only sent when a project workspace is active (set via `/project` command or `WORKSPACE_ROOT` env var).

### SSH Tool Highlights

The `ssh` tool lets the AI manage remote devices on your Tailscale network. Commands run in **persistent tmux sessions** on the Mac Mini — you can ask the bot to start a long-running task, then attach to the session from your iPhone to watch or interact.

**8 actions in one tool:**

| Action | What it does |
|--------|-------------|
| `exec` | SSH into a host, run a command in a tmux session, poll until done |
| `send_keys` | Send keystrokes to a session (e.g. `C-c` to cancel, `q` to quit) |
| `read_pane` | Read current terminal output without sending input |
| `devices` | List all Tailnet devices with hostname, IP, OS, and online status |
| `sessions` | List active `chris-bot-*` tmux sessions |
| `kill_session` | Terminate a tmux session (only bot sessions, not user sessions) |
| `scp_push` | Copy a file from the workspace to a remote host |
| `scp_pull` | Copy a file from a remote host into the workspace |

**Key design choices:**
- All commands via `execFile()` — no shell injection possible
- `BatchMode=yes` — SSH never prompts for passwords (fails fast instead)
- Absolute binary paths — works under pm2 daemon (no PATH dependency)
- Local SCP paths validated through `resolveSafePath()` — can't escape workspace
- Session prefix `chris-bot-` enforced — can't kill user sessions
- Sessions attachable from any device: `ssh macmini && tmux attach -t chris-bot-*`

See the [full SSH Tool Guide](docs/ssh-tool.md) for detailed documentation, the exec flow, timeouts, and troubleshooting.

## CLI Reference

The `chris` command is available globally after running `npm link`.

### Process Management

```bash
chris start              # Start the bot via pm2 (or restart if already running)
chris stop               # Stop the bot
chris restart            # Restart the bot
chris status             # Show running state, PID, uptime, memory usage, restarts
chris logs               # Show last 50 lines of logs
chris logs -f            # Live tail logs in real-time
chris logs -n 100        # Show last 100 lines
```

### Model / Provider

```bash
chris model              # Show current model, provider, and available shortcuts
chris model set <name>   # Switch model (e.g. sonnet, gpt5, codex, or full model ID)
chris model search       # List all available models across all providers
chris model search <q>   # Filter models by name, provider, or description
```

Available shortcuts:

| Shortcut | Model ID | Provider |
|----------|----------|----------|
| `opus` | claude-opus-4-6 | Claude |
| `sonnet` | claude-sonnet-4-6 | Claude |
| `haiku` | claude-haiku-4-5-20251001 | Claude |
| `sonnet-4-5` | claude-sonnet-4-5-20250929 | Claude |
| `gpt5` | gpt-5.2 | OpenAI |
| `codex` | GPT-5.3-Codex | OpenAI |
| `gpt4o` | gpt-4o | OpenAI |
| `gpt41` | gpt-4.1 | OpenAI |
| `o3` | o3 | OpenAI |
| `o4-mini` | o4-mini | OpenAI |
| `minimax` | MiniMax-M2.5 | MiniMax |
| `minimax-fast` | MiniMax-M2.5-highspeed | MiniMax |

### Memory Management

```bash
chris memory status      # List all memory files with sizes
chris memory show <file> # Print a memory file contents
chris memory edit <file> # Open in $EDITOR, push changes to GitHub on save
chris memory search <q>  # Search across all memory files with highlighted matches
```

File aliases: `soul`, `rules`, `voice`, `about-chris`, `preferences`, `projects`, `people`, `decisions`, `learnings`

### Identity

```bash
chris identity           # Print the current SOUL.md (personality definition)
chris identity edit      # Open SOUL.md in $EDITOR and push changes
```

### Configuration

```bash
chris config             # Show all config values (secrets are redacted)
chris config get <key>   # Get a specific value
chris config set <k> <v> # Set a value in .env (run chris restart to apply)
```

### Provider Authentication

```bash
chris openai login       # Authenticate via browser OAuth (callback on port 1455)
chris openai status      # Check OAuth token status (auto-refreshes)

chris minimax login      # Authenticate via OAuth device flow
chris minimax status     # Check OAuth token status and expiry
```

### Diagnostics

```bash
chris doctor             # Run all health checks:
                         #   - .env file exists
                         #   - Required env vars are set
                         #   - GitHub token can access memory repo
                         #   - Memory repo has identity files
                         #   - Telegram bot token is valid
                         #   - OpenAI OAuth tokens (optional)
                         #   - MiniMax OAuth tokens (optional)
                         #   - Brave Search API key (optional)
                         #   - Bot process is running (shows last error + restart count if errored)

chris doctor --fix       # Auto-diagnose and repair:
                         #   - Runs typecheck to catch syntax errors
                         #   - Detects missing modules, runs npm install
                         #   - Restarts the bot and verifies it comes back online

chris setup              # Interactive first-time setup wizard (creates .env)
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | Yes | Your numeric Telegram user ID |
| `GITHUB_TOKEN` | Yes | Fine-grained PAT with Contents read/write on memory repo |
| `GITHUB_MEMORY_REPO` | Yes | `owner/repo` format — your private memory repo |
| `AI_MODEL` | No | Model ID — determines provider. Default: `gpt-4o` |
| `IMAGE_MODEL` | No | Model for image processing. Default: `gpt-5.2`. All images route here. |
| `BRAVE_SEARCH_API_KEY` | No | Brave Search API key for web search tool |
| `WORKSPACE_ROOT` | No | Root directory for file/git tools. Default: `~/Projects`. Changeable at runtime via `/project`. |
| `MAX_TOOL_TURNS` | No | Safety ceiling for tool call rounds per message. Default: `200`. Context compaction handles the real limit. |
| `CLAUDE_CODE_OAUTH_TOKEN` | No | Only needed to use Claude models |

OpenAI and MiniMax authenticate via OAuth device flows (`chris openai login` / `chris minimax login`) with tokens stored in `~/.chris-assistant/`.

## Running on Mac Mini

The bot is designed to run on an always-on Mac Mini using pm2 for process management.

```bash
# Start the bot
chris start

# Enable auto-start on reboot
pm2 startup              # Follow the instructions it prints
pm2 save                 # Save current process list

# Check on it
chris status             # Quick status check
chris logs -f            # Watch logs in real-time
```

## Development

```bash
npm run dev              # Run bot with tsx watch (auto-reload on changes)
npm run typecheck        # TypeScript type checking + esbuild compat check
npm test                 # Run vitest test suite
npx tsx src/cli/index.ts # Run CLI directly without global install
```

## Tech Stack

- **Runtime**: Node.js 22+ / TypeScript
- **AI (Claude)**: Claude Agent SDK with Max subscription OAuth
- **AI (OpenAI)**: Raw fetch to Codex Responses API with ChatGPT OAuth (Plus/Pro subscription)
- **AI (MiniMax)**: OpenAI SDK with custom baseURL (`api.minimax.io`)
- **Telegram**: grammY
- **Memory**: GitHub API via Octokit
- **Tools**: zod (schema validation), native fetch, child_process
- **CLI**: Commander.js
- **Process management**: pm2
- **Dev**: tsx (TypeScript execution without build step)
