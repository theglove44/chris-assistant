# Token Usage Tracking

## Overview

Token usage from every AI API call is captured and stored as daily JSONL snapshots. The primary use case is model price comparison — understanding what each provider actually costs per day based on real usage patterns.

## How It Works

Each provider records token usage as a side-effect after every API call. Usage data is appended to daily JSONL files:

```
~/.chris-assistant/usage/YYYY-MM-DD.jsonl
```

Each line contains: timestamp, provider, model, input tokens, output tokens, and calculated cost.

## What Each Provider Returns

All providers return token counts in their API responses:

**OpenAI (Responses API)**
```json
{ "usage": { "input_tokens": 1240, "output_tokens": 183 } }
```

**Claude (Agent SDK)**
```json
{ "usage": { "input_tokens": 980, "output_tokens": 241 } }
```

**MiniMax (OpenAI-compatible)**
```json
{ "usage": { "prompt_tokens": 860, "completion_tokens": 97, "total_tokens": 957 } }
```

## On-Demand Reports

The `get_usage_report` tool provides usage reports via conversation:

- **Single day**: "How much did I spend today?" — shows per-model breakdown with call counts and costs
- **Multi-day**: "Show me the last 7 days of usage" — daily totals with rolling average

Parameters:
- `date` — date in `YYYY-MM-DD` format (defaults to today)
- `days` — number of days to include (defaults to 1)

## Pricing

Token pricing is stored in a config file (`~/.chris-assistant/token-pricing.json`) so it can be updated without code changes.

## Files

| File | Purpose |
|------|---------|
| `src/usage-tracker.ts` | Core tracker — append usage, read daily summaries, format reports |
| `src/tools/usage.ts` | `get_usage_report` tool registration |
| `~/.chris-assistant/usage/` | Runtime data directory for daily JSONL files |
| `~/.chris-assistant/token-pricing.json` | Editable pricing config per model |
