# Token Usage Tracking

## Goal

Capture real token usage from every AI API call and store daily snapshots. The primary use case is model price comparison — understanding what each provider actually costs per day based on real usage patterns.

---

## Current state

No token tracking exists. API responses are consumed for text and tool calls only — the `usage` field returned by every provider is silently discarded. The only token-related code is a rough character-based estimator used for context compaction decisions (`src/providers/compaction.ts`).

---

## What each provider returns

All three providers return token counts in their API responses:

**OpenAI (Codex Responses API)**
Available on the final streaming event:
```json
{ "usage": { "input_tokens": 1240, "output_tokens": 183 } }
```

**Claude (Agent SDK)**
Available on the `result` message event:
```json
{ "usage": { "input_tokens": 980, "output_tokens": 241 } }
```

**MiniMax (OpenAI-compatible)**
Available on the final streaming chunk:
```json
{ "usage": { "prompt_tokens": 860, "completion_tokens": 97, "total_tokens": 957 } }
```

---

## Proposed implementation

### 1. Capture tokens in each provider

Each provider's `chat()` method should extract usage from the final API response and return it alongside the text response. The `Provider` interface would gain an optional `usage` field on the return type:

```typescript
// src/providers/types.ts
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: "claude" | "openai" | "minimax";
}

export interface ChatResult {
  text: string;
  usage?: TokenUsage;
}
```

Or more conservatively, keep the existing `chat()` signature unchanged and add a separate side-effect call to a usage recorder after each response.

### 2. Usage recorder

A lightweight module that appends to a daily JSONL file:

```typescript
// src/usage-tracker.ts
export function recordUsage(usage: TokenUsage): void

// Writes to: ~/.chris-assistant/usage/YYYY-MM-DD.jsonl
// Each line: { ts, provider, model, inputTokens, outputTokens }
```

### 3. Daily snapshot & cost calculation

A nightly schedule (or on-demand tool) that:
- Reads today's JSONL file
- Groups by provider + model
- Applies known per-token pricing
- Produces a cost summary

**Reference pricing (as of early 2026, per 1M tokens):**

| Model | Input | Output |
|---|---|---|
| claude-sonnet-4-6 | $3.00 | $15.00 |
| gpt-4o | $2.50 | $10.00 |
| gpt-5.2 (image model) | $5.00 | $20.00 |
| MiniMax | varies | varies |

Pricing should be stored in a config file (not hardcoded) so it can be updated without a code change.

### 4. Daily report format

Posted to Telegram (or a Discord channel) at midnight:

```
📊 Token Usage — 07 Mar 2026

🤖 claude-sonnet-4-6
   ↳ 142 calls  |  1.2M input  |  180k output
   💰 $3.60 + $2.70 = $6.30

🧠 gpt-5.2 (vision)
   ↳ 3 calls  |  12k input  |  1.8k output
   💰 $0.06 + $0.04 = $0.10

Total today: $6.40
7-day avg:   $5.80/day
```

---

## Files to create / modify

| File | Change |
|---|---|
| `src/providers/types.ts` | Add `TokenUsage` interface |
| `src/usage-tracker.ts` | New — append usage to daily JSONL |
| `src/providers/claude.ts` | Extract usage from result event |
| `src/providers/openai.ts` | Extract usage from final stream event |
| `src/providers/minimax.ts` | Extract usage from final stream chunk |
| `src/providers/index.ts` | Pass usage through to tracker after each call |
| `src/tools/usage.ts` | New — `get_usage_report` tool for on-demand queries |
| `~/.chris-assistant/usage/` | Runtime data directory for daily JSONL files |
| `~/.chris-assistant/token-pricing.json` | Editable pricing config per model |

---

## Implementation approach options

**Option A — Modify Provider interface (cleaner, more testable)**
Change `chat()` to return `ChatResult` with both text and usage. Callers extract text as before, usage gets passed to the tracker. Requires updating all call sites.

**Option B — Side-effect recording (zero call-site changes)**
Each provider calls `recordUsage()` internally before returning. No interface changes needed. Simpler to ship incrementally.

Option B is lower risk and can be done one provider at a time.

---

## Priority

Medium. No existing tracking means there's no historical data — the sooner this is added, the sooner meaningful comparisons are possible. Even a week of real data would be enough to make an informed model decision.
