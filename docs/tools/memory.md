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

## Quick Examples

| What you tell the bot | What happens |
|------------------------|-------------|
| "Remember that I prefer dark mode in all apps" | AI calls `update_memory` with action `add`, category `preferences` |
| "My friend Jake works at Stripe" | AI adds to `people` memory — stored in `knowledge/people.md` |
| "I decided to use Postgres instead of SQLite for the new project" | AI adds to `decisions` memory |
| "What do you know about my preferences?" | AI reads the `preferences` memory file from the system prompt context |
| "Update my project notes — the deadline moved to April" | AI calls `update_memory` with action `replace` on the `projects` category |

### Memory Lifecycle

1. **Storage**: The AI decides when something is worth remembering and calls `update_memory` automatically
2. **Recall**: All memory files are loaded into the system prompt at the start of each conversation (cached for 5 minutes)
3. **Consolidation**: DreamTask runs automatically after conversations when enough time and sessions have elapsed — merges new facts, prunes stale data, and curates `memory/SUMMARY.md`
4. **Audit**: Every memory write is a git commit in the memory repo — fully auditable and rollback-able

### What Gets Stored Where

| Category | File | Use for |
|----------|------|---------|
| `about-chris` | `knowledge/about-chris.md` | Facts about you — job, location, family |
| `preferences` | `knowledge/preferences.md` | Likes, dislikes, style preferences |
| `projects` | `knowledge/projects.md` | Current work and side projects |
| `people` | `knowledge/people.md` | People you mention — names, context |
| `decisions` | `memory/decisions.md` | Important decisions and reasoning |
| `learnings` | `memory/learnings.md` | Things the bot learned about how to help you better |

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

## DreamTask — Automatic Memory Consolidation

DreamTask is a background consolidation service (`src/domain/memory/dream-service.ts`) that runs after conversations to keep memory lean and up-to-date. Inspired by Claude Code's autoDream system.

### How It Works

After each conversation, `tryDream()` checks three gates in order (cheapest first):

1. **Time gate** — at least 12 hours since last consolidation
2. **Session gate** — at least 3 new archive files since last run
3. **Lock gate** — no other consolidation currently in progress

If all gates pass, the service:
1. Reads current memory state (knowledge files, memory files, existing SUMMARY.md)
2. Collects recent conversation transcripts and journal entries
3. Sends a single-shot prompt to the AI with `allowedTools: []` (no tool loops)
4. Parses the JSON response and writes updated files to GitHub

### Outputs

| Field | File written | Purpose |
|-------|-------------|---------|
| `summary` | `memory/SUMMARY.md` | Curated index of key facts |
| `learnings` | `memory/learnings.md` | Updated self-improvement notes |
| `user` | `USER.md` | Updated user knowledge |

### Circuit Breaker

After 3 consecutive failures, the circuit breaker trips and dream is suspended until the process restarts. Failures are logged to pm2 logs.

### Manual Control

```bash
chris dream status   # See last run, hours since, failure count
chris dream run      # Force a run, bypassing all gates
```

## Journal

The bot writes structured notes throughout the day via the `journal_entry` tool (`src/tools/journal.ts`). Entries are appended to `~/.chris-assistant/journal/YYYY-MM-DD.md` as timestamped markdown (`**HH:MM AM/PM** — text`). A periodic uploader (every 6 hours) pushes changed journals to the memory repo. 2000 char limit per entry.

## Semantic Memory Recall (Voyage AI)

When a `VOYAGE_API_KEY` is set, memory file recall upgrades from keyword scoring to full semantic embeddings using Voyage AI.

### How It Works

At startup, `buildVoyageIndex()` reads all memory `.md` files and batch-embeds them using `voyage-3-lite`. The resulting vectors are stored in an in-memory index. On each query, the user's message is embedded as a query vector and compared to all stored vectors using cosine similarity. The top 5 most semantically relevant files are injected into the system prompt.

```
User sends message
  │
  ├── embed query via Voyage API (voyage-3-lite, inputType: "query")
  │
  ├── cosine similarity against all indexed memory file vectors
  │
  ├── top 5 results above threshold 0.5 → injected into system prompt
  │
  └── fallback: keyword scoring if Voyage returns 0 results
```

### Keyword Fallback

If Voyage returns no results (or `VOYAGE_API_KEY` is absent), the system falls back to keyword overlap + recency weighting. The two systems are complementary — Voyage handles semantic matches ("what's my trading setup" → `projects.md`), keyword handles exact-word queries.

### Index Updates

When `update_memory` writes a new file, `updateVoyageEntry()` re-embeds just that file and updates the in-memory index. No restart required.

### Activation

```bash
# Add to .env
VOYAGE_API_KEY=pa-xxxxxxxxx

# Restart — index builds at boot
chris restart

# Confirm in logs
npx pm2 logs chris-assistant | grep voyage
# → [voyage] Index built: 39 documents
```

Sign up at [dash.voyageai.com](https://dash.voyageai.com). The free tier includes 200M tokens/month — sufficient for typical memory volumes indefinitely. **Note:** Adding billing details is required to unlock standard rate limits before the initial index build (free tier without billing is throttled to 3 RPM).

### Pricing

| Model | Rate | Free Tier |
|-------|------|-----------|
| `voyage-3-lite` | $0.02/million tokens | 200M tokens/month |

At a typical memory size (40 files, ~1K tokens each) the index build costs ~$0.0008 and runs once per restart.

### Files

| File | Purpose |
|------|---------|
| `src/domain/memory/voyage-index.ts` | In-memory vector index, batch embed, cosine similarity, `updateVoyageEntry` |
| `src/domain/memory/recall.ts` | Tries semantic recall first, keyword fallback if 0 results |

---

## Conversation Recall

The `recall_conversations` tool (`src/tools/recall.ts`) provides 4 actions:

| Action | Description |
|--------|-------------|
| `list` | Show available archive dates with message counts |
| `read_day` | Read a day's AI summary or full conversation log |
| `search` | Grep across all local JSONL archives (50 result cap) |
| `summarize` | Generate an on-demand AI summary for any date |
| `read_journal` | Read past journal entries |
