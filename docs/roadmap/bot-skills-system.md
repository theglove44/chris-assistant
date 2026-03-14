# Bot Skills System — Implementation Plan

> **Status: Implemented** — PRs #24 (core infrastructure), #25 (system prompt integration), #26 (documentation) merged 2026-03-03.
>
> **This is a historical planning document.** For usage instructions, see the [Skills Guide](/skills-guide).

## Context

Chris wants the bot to have a dynamic skills system — reusable workflows the AI can discover, execute, and create at runtime. Today the bot has static TypeScript tools that require code changes and a restart. Skills bridge the gap: structured definitions (not code) that compose existing tools into higher-level capabilities. Inspired by OpenClaw's skill system but adapted for a personal bot.

**Key difference from OpenClaw**: OpenClaw skills are just prompt instructions injected into the system prompt. Our approach is hybrid — skills are *discovered* via the system prompt but *executed* via a dedicated `run_skill` tool that loads the full definition and calls `chat()` with filtered tools. This keeps the system prompt lean while giving skills reliable, focused execution.

## Skill Definition Format

Skills are JSON files in the GitHub memory repo. JSON matches existing patterns (schedules, tool schemas) and avoids needing a markdown parser.

```json
{
  "id": "check-hn",
  "name": "Check Hacker News",
  "description": "Fetch and summarize top stories from Hacker News",
  "version": 1,
  "enabled": true,
  "createdAt": 1709510400000,
  "updatedAt": 1709510400000,
  "triggers": ["check hacker news", "what's on HN", "tech news"],
  "tools": ["fetch_url"],
  "inputs": {
    "count": { "type": "number", "description": "Number of stories", "default": 5 }
  },
  "instructions": "1. Fetch https://hacker-news.firebaseio.com/v0/topstories.json\n2. Take the first {count} story IDs\n3. Fetch each story details\n4. Summarize with title, points, and URL",
  "outputFormat": "telegram",
  "state": {}
}
```

**Fields:**
- `id` — URL-safe slug, used as filename
- `triggers` — phrases the AI recognizes as wanting this skill (injected into system prompt)
- `tools` — existing tool names this skill is allowed to use (validated at creation)
- `inputs` — typed parameters with optional defaults; AI extracts from user message
- `instructions` — numbered steps with `{inputName}` placeholders; a prompt, not code
- `state` — persistent key-value data surviving across invocations

## Storage

```
chris-assistant-memory/
└── skills/
    ├── _index.json              # [{id, name, description, enabled, triggers}]
    ├── check-hn.json
    ├── market-report.json
    └── project-status.json
```

`_index.json` is a denormalized index rebuilt on every CRUD operation — prevents loading every skill file just to list them. ~100 bytes per skill.

## Execution Model

Skills are **NOT** registered as dynamic tools in the registry. Instead:

1. **Discovery** — Skill index loaded into system prompt alongside memory. AI sees available skills and triggers, can proactively suggest them.
2. **Execution** — `run_skill` tool loads full definition, validates inputs, substitutes `{placeholder}` values, calls `chat(0, executionPrompt, undefined, undefined, skill.tools)` with filtered tools. Same nested-`chat()` pattern the scheduler uses.
3. **Management** — `manage_skills` tool handles CRUD via GitHub memory repo.

**Why not register skills as real tools**: Adding/removing tools at runtime requires re-initializing the MCP server for Claude and regenerating OpenAI tool definitions mid-conversation. The registry is designed for static startup registration. `run_skill` as a stable entry point avoids this entirely.

## New Files

| File | Purpose |
|------|---------|
| `src/skills/loader.ts` | GitHub-backed skill CRUD with 5-min index cache |
| `src/skills/validator.ts` | Validation + limits enforcement |
| `src/skills/executor.ts` | Build execution prompt, nested `chat()` with filtered tools |
| `src/tools/skills.ts` | Register `manage_skills` + `run_skill` tools |

## Implementation Steps

### PR 1: Core skills infrastructure

**`src/skills/loader.ts`**
- `loadSkillIndex()` — reads `skills/_index.json` from GitHub, 5-min cache (same pattern as system prompt)
- `loadSkill(id)` — reads `skills/<id>.json` from GitHub
- `saveSkill(skill)` — writes skill file + rebuilds `_index.json`
- `deleteSkill(id)` — removes skill file + rebuilds index
- `invalidateSkillCache()` — clears index cache
- Uses `readMemoryFile()` / `writeMemoryFile()` from `src/memory/github.ts`
- TypeScript interfaces: `Skill`, `SkillInput`, `SkillIndexEntry`

**`src/skills/validator.ts`**
- `validateSkillDefinition(skill)` — returns error string or null
- Checks: id format (lowercase slug), required fields, `tools` array against registered tool names (imports from registry), instructions ≤ 5000 chars, state ≤ 10KB
- `validateInputs(skill, provided)` — checks required inputs present, types match
- Constants: `MAX_SKILLS = 50`, `MAX_INSTRUCTION_LENGTH = 5000`, `MAX_STATE_SIZE = 10240`

**`src/skills/executor.ts`**
- `executeSkill(skillId, inputs)` — load skill, validate inputs, substitute placeholders, build prompt, call `chat(0, prompt, undefined, undefined, skill.tools)`, return response
- Execution prompt template: skill name + description + substituted instructions + output format hint

**`src/tools/skills.ts`** — follows `src/tools/scheduler.ts` multi-action pattern
- `manage_skills` tool (category `"always"`) — actions:
  - `create`: validate, check count < 50, save, rebuild index, invalidate prompt cache
  - `list`: return formatted index
  - `get`: return full skill JSON including state
  - `update`: validate, increment version, save, rebuild index
  - `delete`: remove file, rebuild index
  - `toggle`: flip enabled, save
  - `update_state`: merge state object, save (no version bump)
- `run_skill` tool (category `"always"`) — takes `id` + optional `inputs` object, delegates to executor

**`src/tools/index.ts`** — add `import "./skills.js";`

### PR 2: System prompt integration

**`src/memory/loader.ts`**
- Add `skillIndex: string` to `LoadedMemory` interface
- Load `skills/_index.json` in parallel with other memory files in `loadMemory()`
- Format enabled skills as markdown list in `buildSystemPrompt()`

**`src/providers/shared.ts`**
- `getSystemPrompt()`: inject skill discovery section after capabilities section
- `getClaudeAppendPrompt()`: add `run_skill` and `manage_skills` to custom tools description block (~line 182-194), inject skill index section

Skill discovery section:
```
# Available Skills

You have reusable skills. Use run_skill to execute them. Use manage_skills to create/edit/delete.

- **check-hn** — Fetch and summarize top stories from Hacker News
  Triggers: "check hacker news", "what's on HN", "tech news"
```

### PR 3: Docs + seed skills

- Update `CLAUDE.md` architecture tree + key design decisions
- Create 2-3 seed skills in memory repo to demonstrate the format

## Guardrails for Self-Creation

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max skills | 50 | Prevents runaway creation |
| Max instruction length | 5000 chars | Keeps skills focused |
| Max state size | 10KB | Skills aren't databases |
| Tool validation | Must be registered names | No hallucinated tools |
| No code execution | Instructions are prompts | Skills compose tools, don't run code |

## Scheduler Integration

Skills compose naturally with existing schedules. A scheduled task's prompt:
> "Run the skill 'market-report'"

The AI calls `run_skill` → skill executes with its declared tools. The scheduler's `allowedTools` should include `run_skill` plus the skill's `tools` list.

## Files to Modify

| File | Change |
|------|--------|
| `src/skills/loader.ts` | **New** |
| `src/skills/validator.ts` | **New** |
| `src/skills/executor.ts` | **New** |
| `src/tools/skills.ts` | **New** |
| `src/tools/index.ts` | Add import |
| `src/memory/loader.ts` | Add `skillIndex` to `LoadedMemory`, load in parallel |
| `src/providers/shared.ts` | Inject skill discovery into both prompt builders |
| `CLAUDE.md` | Document skills system |

## Verification

1. `npm run typecheck` + `npm test` pass
2. Bot starts — `manage_skills` list returns empty
3. Create skill via Telegram: "create a skill to check Hacker News top stories"
4. Bot calls `manage_skills` create → skill appears in GitHub memory repo `skills/`
5. Run: "check hacker news" → bot recognizes trigger → `run_skill` → fetches HN API → returns summary
6. Verify state: `manage_skills` get shows updated state after run
7. Verify system prompt: skill appears in discovery section on next message
8. Verify scheduler: create a schedule that runs a skill → executes correctly
