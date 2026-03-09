---
title: Refactor Wrap-Up Audit
description: Post-refactor audit summary, remaining compatibility facades, and low-risk cleanup opportunities
---

# Refactor Wrap-Up Audit

This document captures the state of the codebase after the structural refactor.

## What Changed

The project was reorganized around clearer architectural layers:

- `src/app/` — bootstrap, lifecycle, service registry
- `src/agent/` — `ChatService`, provider/session orchestration
- `src/channels/` — Telegram and Discord transport adapters
- `src/domain/` — conversations, memory, schedules
- `src/infra/` — config and storage infrastructure
- `src/dashboard/` — dashboard runtime + UI
- `src/tools/` — split tool platform (store, filtering, loop guard, adapters)

## Compatibility Facades Intentionally Kept

These top-level files currently act as stable facades over the new internal structure:

- `src/telegram.ts`
- `src/discord.ts`
- `src/dashboard.ts`
- `src/scheduler.ts`
- `src/conversation.ts`
- `src/conversation-archive.ts`
- `src/conversation-backup.ts`
- `src/conversation-summary.ts`
- `src/conversation-channel-summary.ts`
- `src/memory-consolidation.ts`
- `src/memory/github.ts`
- `src/memory/journal.ts`
- `src/memory/loader.ts`
- `src/memory/tools.ts`
- `src/tools/registry.ts`

These are useful for now because they:
- preserve existing imports
- reduce churn during refactor
- give a stable public surface for future incremental cleanup

## Low-Risk Cleanup Opportunities

### 1. Decide which facades are permanent
Some facades are good public entrypoints and may be worth keeping permanently:
- `src/config.ts`
- `src/providers/index.ts`
- `src/tools/index.ts`

Others may be removable later once imports are updated internally:
- `src/telegram.ts`
- `src/discord.ts`
- `src/dashboard.ts`
- conversation/memory top-level wrappers

### 2. Normalize imports to new homes
A future cleanup pass could update internal imports to point directly at domain/channel modules instead of facade files.

Examples:
- conversation imports → `src/domain/conversations/*`
- memory imports → `src/domain/memory/*`
- dashboard imports → `src/dashboard/*`

### 3. Add a few more seam tests
The new seam tests cover config, cron parsing, tool filtering, and service registry. Good next candidates:
- dashboard auth and route handling
- `ChatService` provider routing behavior
- session persistence helpers
- schedule service execution behavior with mocked sinks

### 4. Remove stray non-source artifacts from `src/`
There are still a couple of repository hygiene items worth cleaning eventually:
- `src/.DS_Store`
- `src/.DS_Store`-style artifacts elsewhere if they reappear

### 5. Continue documentation alignment
The top-level docs now better reflect the new architecture, but any deep reference docs should continue to treat:
- `src/app/`
- `src/agent/`
- `src/channels/`
- `src/domain/`
- `src/infra/`

as the primary structure.

## Recommended Stopping Point

The broad refactor is in a good place to stop.

From here, the best work is likely:
1. feature development on the cleaner architecture
2. targeted seam tests where bugs are likely
3. small cleanup PRs rather than more sweeping moves
