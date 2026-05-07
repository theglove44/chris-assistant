---
title: Operating Manual
description: How Chris Assistant remembers, recalls, and chooses provider modes
---

# Operating Manual

This page describes the shipped assistant behavior. Roadmap ideas live under [Roadmap](/roadmap/features); this manual is for what the runtime does now.

## What It Remembers

Chris Assistant has three layers of memory:

| Layer | Where it lives | What it is for |
|-------|----------------|----------------|
| Short-term conversation history | `~/.chris-assistant/conversations.json` | Last 20 messages per chat, used for immediate continuity |
| Long-term memory | Private GitHub memory repo | Durable facts about Chris, projects, preferences, decisions, and learnings |
| Local archives and summaries | `~/.chris-assistant/archive/` plus GitHub summaries | Conversation recall beyond the rolling 20-message window |

The core GitHub memory files are `SOUL.md`, `IDENTITY.md`, `USER.md`, `memory/SUMMARY.md`, `memory/DASHBOARD.md`, and `memory/learnings.md`. The assistant also writes daily journal notes and generates conversation summaries.

## How Recall Works

Every normal provider prompt includes the assistant identity, curated memory, recent summaries, current date/time, and relevant recalled memory.

Semantic recall uses Voyage AI when `VOYAGE_API_KEY` is configured. The runtime embeds memory files and injects the most relevant matches for the current user message. If Voyage is unavailable or returns no strong matches, recall falls back to keyword and recency scoring.

Recent conversation summaries are always available in the prompt. Older local recall files can be surfaced by semantic recall when they match the current question.

## How To Inspect Memory

Use the assistant directly:

```text
what do you remember about me?
what did we discuss recently?
debug yourself
```

Use Telegram:

| Command | What it shows |
|---------|---------------|
| `/memory` | Required memory files and sizes |
| `/model` | Active provider and capability metadata |
| `/session` | Current provider session details, when that provider has one |
| `/reload` | Clears the system prompt cache so the next turn reloads memory |

Use the CLI:

```bash
chris memory status
chris memory show user
chris memory search "trading agent"
chris prompt inspect
chris dream status
```

The dashboard also exposes memory, schedules, conversations, and runtime health when enabled.

## How To Correct Memory

Small corrections can be made in conversation:

```text
remember that my project deadline moved to June
replace the note about my preferred editor: I use Cursor for most app work
```

The `update_memory` tool validates writes before they reach GitHub. It blocks oversized content, common prompt-injection phrases, dangerous shell blocks, path traversal, and too-frequent replace operations.

For direct edits, use:

```bash
chris memory edit user
chris memory edit learnings
```

Direct edits are committed to the private memory repo. Use `/reload` or wait for the 5-minute prompt cache to expire before expecting the running bot to use the new content.

## Provider Modes

Providers are not interchangeable. Use `/model` or `chris model` to see the current capability metadata.

| Provider | Best use | Memory and tools |
|----------|----------|------------------|
| Claude Agent | Default personal assistant path | Memory read/write, semantic recall, journal, scheduler, custom tools, native coding tools |
| OpenAI Responses | Personal assistant chat with OpenAI models and vision | Memory read/write, semantic recall, journal, scheduler, shared tools, image support |
| Codex Agent | Coding-focused workspace work | Identity and recalled memory are injected, but direct memory write and journal tools are not wired into the Codex CLI subprocess |
| MiniMax | General assistant chat through MiniMax | Memory read/write, semantic recall, journal, scheduler, shared tools, image support |

Use Claude or OpenAI Responses when the job depends on the fullest personal-assistant behavior. Use Codex Agent when the job is primarily codebase work and native Codex workspace tooling is the point.

## Routine Recovery Checks

These prompts should feel like Chris Assistant, not a provider-branded shell:

```text
who are you?
where do you run?
what memory/tools do you have?
how are you different from Claude Code?
```

For runtime diagnostics, use:

```bash
chris doctor
chris prompt inspect
chris codex status
```
