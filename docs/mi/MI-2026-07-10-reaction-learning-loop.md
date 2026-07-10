# MI — Reaction learning loop (#82)

## Trigger / symptom

Draft PR #126 captured Telegram `message_reaction` updates and archived reaction context, but did not implement the weekly distillation, system-prompt loading, or dashboard visibility required by issue #82.

## Scope inspected

- GitHub issue #82 and draft PR #126 (`feat/82-reaction-capture`)
- `origin/main` at `b5ddcea`
- Telegram reaction capture and message sending
- Memory prompt loading, background-service registration, and dashboard runtime/UI

## Commands run

```text
gh issue view 82 --repo theglove44/chris-assistant --json ...
gh pr view 126 --repo theglove44/chris-assistant --json ...
git fetch origin main feat/82-reaction-capture --prune
npm ci
npm run typecheck
npm test
npm run docs:build
```

## Files inspected

- `src/domain/feedback/reaction-service.ts`
- `src/channels/telegram/{handlers,reactions,webhook-verify}.ts`
- `src/domain/memory/{prompt-loader,consolidation-service,repository}.ts`
- `src/app/service-definitions.ts`
- `src/dashboard/{runtime,ui.html}`

## Findings

- Existing PR #126 correctly subscribed webhook transport to `message_reaction` and archived assistant/user/reaction context in daily local JSONL.
- Split Telegram replies were not individually tracked, so reactions on later chunks had no context.
- No weekly response-style artifact, prompt loading, or dashboard trend existed.
- Raw feedback contains conversational content and must remain local; the memory repo receives only the distilled markdown artifact.

## Direct answers / conclusions

- Learning artifact path: `memory/response_style_learnings.md` in the GitHub-backed memory repo.
- Raw events remain under `~/.chris-assistant/feedback/YYYY-MM-DD.jsonl`.
- Weekly job runs Sunday at 23:10 local process time, before the existing 23:55 daily summary job.
- Trend counts added emoji only, avoiding repeated counts when Telegram reports the full prior/current reaction sets.

## Proposed surgical fix

- Add reaction delay, feedback-reader/summary helpers, and all reply-chunk context capture.
- Add a weekly no-tool distillation run with explicit prompt-injection, safety, and anti-sycophancy guardrails. Every run writes an auditable record, including zero-feedback weeks.
- Load the artifact as a bounded response-style section in every provider prompt.
- Expose a seven-day feedback API and dashboard tab.

## Files changed

- Reaction capture, feedback aggregation, and weekly learning service.
- Memory schema/prompt loading, service registry, dashboard runtime/UI.
- Focused tests plus canonical-memory-schema expectations.
- Dashboard/environment documentation.

## Validation status

- `npm run typecheck` — passed.
- `npm test` — passed: 35 files, 263 tests.
- `npm run docs:build` — passed: VitePress build, 34 extensionless route aliases, 5 deep-route smoke checks.
- `npm ci` reported 11 dependency vulnerabilities (8 moderate, 3 high); not changed in this scoped feature.

## Current status / next steps

- Local continuation branch: `codex/82-reaction-learning`, based on draft PR #126 head.
- No commit, push, PR update, merge, or live Telegram operation performed.
- Live Telegram reaction acceptance remains an operator validation after deployment.
