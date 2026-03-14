---
title: Scheduler
description: Cron-like scheduled tasks with AI execution
---

# Scheduler

## How It Works

`src/scheduler.ts` loads tasks from `~/.chris-assistant/schedules.json`, ticks every 60 seconds, and fires matching tasks by sending the prompt to `chat()` with full tool access. Results are sent to Telegram via raw fetch.

The custom cron matcher supports:
- `*` — every value
- Specific values (e.g. `5`, `14`)
- Comma-separated values (e.g. `1,15`)
- Step values (e.g. `*/5`)

Standard 5-field cron expressions: `minute hour day-of-month month day-of-week`.

Double-fire prevention checks that `lastRun` wasn't in the same minute.

## `manage_schedule` Tool

`src/tools/scheduler.ts` — registered as an "always" category tool, available in every conversation.

### Actions

| Action | Description |
|--------|-------------|
| `create` | Create a new scheduled task with a cron expression and prompt |
| `list` | List all scheduled tasks with their status |
| `delete` | Delete a scheduled task by ID |
| `toggle` | Enable or disable a scheduled task |

### Creating a Task

Tell the bot something like:
- "Check the weather every morning at 8am"
- "Remind me to review PRs every weekday at 2pm"
- "Check if mediaserver is online every 30 minutes"

The AI will create a cron-scheduled task with appropriate timing and a prompt that gets full tool access when it fires.

### Schedule Options

Each schedule can optionally include:

- **`allowedTools`** — When set, only those tools are available during execution (e.g. `["ssh", "web_search"]`). When omitted, all tools are available.
- **`discordChannel`** — When set, results are posted to that Discord channel instead of Telegram.

## Quick Examples

| What you tell the bot | Cron expression | What happens |
|------------------------|-----------------|-------------|
| "Check the weather every morning at 8am" | `0 8 * * *` | Fires daily at 08:00, AI fetches weather and sends it to Telegram |
| "Remind me to review PRs every weekday at 2pm" | `0 14 * * 1-5` | Fires Mon-Fri at 14:00 |
| "Check if mediaserver is online every 30 minutes" | `*/30 * * * *` | Fires every 30 min, AI runs SSH health check |
| "Run the market report skill every morning at 7" | `0 7 * * *` | Fires daily at 07:00, AI calls `run_skill` |
| "Send a daily standup summary to Discord at 9am" | `0 9 * * 1-5` | Fires weekdays, posts to `discordChannel` instead of Telegram |

### Common Cron Patterns

| Pattern | Meaning |
|---------|---------|
| `0 8 * * *` | Every day at 8:00 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 0 1 * *` | First day of each month at midnight |
| `30 18 * * 0` | Sundays at 6:30 PM |
| `0 */3 * * *` | Every 3 hours |

Scheduled tasks execute with full tool access by default. Use `allowedTools` to restrict a task to specific tools (e.g. `["ssh", "web_search"]`).

## Built-in Scheduled Modules

Some scheduled behavior is built into the bot and cannot be accidentally deleted:

- **Daily conversation summary** — `conversation-summary.ts` fires at 23:55 daily, generating an AI summary of the day's conversations
- **Weekly channel summaries** — `conversation-channel-summary.ts` fires Sunday at 23:50, generates per-Discord-channel summaries from the past 7 days
- **Weekly memory consolidation** — `memory-consolidation.ts` fires Sunday at 23:00, curates `memory/SUMMARY.md` from all sources
- **Heartbeat** — `heartbeat.ts` writes `HEARTBEAT.md` to the memory repo every 3 hours (+ startup)
- **Conversation backup** — `conversation-backup.ts` backs up conversation history every 6 hours
- **Archive upload** — `conversation-archive.ts` uploads daily JSONL archives every 30 minutes
- **Journal upload** — `memory/journal.ts` uploads daily journal entries every 6 hours
- **Health checks** — `health.ts` runs every 5 minutes (GitHub access, token expiry)
