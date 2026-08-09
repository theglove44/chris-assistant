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
chris model              # Show current provider, model, and requested/effective effort
chris model set <name>   # Switch to a registered model or shortcut
chris model set <name> --effort <level> # Switch model and set a valid thinking level
chris model search       # List all available models across all providers
chris model search <q>   # Filter models by name, provider, or description
```

`chris model` prints capability metadata plus requested and effective reasoning effort. The central model registry also drives Telegram `/model` and the dashboard; `chris doctor` reports provider readiness separately.

### Available Shortcuts

| Shortcut | Model ID | Provider |
|----------|----------|----------|
| `terra` | gpt-5.6-terra | OpenAI Responses |
| `sol` | gpt-5.6-sol | OpenAI Responses |
| `luna` | gpt-5.6-luna | OpenAI Responses |
| `codex-agent` | codex-agent-gpt-5.6 | Codex Agent |
| `codex-sol` | codex-agent-gpt-5.6-sol | Codex Agent |
| `codex-terra` | codex-agent-gpt-5.6-terra | Codex Agent |
| `codex-luna` | codex-agent-gpt-5.6-luna | Codex Agent |
| `grok` | grok-agent-grok-4.5 | Grok Agent |
| `deepseek-flash` | deepseek-v4-flash | DeepSeek |
| `deepseek-pro` | deepseek-v4-pro | DeepSeek |
| `gpt54-mini` | gpt-5.4-mini | OpenAI |
| `gpt54-nano` | gpt-5.4-nano | OpenAI |
| `codex` | gpt-5.3-codex | OpenAI |
| `codex-spark` | gpt-5.3-codex-spark | OpenAI |
| `gpt52` | gpt-5.2 | OpenAI |
| `gpt4o` | gpt-4o | OpenAI |
| `gpt41` | gpt-4.1 | OpenAI |
| `o3` | o3 | OpenAI |
| `o4-mini` | o4-mini | OpenAI |

## Memory Management

```bash
chris memory status      # List all memory files with sizes
chris memory show <file> # Print a memory file contents
chris memory edit <file> # Open in $EDITOR, push changes to GitHub on save
chris memory search <q>  # Search across all memory files with highlighted matches
```

File aliases: `soul`, `identity`, `user`, `summary`, `dashboard`, `learnings`

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
chris openai login       # Authenticate via browser OAuth + PKCE (opens browser, callback on port 1455)
chris openai status      # Check OAuth token status (auto-refreshes)
codex login              # Authenticate the Codex CLI separately
# Authenticate Grok through its CLI OAuth flow
# Set DEEPSEEK_API_KEY in local .env for DeepSeek
```

## Diagnostics

```bash
chris prompt inspect     # Show redacted prompt sections, provider, workspace, and memory-section status

chris doctor             # Run all health checks:
                         #   - .env file exists
                         #   - Required env vars are set
                         #   - GitHub token can access memory repo
                         #   - Memory schema health
                         #   - Telegram bot token is valid
                         #   - OpenAI Responses OAuth (when selected)
                         #   - Codex and Grok CLI readiness (when selected)
                         #   - DeepSeek key presence without printing it (when selected)
                         #   - Firecrawl API key and remaining credits (optional)
                         #   - Bot process is running

chris doctor --fix       # Auto-diagnose and repair:
                         #   - Runs typecheck to catch syntax errors
                         #   - Detects missing modules, runs npm install
                         #   - Restarts the bot and verifies it comes back online

chris setup              # Interactive first-time setup wizard (creates .env)
```

## Memory Consolidation (DreamTask)

```bash
chris dream status       # Show consolidation status:
                         #   - Last consolidation timestamp
                         #   - Hours since last run
                         #   - Sessions since last run
                         #   - Consecutive failure count
                         #   - Whether a consolidation is currently running

chris dream run          # Force a consolidation now (bypasses all gates)
```

DreamTask runs automatically after conversations when three gates pass: 12+ hours since last run, 3+ new conversation sessions, and no other consolidation in progress.

## Symphony (Autonomous Workflow)

```bash
chris symphony run-once <workflow>   # Pick up one symphony:todo issue and work it
chris symphony status                # Show active workspaces and issue states
chris symphony logs <issue>          # Tail logs for a specific issue number
chris symphony cleanup               # List finished workspaces
chris symphony cleanup --apply       # Remove finished workspaces
chris symphony cleanup --delete-remote-branches --apply  # Also prune stale remote branches
```

## Codex

```bash
chris codex status       # Show Codex CLI binary/auth/app-server status
chris codex doctor       # Run Codex CLI readiness checks
```
