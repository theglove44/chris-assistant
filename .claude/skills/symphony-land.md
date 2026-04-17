# symphony-land

Land completed local work through the Symphony workflow — create a GitHub issue, branch, and draft PR following Symphony conventions.

## Usage
`/symphony-land` or `/symphony-land <one-line description of the work>`

## When to use
Use this skill whenever work has been done on the chris-assistant project that needs pushing to the repo. This replaces ad-hoc commits and PRs with the Symphony-standard flow: every change gets a tracked issue, a conventionally-named branch, and a draft PR for human review.

## Instructions

You are landing locally-completed work through the Symphony workflow. Follow these steps exactly.

### 1. Assess the current state

Run in parallel:
- `git status` — check for staged and unstaged changes
- `git diff HEAD --stat` — see what files changed
- `git diff HEAD` — read the actual changes
- `git log --oneline -5` — recent commits for context

If there are no changes (nothing staged, nothing unstaged, no new commits beyond origin/main), tell the user there's nothing to land and stop.

Determine whether the changes are:
- **Uncommitted** — files are modified/untracked but not yet committed
- **Committed locally** — one or more commits exist on the current branch that haven't been pushed

### 2. Create the GitHub issue

Analyze all changes and write a clear, concise issue that describes what was done and why.

Create the issue on `theglove44/chris-assistant` using `gh`:

```
gh issue create \
  --repo theglove44/chris-assistant \
  --title "<concise title under 70 chars>" \
  --label "symphony:todo" \
  --body "<description of changes and motivation>"
```

Capture the issue number from the output. You'll need it for the branch name.

### 3. Immediately move the issue to `symphony:human-review`

Since the work is already done, skip the `symphony:in-progress` state and move straight to review:

```
gh issue edit <number> --repo theglove44/chris-assistant \
  --remove-label "symphony:todo" \
  --add-label "symphony:human-review"
```

### 4. Create the Symphony branch

Branch naming must follow the convention in WORKFLOW.md:
- Prefix: `codex/symphony/`
- Format: `codex/symphony/issue-<number>-<slug>`
- Slug: lowercase, hyphens, max 48 chars, derived from the issue title

```
git checkout -b codex/symphony/issue-<number>-<slug>
```

If you're currently on a feature branch with commits (not main), cherry-pick or rebase those commits onto the new Symphony branch from main:

```
git checkout -b codex/symphony/issue-<number>-<slug> main
git cherry-pick <commits>
```

### 5. Stage and commit

If there are uncommitted changes, stage and commit them:

```
git add <specific files>
git commit -m "chore: Symphony landing for #<number>

<brief description>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

If changes are already committed, you can skip this step (the commits are already on the branch).

**Never stage `.env`, credentials, or files in `memory/`.**

### 6. Push and create the draft PR

```
git push -u origin codex/symphony/issue-<number>-<slug>
```

Create the draft PR following Symphony's template:

```
gh pr create --draft \
  --title "#<number> <issue title>" \
  --body "## Summary

<bullet points describing what changed and why>

## Latest Agent Summary

<concise proof-of-work: what was changed, what was tested, any concerns>

Refs #<number>

---
*Landed via Symphony workflow*"
```

### 7. Post a summary comment on the issue

```
gh issue comment <number> --repo theglove44/chris-assistant \
  --body "## Landing Summary

**Branch:** \`codex/symphony/issue-<number>-<slug>\`
**PR:** #<pr-number>
**Status:** Draft PR created — ready for human review

### Changes
<bullet list of key changes>

---
*Landed via /symphony-land*"
```

### 8. Return to main

```
git checkout main
```

### 9. Report to the user

Print a concise summary:
- Issue number and link
- PR number and link  
- Branch name
- What's next: "Review the draft PR, then merge or request rework"

## Important rules

- **Never push directly to main.** Always use the Symphony branch convention.
- **Never merge the PR automatically.** Symphony v1 stops at draft PR — merge is manual.
- **Never skip the issue.** Every landing needs a tracked issue for audit trail.
- **Run `npm run typecheck`** before landing if any `.ts` files changed. If it fails, fix the issues first — do not land broken code.
- **Keep commits clean.** Prefer one commit per landing. If the work spans multiple logical changes, it's fine to have multiple commits, but each should be meaningful.
- **Sensitive data check.** Before staging, scan for hardcoded IPs, tokens, or personal paths. Do not land sensitive data.
