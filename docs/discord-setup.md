---
title: Discord Setup
description: How to connect the bot to Discord
---

# Discord Setup

The bot can optionally connect to a Discord server alongside Telegram. Discord support is entirely optional — if no `DISCORD_BOT_TOKEN` is set, the bot skips Discord on startup.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from the [Discord Developer Portal](https://discord.com/developers/applications) |
| `DISCORD_GUILD_ID` | Recommended | Server (guild) ID for automatic channel setup |
| `DISCORD_ALLOWED_USER_ID` | Yes | Your Discord user ID — only messages from this user are processed |

Add these to your `.env` file.

## Creating the Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application
2. Go to **Bot** and click **Add Bot**
3. Copy the bot token into `DISCORD_BOT_TOKEN`
4. Enable **Message Content Intent** under Privileged Gateway Intents — this is required for reading message text

## Bot Permissions

When generating an invite link (OAuth2 > URL Generator), select these scopes and permissions:

**Scopes**: `bot`

**Bot Permissions**:
- Send Messages
- Read Message History
- Manage Channels (if using automatic channel setup)
- View Channels

The bot uses these Discord.js gateway intents:
- `Guilds`
- `GuildMessages`
- `MessageContent`
- `DirectMessages`

## How It Works

The Discord adapter works the same way as Telegram — messages from your allowed user ID are passed to the AI via `ChatService`, and responses are sent back to the channel.

Key behaviors:
- **Chat ID mapping**: Discord channel IDs are truncated to the last 9 digits and used as the numeric chat ID for conversation tracking
- **Attachments**: Images are downloaded, base64-encoded, and passed to the AI provider. Text files (`.txt`, `.md`, `.json`, etc.) are read and prepended to the message (50KB truncation)
- **Formatting**: AI responses are converted to Discord-flavored markdown. Messages over 2000 characters are split at natural boundaries
- **Typing indicator**: The bot shows "typing..." while processing

## Automatic Channel Setup

If `DISCORD_GUILD_ID` is set, the bot can automatically create channels on startup based on a config file at `~/.chris-assistant/discord-channels.json`.

The config defines categories and channels:

```json
[
  {
    "category": "Research",
    "channels": [
      { "name": "stock-research", "topic": "Market research and analysis" },
      { "name": "tech-news", "topic": "Technology news and trends" }
    ]
  }
]
```

You can also trigger channel setup manually by sending `!setup` in any channel.

## Scheduled Task Output

Scheduled tasks can optionally post results to a Discord channel instead of Telegram. Set the `discordChannel` field when creating a schedule to redirect output to a specific channel.
