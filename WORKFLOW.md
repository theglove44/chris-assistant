---
tracker:
  kind: github
  repo: "theglove44/chris-assistant"
  active_states:
    - "symphony:todo"
    - "symphony:in-progress"
    - "symphony:rework"
  terminal_states:
    - "closed"
workspace:
  root: ~/.chris-assistant/symphony/workspaces
landing:
  enabled: true
  trigger_state: "symphony:human-review"
  base_branch: "main"
  branch_prefix: "codex/symphony/"
  draft: true
  commit_message: "chore: Symphony landing for {{ issue.identifier }}"
  pull_request_title: "{{ issue.identifier }} {{ issue.title }}"
  pull_request_body: |
    ## Summary

    Automated Symphony landing for {{ issue.identifier }}.

    ## Latest Agent Summary

    {{ last_agent_message | default: "See the linked issue comments for the proof-of-work summary." }}

    Refs {{ issue.identifier }}
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
You are working on the `chris-assistant` repository for GitHub issue {{ issue.identifier }}.

Issue title: {{ issue.title }}

Issue description:
{{ issue.description | default: "No description provided." }}

Working rules:

- Follow the repository's `AGENTS.md` and any repo-local `.codex/skills`.
- Work inside the current issue workspace only.
- Prefer small, reviewable commits and keep the branch state clean.
- If the issue already names the file to change, open that file directly and avoid broad repo exploration.
- For small documentation-only edits, stay scoped to the named doc section, keep the patch minimal, and verify with a quick diff instead of wandering through unrelated files.
- Only use semantic search when the location is genuinely unclear after direct inspection.
- If the issue is in `symphony:rework`, assume there is already a draft PR branch for this ticket and continue from that branch state rather than starting over.
- Run `npm run typecheck` for meaningful changes.
- Run `npm test` when behavior, orchestration, or path safety changes.
- Use the `github_issue` tool with `issue_id: "{{ issue.id }}"` when you need to comment on the ticket or move it between Symphony-managed labels.
- When implementation is ready, move the issue to `symphony:human-review` with a concise proof-of-work summary.
- Do not open pull requests manually; the Symphony landing step will create the branch, commit, push, and draft PR after the issue reaches `symphony:human-review`.
- Leave landed PRs as draft-only; do not assign reviewers automatically in v1.
- If blocked, comment clearly on the GitHub issue and stop rather than looping.
