# Skills Guide

## What Are Skills?

Skills are reusable workflows defined as JSON. They compose existing bot tools into higher-level capabilities without writing any code. Skills are stored in the GitHub memory repo and can be created, edited, and deleted at runtime through conversation.

**Example use cases**: "Check Hacker News top stories", "Generate a weekly project status report", "Summarize my unread emails".

## How Skills Work

1. **Discovery** -- The skill index is loaded into the system prompt. The AI sees available skills and their trigger phrases.
2. **Execution** -- When triggered, `run_skill` loads the full definition, validates inputs, substitutes placeholders, and runs a focused AI call with only the skill's declared tools.
3. **Management** -- The `manage_skills` tool handles CRUD. No restart needed.

## Skill JSON Format

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
    "count": {
      "type": "number",
      "description": "Number of stories to fetch",
      "default": 5
    }
  },
  "instructions": "1. Fetch https://hacker-news.firebaseio.com/v0/topstories.json\n2. Take the first {count} story IDs\n3. Fetch each story's details\n4. Summarize with title, points, and URL",
  "outputFormat": "telegram",
  "state": {}
}
```

### Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | URL-safe lowercase slug (letters, digits, hyphens). Used as the filename. |
| `name` | Yes | Human-readable name. |
| `description` | Yes | Short summary of what the skill does. |
| `instructions` | Yes | Step-by-step prompt with `{inputName}` placeholders. Max 5000 chars. |
| `tools` | Yes | Array of registered tool names the skill may use. Validated at creation. |
| `triggers` | No | Phrases the AI recognizes as wanting this skill. |
| `inputs` | No | Typed parameters (`string`, `number`, `boolean`) with optional defaults. |
| `outputFormat` | No | Format hint for the output (default: `"telegram"`). |
| `state` | No | Persistent key-value data across invocations. Max 10 KB. |

## Create Your First Skill

The easiest way is to ask the bot directly:

> "Create a skill called 'Check Hacker News' that fetches the top stories from the HN API and summarizes them. It should use the fetch_url tool and accept a count parameter."

The AI will call `manage_skills` with action `create` and fill in the fields for you.

You can also be explicit about the parameters:

> "Create a skill with these details:
> - Name: Daily Weather
> - Description: Fetch current weather for a given city
> - Tools: fetch_url
> - Inputs: city (string, required)
> - Instructions: Fetch weather from wttr.in/{city}?format=j1 and summarize the current conditions
> - Triggers: weather, what's the weather"

## Managing Skills

All management happens through the `manage_skills` tool:

| Action | What it does |
|--------|-------------|
| `create` | Create a new skill. |
| `list` | Show all skills with status and triggers. |
| `get` | View the full JSON definition of a skill. |
| `update` | Modify fields on an existing skill (bumps version). |
| `delete` | Remove a skill permanently. |
| `toggle` | Enable or disable a skill. |
| `update_state` | Merge data into a skill's persistent state. |

**Examples**:
- "List my skills"
- "Disable the check-hn skill"
- "Update the weather skill to also include the forecast"
- "Delete the old market-report skill"

## Running Skills

Use `run_skill` directly or just use a trigger phrase:

- "Run the check-hn skill with count 10"
- "Check hacker news" (matches trigger phrase)

Skills also compose with the scheduler. A scheduled task can reference a skill:

> "Every morning at 8am, run the daily-weather skill for London"

## Limits

| Limit | Value |
|-------|-------|
| Max skills | 50 |
| Max instruction length | 5000 chars |
| Max state size | 10 KB |
| Tool validation | Must be registered tool names |

## Files

| File | Purpose |
|------|---------|
| `src/skills/loader.ts` | GitHub-backed CRUD with 5-min index cache |
| `src/skills/validator.ts` | Definition and input validation |
| `src/skills/executor.ts` | Placeholder substitution, nested `chat()` execution |
| `src/tools/skills.ts` | `manage_skills` + `run_skill` tool registration |
