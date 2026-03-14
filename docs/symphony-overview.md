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

## Current GitHub Workflow In This Repo

This repository currently uses GitHub Issues as the Symphony task board.

Managed labels:

- `symphony:todo`
- `symphony:in-progress`
- `symphony:rework`
- `symphony:human-review`

Current handoff behavior:

- Symphony claims tagged issues
- performs the work in an isolated workspace
- comments back on the issue
- moves the issue to `symphony:human-review`
- pushes a branch
- opens a draft PR

## Current Limits

This is still a v1 system.

That means:

- reviewer assignment is manual
- merge is manual
- issue quality matters a lot
- small, concrete tasks will perform better than broad, ambiguous ones

That is intentional. The current goal is reliable supervised delivery, not autonomous shipping.

## The Short Version

If you need the fast explanation for a room of non-technical people:

> We use GitHub issues as a work queue. When we tag the right kind of task, Symphony can pick it up, do the first implementation in a safe isolated workspace, and hand us back a draft pull request with the work explained. Humans still review and approve it, but a lot of waiting and repetitive delivery work disappears.
