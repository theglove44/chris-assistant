---
title: Symphony Overview
description: GitHub issues in, draft pull requests out
---

# Symphony

GitHub issues in, draft pull requests out.

Symphony is the delivery engine inside Chris Assistant. It turns the right kind of GitHub issue into a supervised AI work run that ends with a draft PR for a human to review.

## The Pitch

Most teams do not struggle to notice work. They struggle to move small and medium-sized tasks from backlog to first implementation without wasting engineering time on context switching.

Symphony closes that gap.

Create the issue, apply the right label, and the system can:

- pick up the task
- work in an isolated repository workspace
- post progress back to the issue
- run checks
- open a draft PR when the work is ready for review

The goal is not to remove humans from the loop. The goal is to remove waiting, repetitive setup, and slow first-pass implementation work.

> Symphony is an AI teammate that can pick up the right GitHub issues, do the first implementation safely, and hand back a draft PR for approval.

## Why It Exists

Without a workflow like this, small tasks often die in the backlog because they are too small to prioritize but still large enough to require an engineer to stop what they are doing.

Symphony is designed to make those tasks cheaper to move forward.

### Before Symphony

- Someone notices a problem.
- A GitHub issue gets created.
- The task waits for an engineer to context switch into it.
- The first implementation pass competes with everything else already in progress.

### With Symphony

- Someone notices a problem.
- A GitHub issue gets created and labeled.
- Symphony picks it up.
- The assistant produces a first implementation pass and a draft PR.
- A human reviews, redirects, or approves.

## Real-World Use Cases

### Documentation and Content Updates

Examples:

- update onboarding copy after a process change
- refresh setup instructions after a tooling change
- fix stale documentation after a rename or migration

Why it fits:

These issues are usually clearly scoped, low risk, and valuable, but they often sit around longer than they should. Symphony can get them into review quickly.

### Product and Internal Tooling Tweaks

Examples:

- add a missing validation check
- improve logging around a flaky workflow
- adjust copy or labels in an internal tool
- add a small status indicator or reporting field

Why it fits:

These are the kinds of tasks that are too real to ignore, but too small to deserve a large planning cycle. Symphony is good at the first pass.

### Backlog Triage Into Action

Examples:

- a founder notices a rough edge and files an issue
- support turns repeated customer feedback into a concrete ticket
- ops identifies a repetitive fix or automation gap

Why it fits:

It shortens the path from "someone noticed this" to "there is already a draft solution to inspect."

## How The Flow Works

1. A person creates a GitHub issue.
2. They add the `symphony:todo` label.
3. Symphony claims the issue and starts an isolated work run.
4. The AI updates the issue with proof-of-work comments.
5. When the task is ready, Symphony moves it to `symphony:human-review`.
6. Symphony lands the changes to a branch and opens a draft PR.
7. A human reviews and decides what happens next.

That means the GitHub issue becomes the control point. You do not have to manually manage branches or start the coding session yourself.

## What Humans Still Control

Symphony is a supervised delivery loop, not unattended deployment.

Humans still decide:

- which issues belong in the queue
- whether the implementation is good enough
- whether the draft PR should be revised, approved, or closed
- when something is ready to merge

In the current version, Symphony intentionally stops at a draft PR. Reviewer assignment and merge remain manual.

## Safety Model

Symphony does not work directly in the main checkout.

Each issue gets its own isolated workspace so the assistant can:

- inspect the repository
- make changes
- run checks
- prepare a branch for review

This gives the process a clean audit trail and keeps the main working copy out of the execution path.

## Good Fit

Symphony works best when an issue is:

- clearly scoped
- reviewable
- concrete about the expected outcome
- likely to benefit from a fast first implementation pass

Good examples:

- docs updates
- repetitive engineering fixes
- small product changes
- internal tooling improvements
- issues with clear acceptance criteria

## Bad Fit

Symphony is not a good fit for:

- vague strategy work
- open-ended product discovery
- tasks that need a lot of clarification before coding starts
- high-risk changes where a human should drive every step directly

If a reviewer cannot tell what “good” looks like from the issue, Symphony will not be the right tool for that task.

## The Sidecar

Symphony runs as a **sidecar process** alongside the main Chris Assistant bot. It is a separate pm2-managed service with its own polling loop, HTTP status server, and workspace management. The bot and the sidecar share the same codebase but run independently.

The sidecar:

- polls a tracker (GitHub Issues or Linear) for candidate work items
- dispatches each issue to an isolated Codex agent workspace
- monitors progress, retries on failure, and respects concurrency limits
- lands completed work as a branch + draft PR (GitHub tracker only)
- exposes a local HTTP endpoint for status inspection

### Tracker Backends

Symphony supports two tracker backends:

**GitHub Issues** -- issues in a GitHub repo act as the task board. State is managed through labels prefixed with `symphony:`. The GitHub tracker also supports automatic PR landing and CI feedback.

**Linear** -- issues in a Linear project act as the task board. State is managed through Linear's built-in workflow states. Linear does not support automatic PR landing.

The tracker is configured in `WORKFLOW.md` (see below).

## GitHub-Backed Tracking

When using the GitHub tracker, issues become work items through a label-based state machine.

### Managed Labels

- `symphony:todo` -- issue is ready for Symphony to pick up
- `symphony:in-progress` -- Symphony has claimed the issue and is working on it
- `symphony:rework` -- a human reviewed and wants another implementation pass
- `symphony:human-review` -- the agent finished and the work is ready for review

### State Machine

```
symphony:todo --> symphony:in-progress --> symphony:human-review
                                      \                  |
                                       \                 v
                                        \---> symphony:rework
                                                   |
                                                   v
                                           symphony:in-progress
                                                   |
                                                   v
                                           symphony:human-review
                                                   |
                                                   v
                                                closed
```

The orchestrator polls GitHub for open issues with active-state labels. When it finds a `symphony:todo` issue, it claims it, starts a Codex agent run in an isolated workspace, and the agent works until it moves the issue to `symphony:human-review`.

If a human moves the issue to `symphony:rework`, the orchestrator picks it up again and continues from the existing workspace and branch state.

When an issue reaches a terminal state (`closed`), its workspace is cleaned up automatically.

### Assignee Filtering

You can optionally restrict Symphony to issues assigned to a specific user via `tracker.assignee` in the workflow config. Set it to `me` to use the authenticated GitHub user.

## The Landing System

When the GitHub tracker is used with `landing.enabled: true`, Symphony automatically lands completed work as a draft PR.

After an agent finishes and moves the issue to `symphony:human-review`, the landing system:

1. Checks the workspace for uncommitted changes
2. Creates or switches to a branch (`codex/symphony/<issue>-<slug>`)
3. Commits all workspace changes
4. Force-pushes the branch to origin
5. Creates a draft PR (or reuses an existing one for the same branch)
6. Waits briefly for CI results and posts a CI feedback comment on the issue

If the workspace has no changes, or the workspace is not a git checkout, landing is skipped.

Landing templates for the commit message, PR title, and PR body support `issue.identifier`, `issue.title`, and `last_agent_message` template placeholders (double-brace syntax).

## WORKFLOW.md Configuration

Symphony is configured through a `WORKFLOW.md` file at the project root. The file uses YAML front matter for configuration and Markdown body for the agent prompt template.

### Structure

```markdown
---
tracker:
  kind: github
  repo: "owner/repo"
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
hooks:
  after_create: |
    git clone "$SYMPHONY_SOURCE_REPO" .
    npm install
agent:
  max_concurrent_agents: 2
  max_turns: 4
codex:
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
You are working on issue {{ issue.identifier }}.

Issue title: {{ issue.title }}
Issue description:
{{ issue.description | default: "No description provided." }}

Working rules:
- ...
```

### Key Configuration Sections

**tracker** -- which backend to use. `kind: github` requires `repo`. `kind: linear` requires `api_key` and `project_slug`.

**workspace** -- `root` sets where per-issue workspaces are created.

**landing** -- controls automatic branch/PR creation. Only works with the GitHub tracker. `trigger_state` determines which label triggers landing. `branch_prefix` must start with `codex/`.

**hooks** -- shell scripts that run at workspace lifecycle points: `after_create`, `before_run`, `after_run`, `before_remove`. Commonly used to clone the repo and install dependencies.

**agent** -- `max_concurrent_agents` limits parallelism. `max_turns` caps how many Codex turns a single issue gets. `max_retry_backoff_ms` sets the maximum delay between retries.

**codex** -- Codex agent runtime settings. `thread_sandbox` controls filesystem access (`workspace-write` is recommended). `approval_policy` controls what the agent auto-rejects.

**server** -- the local HTTP status server. Defaults to `127.0.0.1:3010`.

**Prompt template** -- the Markdown body below the front matter is rendered per-issue using `issue.*` template variables (double-brace syntax) and passed to the Codex agent as its system prompt.

### Linear Configuration

For Linear, use `kind: linear` and provide the project slug and API key:

```yaml
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
    - "Done"
```

Linear issues use their built-in workflow states instead of labels. Landing is not available with the Linear tracker.

## CLI Commands

Symphony is managed through the `chris symphony` CLI:

| Command | Description |
|---|---|
| `chris symphony doctor [workflow]` | Validate the workflow file, Codex runtime, and tracker access |
| `chris symphony start [workflow]` | Start or restart the sidecar via pm2 |
| `chris symphony stop` | Stop the sidecar |
| `chris symphony run-once [workflow]` | Run a single poll/dispatch cycle in the foreground |
| `chris symphony status` | Show process status and orchestrator snapshot |
| `chris symphony cleanup [workflow]` | Prune finished workspaces and optionally stale remote branches |
| `chris symphony logs [issue]` | Show pm2 logs or per-issue logs |

### Useful Flags

- `chris symphony cleanup --apply` -- actually delete workspaces (default is dry-run)
- `chris symphony cleanup --delete-remote-branches --apply` -- also remove stale `codex/symphony/` branches with no open PR
- `chris symphony logs -f` -- follow log output
- `chris symphony logs '#42'` -- show per-issue log for issue 42

### Doctor Checks

`chris symphony doctor` validates:

- Workflow file parses correctly
- Workspace root is writable
- Codex app-server is installed and authenticated
- GitHub API token is configured (GitHub tracker)
- `gh` CLI is authenticated (GitHub tracker)
- Target repo is reachable (GitHub tracker)
- Required `symphony:*` labels exist on the repo (GitHub tracker)
- Landing source repo is a valid git checkout (when landing is enabled)

## Dashboard Integration

The Chris Assistant dashboard includes a Symphony status panel that shows:

- Workflow path and tracker type
- Number of running agents, retry queue depth, and claimed issues
- Last poll time
- Server port
- Recent completed runs with links to their draft PRs

The dashboard reads from the sidecar's HTTP status endpoint (`/api/symphony/state`). If the sidecar is not running, the panel shows a placeholder message.

## Current GitHub Workflow In This Repo

This repository uses GitHub Issues as the Symphony task board.

Managed labels:

- `symphony:todo`
- `symphony:in-progress`
- `symphony:rework`
- `symphony:human-review`

Handoff behavior:

- Symphony claims tagged issues
- performs the work in an isolated workspace
- comments back on the issue
- moves the issue to `symphony:human-review`
- lands the workspace changes to a branch
- opens a draft PR
- posts CI feedback on the issue

## Current Limits

This is still a v1 system.

That means:

- reviewer assignment is manual
- merge is manual
- issue quality matters a lot
- small, concrete tasks will perform better than broad, ambiguous ones
- landing only works with the GitHub tracker

That is intentional. The current goal is reliable supervised delivery, not autonomous shipping.

## The Short Version

If you need the fast explanation for a room of non-technical people:

> We use GitHub issues as a work queue. When we tag the right kind of task, Symphony can pick it up, do the first implementation in a safe isolated workspace, and hand us back a draft pull request with the work explained. Humans still review and approve it, but a lot of waiting and repetitive delivery work disappears.
