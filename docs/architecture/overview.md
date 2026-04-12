---
title: Architecture Overview
description: System architecture and directory structure
---

# Architecture Overview

## Directory Structure

```txt
chris-assistant/              ← This repo (bot server + CLI)
├── bin/chris                 # Shell wrapper for global CLI command
├── src/
│   ├── index.ts              # Thin entry point
│   ├── config.ts             # Compatibility entry to validated config loader
│   ├── app/                  # Bootstrap, lifecycle, service registry
│   ├── agent/                # ChatService + session persistence helpers
│   ├── channels/             # Telegram and Discord transport adapters
│   ├── domain/               # Core domains: conversations, memory, schedules
│   ├── infra/                # Shared infrastructure: config, storage
│   ├── providers/            # Claude, OpenAI, Codex Agent, MiniMax providers
│   ├── tools/                # Tool platform + tool modules
│   ├── dashboard/            # Dashboard runtime + HTML UI
│   ├── skills/               # Dynamic workflow system
│   ├── cli/                  # Commander.js CLI
│   ├── symphony/             # Autonomous orchestration subsystem
│   └── swift/                # Swift EventKit helper
```

### Compatibility facades

Some top-level files remain as stable facades while imports gradually converge on the new structure:

- `src/telegram.ts`
- `src/discord.ts`
- `src/dashboard.ts`
- `src/scheduler.ts`
- `src/conversation*.ts`
- `src/memory/*`
- `src/memory-consolidation.ts`

These mostly re-export or delegate into `channels/`, `domain/`, or `dashboard/`.

## Memory Repository

```
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
├── memory/
│   ├── decisions.md          # Important decisions
│   ├── learnings.md          # Self-improvement notes
│   └── SUMMARY.md            # Weekly-consolidated curated summary (read-only)
├── HEARTBEAT.md              # Bot self-reported status snapshot (updated every 3h)
├── archive/                  # Daily JSONL message logs (uploaded every 5 min)
├── journal/                  # Bot's daily journal notes (uploaded every 6 hours)
├── skills/                   # Reusable skill definitions (JSON)
│   ├── _index.json           # Lightweight skill index for system prompt discovery
│   └── *.json                # Individual skill definitions
└── conversations/
    ├── summaries/            # AI-generated daily conversation summaries
    └── channels/             # Weekly per-channel Discord summaries
```

## Data Flow

```txt
User sends Telegram or Discord message
  │
  ├── Channel middleware / auth / rate limits
  │
  ├── Channel handler normalizes message + attachments
  │
  ├── ChatService
  │   ├── image routing (vision always via OpenAI image model)
  │   ├── provider selection from model string
  │   ├── session helpers (Claude/Codex)
  │   └── streaming callback plumbing
  │
  ├── Provider
  │   ├── system prompt loading via memory prompt loader
  │   ├── provider-specific tool execution loop
  │   └── optional provider session resume
  │
  ├── Shared tool registry platform
  │   ├── filtering / allowedTools
  │   ├── loop guard
  │   ├── OpenAI adapter
  │   └── Claude MCP adapter
  │
  ├── Domain persistence
  │   ├── rolling conversation history
  │   ├── daily archive append
  │   ├── journal writes
  │   └── memory updates
  │
  └── Channel-specific output formatting / streaming
```

## Service Registry

Background services are registered as `AppService` entries in `src/app/service-definitions.ts`. Each service implements a `start()` / `stop()` pair and is managed by a `ServiceRegistry` that starts them in order and stops them in reverse order on shutdown.

Services are split into two registries based on boot timing:

- **Pre-Telegram** -- runs before the Telegram bot connects (e.g. setting the command menu)
- **Post-Telegram** -- runs after the bot is online

| Service | Purpose |
|---------|---------|
| `telegram-command-menu` | Sets the Telegram `/` command menu |
| `health-monitor` | Periodic health checks |
| `scheduler` | Cron-style scheduled task execution |
| `conversation-backup` | Backs up conversation history |
| `archive-uploader` | Uploads daily JSONL archives to GitHub |
| `daily-summarizer` | Generates daily conversation summaries |
| `channel-summarizer` | Weekly per-channel Discord summaries |
| `journal-uploader` | Uploads the bot's daily journal |
| `memory-consolidation` | Legacy periodic consolidation (superseded by DreamTask fire-and-forget after conversations) |
| `heartbeat` | Writes `HEARTBEAT.md` status to memory repo |
| `dashboard` | HTTP dashboard server |
| `discord` | Discord bot client |
| `webhook` | GitHub webhook server for PR notifications |
| `usage-report` | Daily token usage report |

To add a new background service, create a module with `start*()` / `stop*()` exports and add a `createService()` entry to the appropriate registry in `service-definitions.ts`.
