---
title: Agent Providers
description: Codex Agent and Grok Agent process boundaries
---

# Agent Providers

Chris Assistant has two provider styles:

| Style | Providers | Tool loop |
|-------|-----------|-----------|
| Shared assistant loop | OpenAI Responses, DeepSeek | Chris Assistant streams API responses and dispatches guarded shared tools |
| CLI agent | Codex Agent, Grok Agent | An authenticated CLI manages native workspace tools inside an explicit permission boundary |

The styles are intentionally different. A CLI agent is useful for codebase work, but it must not be documented as having the full memory, journal, scheduling, or private runtime-data access of a shared assistant provider unless that bridge exists and has been verified.

## Codex Agent

`@openai/codex-sdk` launches the Codex CLI and streams thread events. Each chat can resume a stored Codex thread; `/clear` removes the app's thread mapping and `/stop` cancels the active turn.

The thread must be created with:

- the selected registered model and valid reasoning effort;
- `workspace-write` rather than unrestricted host access;
- the configured workspace root;
- an approval-on-request policy;
- a bounded cancellation path.

Codex CLI authentication comes from `codex login`. This is separate from the OAuth state created by `chris openai login`.

## Grok Agent

Grok Agent launches the authenticated Grok CLI directly, without a shell. The adapter consumes structured streaming output and extracts user-facing text while keeping tool/status events as diagnostics.

Every run requires:

- an explicit binary path and workspace;
- a non-bypass permission mode;
- bounded turns and elapsed-time timeout;
- output draining and a terminate/grace/kill cancellation sequence;
- argument-array invocation, never command-string interpolation;
- credential redaction in errors and logs.

OAuth state is owned by the Grok CLI. Chris Assistant should test readiness without reading or printing secret values.

## Context and sessions

New agent sessions receive identity, formatting rules, curated memory, and relevant recalled memory. Resumed sessions reuse their prior context. Agent-session identifiers are runtime metadata and must not be committed.

One-shot jobs (`chatId === 0`) must not persist conversational agent sessions. Agent providers are not scheduler-suitable by default because unattended native-tool execution requires an explicit risk review.

## Shared assistant providers

OpenAI Responses and DeepSeek use the application's function-tool loop. They receive only registered, filtered tools, share loop guards and turn ceilings, and can support headless schedules. DeepSeek thinking mode additionally requires `reasoning_content` to be replayed across tool-call turns.

## Verification contract

For each agent provider, tests should prove:

1. model and effort validation;
2. exact process arguments and working directory;
3. structured streaming and final-text extraction;
4. per-chat session continuity and `/clear`;
5. `/stop`, timeout, and child cleanup;
6. sandbox/permission settings;
7. secret-free errors and logs;
8. no persistence for one-shot jobs.
