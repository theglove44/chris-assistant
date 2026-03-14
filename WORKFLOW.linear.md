---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: "chris-assistant"
  active_states:
    - "Todo"
    - "In Progress"
    - "Rework"
  terminal_states:
    - "Closed"
    - "Cancelled"
    - "Canceled"
    - "Duplicate"
    - "Done"
workspace:
  root: ~/.chris-assistant/symphony/workspaces
hooks:
  after_create: |
    if [ ! -d .git ]; then
      git clone "$SYMPHONY_SOURCE_REPO" .
    fi
    if [ -f package-lock.json ] && [ ! -d node_modules ]; then
      npm install
    fi
  before_run: |
    git status --short
  after_run: |
    git status --short
agent:
  max_concurrent_agents: 2
  max_turns: 4
  max_retry_backoff_ms: 300000
codex:
  command: "codex app-server"
  approval_policy:
    reject:
      sandbox_approval: true
      rules: true
      mcp_elicitations: true
  thread_sandbox: workspace-write
server:
  host: "127.0.0.1"
  port: 3010
---
You are working on the `chris-assistant` repository for Linear issue {{ issue.identifier }}.

Issue title: {{ issue.title }}

Issue description:
{{ issue.description | default: "No description provided." }}

Working rules:

- Follow the repository's `AGENTS.md` and any repo-local `.codex/skills`.
- Work inside the current issue workspace only.
- Prefer small, reviewable commits and keep the branch state clean.
- Run `npm run typecheck` for meaningful changes.
- Run `npm test` when behavior, orchestration, or path safety changes.
- Use the `linear_graphql` tool when you need to comment on the ticket or move it between states.
- When implementation is ready, move the issue to `Human Review` with a concise proof-of-work summary.
- If blocked, explain the blocker clearly in Linear and stop rather than looping.
