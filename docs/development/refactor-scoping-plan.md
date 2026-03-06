---
title: Refactor Scoping for Provider Work
description: A concise guide to scoping refactors safely in this codebase, with a practical plan for the Codex-related changes
---

# Refactor Scoping for Provider Work

This document has two purposes:

1. define how to scope refactors safely in **Chris Assistant**
2. give a concrete refactor plan for the upcoming provider work

The immediate target is the provider layer and the Codex-related changes.

## Safe-scoping rules

Use these rules for any refactor in this repo:

- start with one concrete problem, not a general desire to "clean things up"
- preserve a clear behavior contract while changing structure
- touch one boundary at a time
- keep feature work separate from architectural cleanup when possible
- avoid forcing unlike providers into one large abstraction too early
- define out-of-scope items early
- verify each step before moving on
- keep rollback simple

### Good refactor goals in this repo

- centralize provider detection
- remove provider-specific logic from `src/telegram.ts`
- standardize session handling patterns for agent-style providers
- make it easier to add a new provider without duplicating routing logic

### Architectural boundaries in this repo

Use these as refactor boundaries:

- **providers** — `src/providers/*`
- **session persistence** — `src/claude-sessions.ts` and future session stores
- **transport/UI** — `src/telegram.ts`, `src/discord.ts`
- **CLI/config** — `src/cli/commands/*`, `src/config.ts`
- **tools/memory** — `src/tools/*`, `src/memory/*`

If a change spans more than one or two of these at once, it is probably too large.

## Behavior contract to preserve

For the provider-related refactor, these should remain true unless intentionally changed:

- OpenAI models still route to `src/providers/openai.ts`
- MiniMax models still route to `src/providers/minimax.ts`
- Claude remains the fallback provider
- image attachments still route to `config.imageModel`
- `chris model` still reports the correct provider
- Telegram `/model`, `/clear`, `/stop`, and `/session` still behave correctly for the active provider

## Current codebase observations

Today:

- `src/providers/index.ts` owns provider routing
- `src/cli/commands/model.ts` duplicates some provider-detection logic
- `src/telegram.ts` contains Claude-specific handling for `/clear`, `/stop`, and `/session`
- `src/claude-sessions.ts` already provides a good pattern for per-chat session persistence

Those are the main pressure points to address.

## In scope

For the current provider refactor, keep scope limited to:

- centralizing model/provider detection
- standardizing the session-store pattern for agent-style providers
- removing provider-specific branching from `src/telegram.ts` where practical
- adding the Codex provider and its thread persistence
- wiring model aliases and provider-aware session/abort commands

## Out of scope

Do **not** include these in the same pass:

- rewriting the memory system
- redesigning conversation storage
- changing image-routing behavior
- rewriting Telegram streaming
- adding custom MCP tools for Codex in phase 1
- broad cleanup of unrelated modules

---

# Refactor plan

## Phase 0: Baseline

Before changing structure:

- run `npm run typecheck`
- run `npm test`
- manually verify:
  - `chris model`
  - Telegram `/model`
  - a normal text message
  - image routing
  - `/clear`
  - `/stop`
  - `/session`

### Exit criteria

Proceed only if:

- typecheck passes
- tests pass, or any existing failures are already known and documented
- the actual output or observed behavior of each baseline command/flow is recorded so it can be compared after changes

If a baseline command is already broken, note it before refactoring so you do not misclassify it as a regression.

## Phase 1: Centralize model/provider detection

### Change

Create a shared helper such as:

- `src/providers/model-routing.ts`

Move logic like this into one place:

- `isOpenAiModel(model)`
- `isMiniMaxModel(model)`
- `isCodexAgentModel(model)`
- `isClaudeModel(model)`
- `providerForModel(model)`

### Files

- new: `src/providers/model-routing.ts`
- update: `src/providers/index.ts`
- update: `src/cli/commands/model.ts`
- update: `src/telegram.ts`

### Exit criteria

Move to the next phase only if:

- `npm run typecheck` passes
- `chris model` still reports the same provider for existing model strings
- Telegram `/model` still reports the expected provider
- no existing provider routes differently unless explicitly intended

## Phase 2: Standardize session persistence pattern

### Change

Follow the existing Claude pattern rather than inventing a generic persistence layer.

Define the Codex session-store shape up front so the provider can use it later.

Expected API:

- `getThreadId(chatId)`
- `setThreadId(chatId, threadId)`
- `clearThread(chatId)`
- `clearAllThreads()`

Implementation note:

- create `src/codex-sessions.ts` in Phase 4 when the Codex provider is added
- keep its structure parallel to `src/claude-sessions.ts`

### Exit criteria

Move on only if:

- `npm run typecheck` passes
- the intended session API and storage pattern are clear
- no existing Claude session behavior changes

## Phase 3: Remove provider-specific session/abort logic from Telegram

### Change

Introduce small provider-aware helpers rather than hard-coding Claude behavior in `src/telegram.ts`.

Examples:

- `clearActiveProviderSession(chatId)`
- `abortActiveProviderQuery(chatId)`
- `getActiveProviderSessionInfo(chatId)`

These can dispatch internally based on the active model.

### Files

- `src/telegram.ts`
- either `src/providers/index.ts` or a small new provider helper module

### Exit criteria

Move on only if:

- `/clear` still clears the active provider session state correctly
- `/stop` still aborts the active provider if supported, otherwise fails gracefully
- `/session` still reports useful provider-specific information
- behavior changes are limited to message wording, not command semantics

Minor wording changes are acceptable. Semantic regressions are not.

## Phase 4: Add Codex provider

### Change

Add the new provider and route `codex-agent-*` models to it.

Add:

- `src/providers/codex-agent.ts`
- `src/codex-sessions.ts`
- routing in `src/providers/index.ts`
- model aliases in `src/cli/commands/model.ts`
- provider-aware support for `/clear`, `/stop`, and `/session`

Phase 1 feature scope for Codex should be limited to:

- text prompts
- streaming text output
- per-chat thread persistence
- abort support
- working-directory support
- one-shot non-persistent runs for `chatId === 0`

### Exit criteria

This phase is complete when all of the following work:

- switching to a `codex-agent-*` model
- first message starts a thread
- follow-up message resumes that thread
- `/clear` resets the thread
- `/stop` aborts an active run
- scheduled or headless runs do not persist threads
- existing Claude, OpenAI, and MiniMax behavior still works

---

# Suggested PR split

## PR 1: refactor only

Include:

- centralized model/provider detection
- provider-aware Telegram session/abort helpers
- any minimal structural cleanup required for the new provider

Do **not** add the Codex SDK yet.

## PR 2: Codex feature

Include:

- `@openai/codex-sdk`
- `src/providers/codex-agent.ts`
- `src/codex-sessions.ts`
- model aliases
- command wiring for clear/stop/session

This split makes failures easier to localize.

---

# Review checklist

Before merging, confirm:

- the change has one clear objective
- out-of-scope items stayed out of scope
- runtime, CLI, and Telegram use the same provider-detection rules
- command behavior still matches the behavior contract
- rollback is straightforward
- the PR is not mixing broad cleanup with new feature work unnecessarily

If those are not clearly true, the scope is probably too broad.
