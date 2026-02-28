---
title: Setup
description: Prerequisites and step-by-step installation guide
---

# Setup

## Prerequisites

- Node.js 22+
- A [ChatGPT Plus or Pro subscription](https://chat.openai.com) (for the default OpenAI provider)
- A Telegram account

## 1. Create your Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow the prompts
3. Save the bot token

## 2. Get your Telegram user ID

Message [@userinfobot](https://t.me/userinfobot) on Telegram — it will reply with your numeric user ID.

## 3. Create a GitHub fine-grained PAT

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

::: warning Security note
This token can only read/write file contents in the memory repo. It cannot delete the repo, manage settings, access other repos, or do anything else. If it leaks, the blast radius is limited to your memory markdown files.
:::

## 4. Install and set up the CLI

```bash
npm install
npm link          # Makes 'chris' available globally
chris setup       # Interactive wizard to create .env
```

## 5. Authenticate with OpenAI

The default provider is OpenAI, authenticated via Codex OAuth device flow. This uses your ChatGPT Plus/Pro subscription — no API key or prepaid credits needed.

```bash
chris openai login       # Opens browser for OAuth approval
chris openai status      # Check token status
```

Tokens are stored in `~/.chris-assistant/openai-auth.json` and auto-refresh when they expire.

## 6. Verify and start

```bash
chris doctor      # Verify all connections are working
chris start       # Start the bot via pm2
chris status      # Confirm it's running
```

## 7. (Optional) Set up additional providers

**MiniMax** — uses your MiniMax Coding Plan subscription via OAuth. No API credits needed.

```bash
chris minimax login      # Opens browser for OAuth approval
chris minimax status     # Check token expiry
```

**Claude** — requires a Claude Max subscription. Add `CLAUDE_CODE_OAUTH_TOKEN` to your `.env` file (get it via `claude setup-token`), then switch with `chris model set sonnet`.

## 8. (Optional) Set up web search

Get a free Brave Search API key at [brave.com/search/api](https://brave.com/search/api), then:

```bash
chris config set BRAVE_SEARCH_API_KEY your_key_here
chris restart
```

When the key is set, the AI gains a `web_search` tool. When absent, the tool is simply not registered — no dead tools in API calls.

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
