---
title: Architecture Overview
description: System architecture and directory structure
---

# Architecture Overview

## Directory Structure

```
chris-assistant/              ← This repo (bot server + CLI)
├── bin/chris                 # Shell wrapper for global CLI command
├── src/
│   ├── index.ts              # Bot entry point (starts Telegram long-polling)
│   ├── config.ts             # Loads .env, exports typed config object
│   ├── telegram.ts           # grammY bot — message handler (text/photo/document), streaming edits
│   ├── discord.ts            # discord.js bot — message handler, typing indicator, reply chunking
│   ├── markdown.ts           # Standard markdown → Telegram HTML converter (with stripMarkdown() fallback)
│   ├── middleware.ts         # grammY middleware — auth guard + rate limiting
│   ├── rate-limit.ts         # Sliding window rate limiter (10 msgs/min per user)
│   ├── health.ts             # Periodic health checks + Telegram alerts
│   ├── webhook.ts            # GitHub webhook server — PR merge → Discord notifications
│   ├── scheduler.ts          # Cron-like scheduled tasks — tick loop, AI execution, Telegram delivery
│   ├── conversation.ts       # Persistent short-term history (async I/O, write queue, last 20 messages)
│   ├── conversation-archive.ts # Daily JSONL archiver (uploads every 30 min)
│   ├── conversation-backup.ts  # Periodic backup to GitHub memory repo (every 6 hours)
│   ├── conversation-summary.ts # Daily AI summarizer — generates summaries at 23:55
│   ├── conversation-channel-summary.ts # Weekly per-channel summarizer — Sunday 23:50
│   ├── memory-consolidation.ts # Weekly memory consolidation — Sunday 23:00
│   ├── dashboard.ts          # Built-in web dashboard — HTTP server, JSON API, inline SPA
│   ├── heartbeat.ts          # Periodic HEARTBEAT.md writer — bot status snapshot (every 3h)
│   ├── claude-sessions.ts    # Claude Agent SDK session persistence (per-chat session IDs)
│   ├── providers/
│   │   ├── types.ts          # Provider interface ({ name, chat() }) + ImageAttachment type
│   │   ├── shared.ts         # System prompt caching + model info injection
│   │   ├── claude.ts         # Claude Agent SDK provider
│   │   ├── openai.ts         # OpenAI provider — Codex Responses API + SSE streaming
│   │   ├── openai-oauth.ts   # OpenAI OAuth — authorization code + PKCE + account ID
│   │   ├── minimax.ts        # MiniMax provider (OpenAI-compatible API)
│   │   ├── minimax-oauth.ts  # MiniMax OAuth device flow + token storage
│   │   ├── compaction.ts     # Context compaction — summarizes old turns to stay in window
│   │   ├── context-limits.ts # Model context window sizes and compaction thresholds
│   │   └── index.ts          # Provider router — model string determines provider
│   ├── tools/
│   │   ├── registry.ts       # Tool registry — registerTool(), dispatch, MCP/OpenAI format
│   │   ├── index.ts          # Imports all tool modules, re-exports registry
│   │   ├── memory.ts         # update_memory tool
│   │   ├── web-search.ts     # Brave Search API (conditional on API key)
│   │   ├── fetch-url.ts      # URL fetcher — HTML stripping, 15s timeout
│   │   ├── run-code.ts       # Code execution — JS/TS/Python/shell, 10s timeout
│   │   ├── files.ts          # File tools — read, write, edit, list, search (workspace-scoped)
│   │   ├── git.ts            # Git tools — status, diff, commit (workspace-scoped)
│   │   ├── scheduler.ts      # manage_schedule tool — create, list, delete, toggle
│   │   ├── ssh.ts            # SSH tool — exec, tmux, SCP, Tailnet device discovery
│   │   ├── recall.ts         # Conversation recall tool
│   │   ├── journal.ts        # journal_entry tool — bot writes daily notes
│   │   ├── skills.ts         # manage_skills + run_skill tools
│   │   └── market-snapshot.ts # market_snapshot tool — SSH to Mac Mini for market data
│   ├── skills/
│   │   ├── loader.ts         # GitHub-backed skill CRUD with index caching
│   │   ├── validator.ts      # Skill definition + input validation, limits
│   │   └── executor.ts       # Build execution prompt, nested chat() with filtered tools
│   ├── memory/
│   │   ├── github.ts         # Read/write memory files via GitHub API
│   │   ├── journal.ts        # Daily memory journal — local storage + periodic GitHub upload
│   │   ├── loader.ts         # Assembles system prompt from memory
│   │   └── tools.ts          # Memory tool executor + prompt injection validation
│   └── cli/
│       ├── index.ts           # Commander.js program entry point
│       ├── pm2-helper.ts      # pm2 connection helper and constants
│       └── commands/          # One file per CLI command
```

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
├── archive/                  # Daily JSONL message logs (uploaded every 30 min)
├── journal/                  # Bot's daily journal notes (uploaded every 6 hours)
├── skills/                   # Reusable skill definitions (JSON)
│   ├── _index.json           # Lightweight skill index for system prompt discovery
│   └── *.json                # Individual skill definitions
└── conversations/
    ├── summaries/            # AI-generated daily conversation summaries
    └── channels/             # Weekly per-channel Discord summaries
```

## Data Flow

```
User sends Telegram message
  │
  ├── Auth middleware (user ID check)
  ├── Rate limit middleware (10/min sliding window)
  │
  ├── Load system prompt (5-min cache)
  │   ├── Identity files (SOUL.md, RULES.md, VOICE.md)
  │   ├── Knowledge files (about-chris, preferences, projects, people)
  │   ├── Memory files (decisions, learnings)
  │   ├── Recent summaries (last 7 days)
  │   ├── Recent journal (today + yesterday)
  │   ├── Skill discovery index (enabled skills with triggers)
  │   └── Project context (CLAUDE.md / README.md from workspace)
  │
  ├── Load conversation history (last 20 messages)
  │
  ├── Route to provider (based on model string)
  │   ├── gpt-* / o3* / o4-* → OpenAI
  │   ├── MiniMax-* → MiniMax
  │   └── everything else → Claude
  │
  ├── AI generates response (may call tools in a loop)
  │   ├── Tool calls dispatched via registry
  │   ├── Loop detection (3 identical calls = break)
  │   ├── Turn limit (configurable, default 200)
  │   └── Context compaction if approaching window limit
  │
  ├── Stream response to Telegram (1.5s edit interval)
  │
  ├── Save to conversation history
  ├── Append to daily archive (JSONL)
  └── Invalidate prompt cache
```
