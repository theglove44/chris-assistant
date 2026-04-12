---
title: Token Usage Tracking
description: Per-provider token usage tracking and cost reporting
---

# Token Usage Tracking

## Overview

Token usage from every AI API call is captured, aggregated, and stored as a daily JSON dashboard. The primary use case is model price comparison — understanding what each provider actually costs per day based on real usage patterns.

## How It Works

The `update-usage.sh` script parses all Claude Code session files from `~/.claude/projects/` and aggregates them into a daily usage dashboard at `~/.claude/usage-dashboard/usage-data.json`. The script runs nightly at 1:03 AM via launchd.

**Important**: Cache read tokens are the dominant cost driver for Claude (often 10M+ tokens/day from system prompt caching). The tracker captures these explicitly — without them the cost figures are misleadingly low.

## Usage Dashboard Data

`~/.claude/usage-dashboard/usage-data.json` contains:

```json
{
  "date": "2026-04-10",
  "sessions": 5,
  "messages": 339,
  "totalCost": 36.28,
  "models": {
    "claude-opus-4-5-20251001": {
      "inputTokens": 2140000,
      "cacheReadTokens": 13500000,
      "outputTokens": 45000,
      "cost": 34.12,
      "calls": 287
    }
  },
  "7dayAvg": 40.71
}
```

## On-Demand Reports

The `get_usage_report` tool provides usage reports via conversation:

- "How much did I spend today?" — shows per-model breakdown with call counts and costs
- "Show me the last 7 days of usage" — daily totals with rolling average

Parameters:
- `date` — date in `YYYY-MM-DD` format (defaults to today)
- `days` — number of days to include (defaults to 1)

**Note**: Mid-day reads are up to ~4.5 hours stale since the update runs at 1:03 AM nightly. The tool reads from the aggregated JSON rather than live API calls.

## What Each Provider Returns

All providers return token counts in their API responses:

**Claude (Agent SDK)**
```json
{ "usage": { "input_tokens": 980, "output_tokens": 241, "cache_read_input_tokens": 13500000 } }
```

**OpenAI (Responses API)**
```json
{ "usage": { "input_tokens": 1240, "output_tokens": 183 } }
```

**MiniMax (OpenAI-compatible)**
```json
{ "usage": { "prompt_tokens": 860, "completion_tokens": 97, "total_tokens": 957 } }
```

## Files

| File | Purpose |
|------|---------|
| `scripts/update-usage.sh` | Parses Claude Code session files → aggregated JSON dashboard |
| `src/tools/usage.ts` | `get_usage_report` tool registration — reads `usage-data.json` |
| `~/.claude/usage-dashboard/usage-data.json` | Aggregated daily usage dashboard |
