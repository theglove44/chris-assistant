---
title: Environment Variables
description: Configuration reference for Chris Assistant
---

# Environment Variables

Create `.env` with `chris setup`. Keep it local, restrict its filesystem permissions, and never commit it. `chris config` must redact secret values.

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | Yes | Numeric Telegram user ID; all other users are ignored |
| `GITHUB_TOKEN` | Yes | Fine-grained PAT with Contents read/write on the private memory repo only |
| `GITHUB_MEMORY_REPO` | Yes | Private memory repository in `owner/repo` form |
| `AI_MODEL` | No | Active registered model. Default: `gpt-4o` |
| `AI_REASONING_EFFORT` | No | Requested thinking level, validated per model |
| `DEEPSEEK_API_KEY` | No | Required only for DeepSeek models; always redacted |
| `DEEPSEEK_THINKING` | No | DeepSeek thinking mode: `enabled` (default) or `disabled` |
| `IMAGE_MODEL` | No | OpenAI model used for image processing |
| `FIRECRAWL_API_KEY` | No | Enables Firecrawl web search and page scraping |
| `WORKSPACE_ROOT` | No | Root for file and Git tools. Default: `~/Projects` |
| `MAX_TOOL_TURNS` | No | Safety ceiling for tool rounds per message |
| `DISCORD_BOT_TOKEN` | No | Enables Discord |
| `DISCORD_ALLOWED_USER_ID` | No | Discord user allowlist |
| `DISCORD_GUILD_ID` | No | Discord guild ID |
| `DASHBOARD_PORT` | No | Dashboard port. Default: `3000` |
| `DASHBOARD_TOKEN` | No | Dashboard bearer token; without it, access is localhost-only |
| `DOCS_URL` | No | Knowledge-base link shown in the dashboard |
| `GITHUB_WEBHOOK_SECRET` | No | HMAC secret for webhook verification |
| `WEBHOOK_PORT` | No | Webhook port. Default: `3001` |
| `VOYAGE_API_KEY` | No | Enables semantic memory recall; keyword fallback remains available |
| `OCTOPUS_API_KEY` | No | Octopus Energy API key |
| `OCTOPUS_ACCOUNT_NUMBER` | No | Octopus Energy account number |
| `SYMPHONY_STATUS_URL` | No | Symphony status endpoint |
| `NOTICE_LOOP_ENABLED` | No | Enables proactive notices |
| `NOTICE_LOOP_INTERVAL_MINUTES` | No | Notice scan interval |
| `NOTICE_QUIET_START_HOUR` | No | Quiet-hours start, 0-23 |
| `NOTICE_QUIET_END_HOUR` | No | Quiet-hours end, 0-23 |
| `NOTICE_JOURNAL_GAP_DAYS` | No | Journal inactivity threshold |

## Provider authentication

- OpenAI Responses: `chris openai login`; local OAuth metadata is stored at `~/.chris-assistant/openai-auth.json`.
- Codex Agent: `codex login`; the Codex CLI owns its OAuth files under `~/.codex/`.
- Grok Agent: authenticate through the Grok CLI; the CLI owns its OAuth state.
- DeepSeek: set `DEEPSEEK_API_KEY` in `.env`.

OAuth files and API keys are private runtime state. Do not copy, delete, relocate, print, or commit them as part of source maintenance.

## Runtime paths

| Path | Contents |
|------|----------|
| `~/.chris-assistant/openai-auth.json` | OpenAI Responses OAuth metadata |
| `~/.chris-assistant/codex-sessions.json` | Codex thread IDs per chat |
| `~/.chris-assistant/conversations.json` | Recent conversation history |
| `~/.chris-assistant/schedules.json` | Scheduled tasks |
| `~/.chris-assistant/archive/` | Daily JSONL archives |
| `~/.chris-assistant/feedback/` | Local feedback data |
| `~/.chris-assistant/usage/` | Provider/model usage snapshots |

The source repository and `~/.chris-assistant/` have different lifecycles. Never delete or modify live runtime data during a source cleanup.
