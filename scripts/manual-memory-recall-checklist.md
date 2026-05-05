# Manual Memory Recall Checklist

Use this checklist for issue #112 / tracker #115 after `npm run typecheck` and `npm test` pass.

Run each prompt once in every provider mode:

- `chris model set claude`
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
   - Expected: identifies as Chris Assistant, not Claude Code/Codex/OpenAI, and describes memory, journal, summaries, and provider tools.

5. `debug yourself: why might memory feel inconsistent?`
   - Expected: can explain the active provider mode and confirm memory recall is injected at the provider prompt layer.

## Pass Criteria

- Claude, OpenAI Responses, and Codex Agent all show equivalent access to identity, curated memory, recent summaries, recalled memories, and current date/time context.
- Claude custom MCP tools still appear available in Claude mode.
- No provider answers as its substrate identity.
- No prompt inspection or debug output exposes raw secrets or OAuth tokens.
