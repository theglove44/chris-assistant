---
title: Usage Tracking
description: Per-provider usage records and reporting
---

# Usage Tracking

Chris Assistant records usage reported by each provider after a completed turn. Records are grouped by provider and model so OpenAI Responses, Codex Agent, Grok Agent, and DeepSeek are not conflated.

## Storage

Daily JSONL snapshots live under `~/.chris-assistant/usage/`. This is private runtime data: do not commit it, publish it, or include raw records in bug reports without reviewing them for message or account metadata.

## Provider differences

Providers do not report identical counters. API providers commonly return input, output, cached, and reasoning-token fields. CLI agents may expose only the usage included in their structured event stream. Missing fields must remain unknown rather than being estimated and presented as exact.

The tracker records:

- provider and model;
- available token counters;
- timestamp and channel context needed for aggregation;
- cost only when a maintained price entry is available.

OAuth credentials and API keys are never usage data and must not be recorded.

## Reports

Use the assistant's `get_usage_report` tool for an on-demand UTC-date summary. Reports identify the provider/model source and distinguish observed token counts from calculated cost estimates.

When a new model is added, update the central model registry and pricing data together. If pricing is missing or may be stale, report tokens without claiming an exact cost.
