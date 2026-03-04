---
title: Memory
description: The update_memory tool and memory system architecture
---

# Memory

## The Memory System

The assistant's long-term memory is stored as markdown files in a private GitHub repo. Every update is a git commit — fully auditable and rollback-able.

### Memory Repository Structure

```
chris-assistant-memory/
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
├── HEARTBEAT.md              # Bot status snapshot (updated every 3h)
├── archive/                  # Daily JSONL message logs
├── journal/                  # Bot's daily journal notes
├── skills/                   # Reusable skill definitions (JSON)
└── conversations/
    ├── summaries/            # AI-generated daily conversation summaries
    └── channels/             # Weekly per-channel Discord summaries
```

## `update_memory` Tool

Registered in `src/tools/memory.ts`. All providers support it — Claude uses MCP (in-process server), OpenAI and MiniMax use OpenAI-format function calling. All delegate to the same `executeMemoryTool()` function in `src/memory/tools.ts`.

### Actions

| Action | Description |
|--------|-------------|
| `add` | Append content to a memory file |
| `replace` | Replace the entire contents of a memory file |

### Categories

The tool targets specific memory file categories: `about-chris`, `preferences`, `projects`, `people`, `decisions`, `learnings`.

## Memory Guard

`validateMemoryContent()` in `memory/tools.ts` defends against prompt injection:

- **2000 char limit** per memory write
- **Replace throttle** — 1 replace per 5 minutes per category
- **Injection phrase detection** — blocks common prompt injection patterns
- **Dangerous shell block detection** — rejects content containing executable shell commands
- **Path traversal blocking** — prevents writing outside the memory repo structure

## System Prompt Assembly

`src/memory/loader.ts` loads all memory files from GitHub and assembles the system prompt:

1. Identity files (SOUL.md, RULES.md, VOICE.md)
2. Knowledge files (about-chris, preferences, projects, people)
3. Memory files (decisions, learnings)
4. Recent conversation summaries (last 7 days)
5. Recent journal entries (today + yesterday)
6. Curated memory summary (SUMMARY.md)
7. Skill discovery index (enabled skills with triggers)
8. Project context (CLAUDE.md / README.md from active workspace)

Results are cached for 5 minutes. Cache invalidates after any conversation (in case memory was updated).

## Journal

The bot writes structured notes throughout the day via the `journal_entry` tool (`src/tools/journal.ts`). Entries are appended to `~/.chris-assistant/journal/YYYY-MM-DD.md` as timestamped markdown (`**HH:MM AM/PM** — text`). A periodic uploader (every 6 hours) pushes changed journals to the memory repo. 2000 char limit per entry.

## Conversation Recall

The `recall_conversations` tool (`src/tools/recall.ts`) provides 4 actions:

| Action | Description |
|--------|-------------|
| `list` | Show available archive dates with message counts |
| `read_day` | Read a day's AI summary or full conversation log |
| `search` | Grep across all local JSONL archives (50 result cap) |
| `summarize` | Generate an on-demand AI summary for any date |
| `read_journal` | Read past journal entries |
