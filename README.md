# Chris Assistant

A personal AI assistant accessible through Telegram. Supports multiple AI providers (Claude, MiniMax) with persistent memory stored in GitHub.

## How It Works

```
Telegram message
  → grammY bot (guards to your user ID only)
  → Loads identity + memory from GitHub private repo
  → Builds system prompt with personality, knowledge, conversation history
  → Routes to active provider (Claude Agent SDK or MiniMax via OpenAI API)
  → AI can call update_memory tool to persist what it learns
  → Response sent back to Telegram
```

The assistant has its own identity, personality, and evolving memory. Everything it learns about you is stored as markdown files in a separate private GitHub repo (`chris-assistant-memory`), giving you full visibility and version control over its brain.

## Architecture

```
chris-assistant/              ← This repo (bot server + CLI)
├── bin/chris                 # Shell wrapper for global CLI command
├── src/
│   ├── index.ts              # Bot entry point
│   ├── config.ts             # Environment config
│   ├── telegram.ts           # Telegram bot with user guard
│   ├── conversation.ts       # Short-term in-memory chat history
│   ├── providers/
│   │   ├── types.ts          # Provider interface
│   │   ├── shared.ts         # System prompt caching
│   │   ├── claude.ts         # Claude Agent SDK provider
│   │   ├── minimax.ts        # MiniMax provider (OpenAI-compatible)
│   │   ├── minimax-oauth.ts  # MiniMax OAuth device flow + token storage
│   │   └── index.ts          # Provider router
│   ├── memory/
│   │   ├── github.ts         # Read/write memory files via GitHub API
│   │   ├── loader.ts         # Assembles system prompt from memory
│   │   └── tools.ts          # update_memory tool (MCP + OpenAI function formats)
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
│           ├── model.ts       # chris model [set]
│           ├── doctor.ts      # chris doctor
│           ├── setup.ts       # chris setup
│           └── minimax-login.ts # chris minimax login|status

chris-assistant-memory/       ← Separate private repo (the brain)
├── identity/
│   ├── SOUL.md               # Personality, purpose, communication style
│   ├── RULES.md              # Hard boundaries
│   └── VOICE.md              # Tone and language
├── knowledge/
│   ├── about-chris.md        # Facts about you
│   ├── preferences.md        # Likes, dislikes, style
│   ├── projects.md           # Current work
│   └── people.md             # People you mention
└── memory/
    ├── decisions.md           # Important decisions
    └── learnings.md           # Self-improvement notes
```

## Setup

### Prerequisites

- Node.js 22+
- A [Claude Max subscription](https://claude.ai) with Claude Code access
- A Telegram account

### 1. Create your Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow the prompts
3. Save the bot token

### 2. Get your Telegram user ID

Message [@userinfobot](https://t.me/userinfobot) on Telegram — it will reply with your numeric user ID.

### 3. Get your Claude OAuth token

```bash
claude setup-token
```

This generates a long-lived (1 year) token using your Max subscription.

### 4. Create a GitHub fine-grained PAT

The bot needs a GitHub token to read and write memory files. Use a **fine-grained** token (not classic) so you can lock it down to just the memory repo.

1. Go to [GitHub Settings → Developer settings → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click **"Generate new token"**
3. Fill in the settings:

| Setting | Value |
|---------|-------|
| **Token name** | `chris-assistant` (or whatever you like) |
| **Expiration** | 90 days, or custom — you'll need to rotate it when it expires |
| **Description** | Optional — e.g. "Memory read/write for personal assistant" |
| **Resource owner** | Your account (`theglove44`) |

4. Under **Repository access**, select **"Only select repositories"**
   - Choose **`chris-assistant-memory`** from the dropdown
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

### 5. (Optional) Set up MiniMax

If you want to use MiniMax models (e.g. `MiniMax-M2.5`), authenticate via OAuth device flow. This uses your MiniMax Coding Plan subscription — no API credits needed.

```bash
chris minimax login      # Opens browser for OAuth approval
chris minimax status     # Check token expiry
```

Tokens are stored in `~/.chris-assistant/minimax-auth.json` and expire after a few hours. Re-run `chris minimax login` when they expire.

### 6. Install and set up the CLI

```bash
npm install
npm link          # Makes 'chris' available globally
chris setup       # Interactive wizard to create .env
chris doctor      # Verify all connections are working
```

### 7. Start the bot

```bash
chris start       # Start the bot via pm2
chris status      # Confirm it's running
```

## Usage

Message your bot on Telegram. That's it. On first contact, the assistant will introduce itself and begin learning about you through natural conversation.

### Telegram Commands

- `/start` — Initial greeting
- `/clear` — Reset conversation history (long-term memory is preserved)

### How Memory Works

- **Short-term**: Last 20 messages kept in-memory (resets on restart)
- **Long-term**: The assistant uses its `update_memory` tool to persist important facts to GitHub
- **Identity**: SOUL.md, RULES.md, VOICE.md define who the assistant is
- **All memory changes are git commits** — fully auditable and rollback-able

## CLI Reference

The `chris` command is available globally after running `npm link`. It manages the bot process, memory, identity, and configuration.

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

### Memory Management

```bash
chris memory status      # List all memory files with sizes
chris memory show <file> # Print a memory file contents
chris memory edit <file> # Open in $EDITOR, push changes to GitHub on save
chris memory search <q>  # Search across all memory files with highlighted matches
```

File aliases for `<file>`: `soul`, `rules`, `voice`, `about-chris`, `preferences`, `projects`, `people`, `decisions`, `learnings`

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

### Model / Provider

```bash
chris model              # Show current model, provider, and available shortcuts
chris model set <name>   # Switch model (e.g. sonnet, minimax, opus, or full model ID)
```

Available shortcuts: `opus`, `sonnet`, `haiku`, `sonnet-4-5` (Claude), `minimax`, `minimax-fast` (MiniMax)

### MiniMax Provider

```bash
chris minimax login     # Authenticate via OAuth device flow
chris minimax status    # Check OAuth token status and expiry
```

### Diagnostics

```bash
chris doctor             # Run all health checks:
                         #   - .env file exists
                         #   - All required env vars are set
                         #   - GitHub token can access memory repo
                         #   - Memory repo has identity files
                         #   - Telegram bot token is valid
                         #   - Bot process is running

chris setup              # Interactive first-time setup wizard (creates .env)
```

## Running on Mac Mini (Recommended)

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

## Tech Stack

- **Runtime**: Node.js 22+ / TypeScript
- **AI (Claude)**: Claude Agent SDK with Max subscription OAuth
- **AI (MiniMax)**: OpenAI SDK with custom baseURL (`api.minimax.io`)
- **Telegram**: grammY
- **Memory**: GitHub API via Octokit
- **CLI**: Commander.js
- **Process management**: pm2
- **Dev**: tsx (TypeScript execution without build step)
