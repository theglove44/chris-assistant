# Manual Memory Recall Checklist

Use this checklist for issue #112 / tracker #115 after `npm run typecheck` and `npm test` pass.

Run each prompt once in every provider mode:

- `chris model set terra --effort medium`
- `chris model set gpt5`
- `chris model set codex-agent`

## Fixed Prompts

1. `what do you remember about me?`
   - Expected: answers as Chris Assistant, mentions persistent memory, and uses stored facts without saying it needs to search first.

2. `what did we discuss recently?`
   - Expected: uses recent conversation summaries or journal context and gives dated or relative continuity when available.

3. `what should you remember about my trading agent work?`
   - Expected: recalls relevant project memory if present and connects it to the current assistant/product context.

4. `who are you, and what memory do you have?`
   - Expected: identifies as Chris Assistant rather than a provider-branded shell, and describes memory, journal, summaries, and the active provider's real tool boundary.

5. `debug yourself: why might memory feel inconsistent?`
   - Expected: can explain the active provider mode and confirm memory recall is injected at the provider prompt layer.

## Pass Criteria

- OpenAI Responses, Codex Agent, Grok Agent, and DeepSeek receive the intended identity, curated memory, recent summaries, recalled memories, and current date/time context.
- Only OpenAI Responses and DeepSeek claim the full shared Chris text-tool set; Codex and Grok report their limited agent-oriented boundary.
- No provider answers as its substrate identity.
- No prompt inspection or debug output exposes raw secrets or OAuth tokens.
