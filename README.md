# Chris Assistant

A personal AI assistant powered by Claude, accessible through Telegram. Built with the Claude Agent SDK using a Max subscription — no per-message API costs.

## How It Works

```
Telegram message
  → grammY bot (guards to your user ID only)
  → Loads identity + memory from GitHub private repo
  → Builds system prompt with personality, knowledge, conversation history
  → Claude Agent SDK query() via Max subscription OAuth token
  → Claude can call update_memory tool to persist what it learns
  → Response sent back to Telegram
```

The assistant has its own identity, personality, and evolving memory. Everything it learns about you is stored as markdown files in a separate private GitHub repo (`chris-assistant-memory`), giving you full visibility and version control over its brain.

## Architecture

```
chris-assistant/          ← This repo (the bot server)
├── src/
│   ├── index.ts          # Entry point
│   ├── config.ts         # Environment config
│   ├── telegram.ts       # Telegram bot with user guard
│   ├── claude.ts         # Claude Agent SDK integration
│   ├── conversation.ts   # Short-term in-memory chat history
│   └── memory/
│       ├── github.ts     # Read/write memory files via GitHub API
│       ├── loader.ts     # Assembles system prompt from memory
│       └── tools.ts      # MCP tool: lets Claude update its own memory

chris-assistant-memory/   ← Separate private repo (the brain)
├── identity/
│   ├── SOUL.md           # Personality, purpose, communication style
│   ├── RULES.md          # Hard boundaries
│   └── VOICE.md          # Tone and language
├── knowledge/
│   ├── about-chris.md    # Facts about you
│   ├── preferences.md    # Likes, dislikes, style
│   ├── projects.md       # Current work
│   └── people.md         # People you mention
└── memory/
    ├── decisions.md      # Important decisions
    └── learnings.md      # Self-improvement notes
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

### 5. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 6. Install and run

```bash
npm install
npm run dev
```

## Usage

Message your bot on Telegram. That's it.

### Commands

- `/start` — Initial greeting
- `/clear` — Reset conversation history (memory is preserved)

### How memory works

- **Short-term**: Last 20 messages kept in-memory (resets on restart)
- **Long-term**: The assistant uses its `update_memory` tool to persist important facts to GitHub
- **Identity**: SOUL.md, RULES.md, VOICE.md define who the assistant is
- **All memory changes are git commits** — fully auditable, rollback-able

## Running on Mac Mini (recommended)

Since this runs on an always-on Mac Mini:

```bash
# Run in background with pm2
npm install -g pm2
pm2 start npm --name chris-assistant -- start
pm2 save
pm2 startup  # Auto-start on reboot
```

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **AI**: Claude Agent SDK with Max subscription OAuth
- **Telegram**: grammY
- **Memory**: GitHub API via Octokit
- **Memory tools**: MCP (Model Context Protocol) in-process server
