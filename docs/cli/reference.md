---
title: Command Reference
description: Full CLI reference for the chris command
---

# CLI Command Reference

The `chris` command is available globally after running `npm link`.

## Process Management

```bash
chris start              # Start the bot via pm2 (or restart if already running)
chris stop               # Stop the bot
chris restart            # Restart the bot
chris status             # Show running state, PID, uptime, memory usage, restarts
chris logs               # Show last 50 lines of logs
chris logs -f            # Live tail logs in real-time
chris logs -n 100        # Show last 100 lines
```

## Model / Provider

```bash
chris model              # Show current model, provider, and available shortcuts
chris model set <name>   # Switch model (e.g. sonnet, gpt5, codex, or full model ID)
chris model search       # List all available models across all providers
chris model search <q>   # Filter models by name, provider, or description
```

### Available Shortcuts

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

## Memory Management

```bash
chris memory status      # List all memory files with sizes
chris memory show <file> # Print a memory file contents
chris memory edit <file> # Open in $EDITOR, push changes to GitHub on save
chris memory search <q>  # Search across all memory files with highlighted matches
```

File aliases: `soul`, `rules`, `voice`, `about-chris`, `preferences`, `projects`, `people`, `decisions`, `learnings`

## Identity

```bash
chris identity           # Print the current SOUL.md (personality definition)
chris identity edit      # Open SOUL.md in $EDITOR and push changes
```

## Configuration

```bash
chris config             # Show all config values (secrets are redacted)
chris config get <key>   # Get a specific value
chris config set <k> <v> # Set a value in .env (run chris restart to apply)
```

## Provider Authentication

```bash
chris openai login       # Authenticate via Codex OAuth device flow
chris openai status      # Check OAuth token status (auto-refreshes)

chris minimax login      # Authenticate via OAuth device flow
chris minimax status     # Check OAuth token status and expiry
```

## Diagnostics

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
                         #   - Bot process is running

chris doctor --fix       # Auto-diagnose and repair:
                         #   - Runs typecheck to catch syntax errors
                         #   - Detects missing modules, runs npm install
                         #   - Restarts the bot and verifies it comes back online

chris setup              # Interactive first-time setup wizard (creates .env)
```
