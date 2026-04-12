---
title: Usage
description: How to interact with your assistant via Telegram
---

# Usage

Message your bot on Telegram or Discord. That's it. On first contact, the assistant will introduce itself and begin learning about you through natural conversation.

## What You Can Send

- **Text messages** — normal conversation
- **Photos** — the AI will describe or analyze them (OpenAI/MiniMax providers)
- **Text documents** — .txt, .json, .csv, .md, .py, etc. are read inline and discussed

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Initial greeting |
| `/clear` | Reset conversation history and Claude session (long-term memory is preserved) |
| `/stop` | Abort the current Claude query |
| `/session` | Show active Claude session info |
| `/model` | Show current AI model and provider |
| `/memory` | Show memory file status with sizes |
| `/project` | Show or set the active project/workspace directory |
| `/reload` | Reload memory from GitHub (invalidates system prompt cache) |
| `/restart` | Graceful bot restart (pm2 auto-restarts the process) |
| `/purge` | Clear conversation, session, and redact today's archive |
| `/help` | List all available commands |

## How Memory Works

- **Short-term**: Last 20 messages per chat, persisted to `~/.chris-assistant/conversations.json`. Survives restarts. `/clear` wipes it.
- **Long-term**: The assistant uses its `update_memory` tool to persist important facts to GitHub.
- **Identity**: SOUL.md, RULES.md, VOICE.md define who the assistant is.
- **All memory changes are git commits** — fully auditable and rollback-able.

## Conversation Archive & Recall

Every message (user and assistant) is archived as JSONL to `~/.chris-assistant/archive/YYYY-MM-DD.jsonl`. These archives are uploaded to the GitHub memory repo every 5 minutes.

At 23:55 each day, an AI-generated summary of the day's conversations is created and stored in the memory repo. The last 7 days of summaries are automatically loaded into the system prompt, giving the bot natural recall of recent conversations.

The bot also keeps a daily journal — structured notes it writes throughout the day via the `journal_entry` tool. Today's and yesterday's journal entries are included in the system prompt.

You can ask the bot to recall past conversations using the `recall_conversations` tool, which supports listing archives, reading summaries, searching across all logs, and generating on-demand summaries for any date.
