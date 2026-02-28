---
title: Environment & Config
description: Environment variables, file paths, and configuration
---

# Environment & Config

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | Yes | Your numeric Telegram user ID |
| `GITHUB_TOKEN` | Yes | Fine-grained PAT with Contents read/write on memory repo |
| `GITHUB_MEMORY_REPO` | Yes | `owner/repo` format — your private memory repo |
| `AI_MODEL` | No | Model ID — determines provider. Default: `gpt-4o` |
| `BRAVE_SEARCH_API_KEY` | No | Brave Search API key for web search tool |
| `WORKSPACE_ROOT` | No | Root directory for file/git tools. Default: `~/Projects`. Changeable at runtime via `/project`. |
| `MAX_TOOL_TURNS` | No | Safety ceiling for tool call rounds per message. Default: `200`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | No | Only needed to use Claude models |

OpenAI and MiniMax authenticate via OAuth device flows (`chris openai login` / `chris minimax login`) with tokens stored in `~/.chris-assistant/`.

## File Paths

| Path | Purpose |
|------|---------|
| `.env` | Environment variables (project root) |
| `~/.chris-assistant/conversations.json` | Persistent conversation history (last 20 messages) |
| `~/.chris-assistant/schedules.json` | Scheduled task definitions |
| `~/.chris-assistant/openai-auth.json` | OpenAI OAuth tokens + account ID |
| `~/.chris-assistant/minimax-auth.json` | MiniMax OAuth tokens |
| `~/.chris-assistant/archive/` | Daily JSONL message archives |
| `~/.chris-assistant/journal/` | Daily bot journal entries |

## Configuration Management

```bash
chris config             # Show all config values (secrets are redacted)
chris config get <key>   # Get a specific value
chris config set <k> <v> # Set a value in .env
```

After changing config values, run `chris restart` to apply.

## System Prompt Cache

Memory files loaded from GitHub are cached for 5 minutes. The cache invalidates after any conversation (in case memory was updated). You can manually invalidate with `/reload` in Telegram.

Manually edited memory files via `chris memory edit` won't be picked up until the cache expires or the bot restarts.
