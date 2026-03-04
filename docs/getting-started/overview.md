---
title: Overview
description: What Chris Assistant is and how it works
---

# Overview

A personal AI assistant accessible through Telegram and Discord. Supports multiple AI providers (Claude, OpenAI, MiniMax) with persistent memory stored in GitHub.

## How It Works

```
Telegram message (text, photo, or document)
  → grammY bot (guards to your user ID only)
  → Rate limiter (10 msgs/min)
  → Loads identity + memory from GitHub private repo (5-min cache)
  → Loads project context (CLAUDE.md/AGENTS.md/README.md from active workspace)
  → Builds system prompt with personality, knowledge, conversation history
  → Routes to active provider (Claude, OpenAI, or MiniMax)
  → Streams response back to Telegram with live updates
  → AI can call tools: memory, web search, fetch URLs, run code,
    read/write/edit files, git operations, manage scheduled tasks
  → Response rendered as Telegram HTML (with plain text fallback)

Scheduler (background):
  → Ticks every 60s, checks cron expressions
  → Fires matching tasks by sending prompt to active AI provider
  → AI gets full tool access (web search, code execution, files, etc.)
  → Response delivered to Telegram via raw fetch
```

The assistant has its own identity, personality, and evolving memory. Everything it learns about you is stored as markdown files in a separate private GitHub repo, giving you full visibility and version control over its brain.

## Features

- **Multi-provider AI** — Claude (Agent SDK), OpenAI, and MiniMax via a single bot. Switch models with `chris model set <name>`.
- **Streaming responses** — OpenAI and MiniMax stream tokens in real-time. Telegram message updates every 1.5s with a typing cursor.
- **Image understanding** — Send a photo and the AI will describe/analyze it (OpenAI and MiniMax). Claude falls back to text-only.
- **Document reading** — Send text files (.txt, .json, .csv, .md, etc.) and the AI reads the contents inline.
- **Web search** — AI can search the web via Brave Search API (optional, needs API key).
- **URL fetching** — AI can read any URL, with HTML stripping and 50KB truncation.
- **Code execution** — AI can run JavaScript, TypeScript, Python, or shell commands via `child_process.execFile` (10s timeout, 50KB output limit). Not sandboxed — runs with bot's user privileges.
- **File tools** — AI can read, write, edit, list, and search files in the active workspace. All paths scoped to `WORKSPACE_ROOT` (default `~/Projects`) with symlink-aware traversal guard.
- **Git tools** — AI can check `git status`, view diffs, and commit changes in the active workspace. No `git push` — deliberate safety choice.
- **SSH & remote access** — AI can SSH into Tailnet devices, run commands in persistent tmux sessions (attachable from iPhone), transfer files via SCP, and discover online devices. See the [SSH Tool Guide](/tools/ssh) for full details.
- **Scheduled tasks** — Tell the bot "check X every morning" and it creates a cron-scheduled task. Tasks fire by sending the prompt to the AI with full tool access, and the response is delivered via Telegram.
- **Project context** — When a workspace has a `CLAUDE.md`, `AGENTS.md`, or `README.md`, it's loaded into the system prompt so the AI understands the project.
- **Persistent memory** — Long-term facts stored as markdown in a GitHub repo. Every update is a git commit.
- **Persistent conversation history** — Last 20 messages per chat saved to disk. Survives restarts. `/clear` wipes it.
- **HTML rendering** — AI responses are converted to Telegram HTML with bold, italic, code blocks, and links.
- **Rate limiting** — Sliding window limiter (10 messages/minute per user).
- **Health monitoring** — Startup notification, periodic checks (GitHub access, token expiry), alerts with dedup.
- **Context compaction** — When the conversation approaches the model's context window limit, older tool turns are summarized into a structured checkpoint and the loop continues.
- **Discord support** — Optional Discord bot with the same AI capabilities. Splits at 2000 char limit, converts headers to bold.
- **Web dashboard** — Built-in web UI for monitoring status, schedules, conversations, memory, and logs. Auth via `DASHBOARD_TOKEN` or localhost-only.
- **GitHub webhooks** — PR merge notifications posted to Discord channels via webhook server.
- **Dynamic skills** — Reusable AI workflows defined as JSON, composing existing tools. Create at runtime via `manage_skills`.
- **Market snapshots** — SSH to Mac Mini for market data from tasty-coach.
- **Weekly memory consolidation** — Auto-curates a `SUMMARY.md` from all knowledge, memory, and recent conversations every Sunday.
- **Weekly channel summaries** — Per-Discord-channel conversation summaries generated every Sunday.
- **Heartbeat** — Writes `HEARTBEAT.md` to memory repo every 3 hours with bot status snapshot.
- **Prompt injection defense** — Memory writes are validated for size, rate, and suspicious content.

## Tech Stack

- **Runtime**: Node.js 22+ / TypeScript
- **AI (Claude)**: Claude Agent SDK with Max subscription OAuth
- **AI (OpenAI)**: OpenAI SDK with Codex OAuth (ChatGPT Plus/Pro subscription)
- **AI (MiniMax)**: OpenAI SDK with custom baseURL (`api.minimax.io`)
- **Telegram**: grammY
- **Discord**: discord.js
- **Memory**: GitHub API via Octokit
- **Tools**: zod (schema validation), native fetch, child_process
- **CLI**: Commander.js
- **Process management**: pm2
- **Dev**: tsx (TypeScript execution without build step)
