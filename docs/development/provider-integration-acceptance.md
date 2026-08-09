# Provider integration acceptance

This runbook lands the eight provider workstreams without calling a live provider, changing a live service, sending a message, or reading private runtime/OAuth data.

## Merge order

1. **Baseline and model registry (Task 0/1).** Land the authoritative registry, strict unknown-model rejection, capability metadata, and validated `AI_REASONING_EFFORT` first.
2. **Remove Claude (Task 2).** Rebase onto the registry and remove Claude without reintroducing a second model list or provider fallback.
3. **Network and SSRF hardening (Task 3).** This is mostly independent, but land it before adding another direct API provider so the final security gate runs on the hardened tree.
4. **GPT-5.6 and thinking levels (Task 4).** Reconcile its local capability/effort code into Task 0's registry; do not retain two normalisers.
5. **Grok OAuth agent (Task 5).** Add its registry entries and provider implementation while preserving the provider-neutral abort/session façade.
6. **DeepSeek API provider (Task 6).** Add its registry entries and shared text-tool path after the common effort contract exists.
7. **Dependencies and documentation (Task 7).** Land last because its package files, model tables, setup, doctor output, and provider matrix describe the integrated result.
8. **Integration acceptance (Task 8).** Reconcile tests and run all gates below. Do not add a compatibility fallback merely to make a stale branch compile.

Task 3 may be applied immediately after Task 0 if it is genuinely conflict-free. Tasks 4, 5, and 6 are logically independent implementations but must be reconciled sequentially because they share routing, configuration, model display, and abort orchestration.

## Expected conflict map

| Surface | Expected owners | Reconciliation rule |
|---|---|---|
| `src/providers/model-routing.ts` or replacement registry | 0, 2, 4, 5, 6 | Task 0 owns structure. Add provider/model entries from later tasks; delete Claude entries; keep strict rejection. |
| `src/infra/config/*`, `src/config.ts`, `.env.example` | 0, 2, 4, 6, 7 | One validated effort field and one redacted DeepSeek key. Remove Claude variables. Never print secrets. |
| `src/agent/chat-service.ts`, `src/providers/index.ts` | 2, 4, 5, 6 | One provider-neutral resolve/clear/abort/session path. No channel may import provider-specific abort functions. |
| `src/cli/commands/model.ts` | 0, 2, 4, 5, 6, 7 | Generate from the registry where practical. Remove Claude aliases; show requested and effective effort. |
| `src/channels/telegram/commands.ts`, dashboard runtime/UI | 2, 4, 5, 6, 7 | `/model` and dashboard use the same formatter and report the same provider/model/effort. `/stop` stays provider-neutral. |
| `src/providers/shared.ts`, memory prompt code | 2, 4, 5, 6 | Preserve assistant identity and provider-wide recall. Remove provider-branded wording without weakening memory boundaries. |
| `src/symphony/agent-runner.ts`, `src/symphony/*` | 2, 4 | Keep Codex as the supported Symphony backend; remove only the Claude runner/configuration. |
| `package.json`, `package-lock.json` | 2, 4, 7 | Regenerate once from the integrated dependency set. No `audit fix --force`. |
| README, `AGENTS.md`, `docs/**` | 2, 7 | Task 2 moves durable project guidance; Task 7 owns final operator-facing facts. Never restore `CLAUDE.md`. |
| Tests for routing/config/commands | 0, 2, 4, 5, 6 | Prefer one registry contract table plus focused provider contract tests; remove contradictory duplicate fixtures. |

## Provider capability contract

The authoritative registry and its table-driven test must assert these effective capabilities:

| Provider path | Mode | Memory read/write | Recall/journal | Tools | Vision | Scheduled/headless |
|---|---|---|---|---|---|---|
| OpenAI Responses | Personal assistant | yes / yes | yes / yes | Chris shared tools | yes | yes |
| Codex Agent | Coding/workspace agent | injected read / no direct write | recall context / no journal tool | native workspace tools | no | no persisted scheduled session |
| Grok Agent | Coding/workspace agent | injected read only if implemented / no direct write | no direct journal tool | native CLI workspace tools | no unless verified | no persisted scheduled session |
| DeepSeek | Personal assistant, text-only | yes / yes | yes / yes | Chris shared text tools | no | yes |

Also assert:

- Model aliases resolve through the registry and unknown IDs fail during config loading and `chris model set`.
- OpenAI Responses and Codex Agent expose Sol, Terra, and Luna with only provider-verified effort values.
- DeepSeek Flash/Pro expose only provider-valid effective effort values; unsupported requested values are rejected or visibly normalised, never silently claimed.
- Provider capability text in CLI, Telegram, dashboard, README, and the operating manual agrees with the registry.

## Abort and session contract

Use fake transports/processes; do not call providers:

- `/stop` reaches one provider-neutral `ChatService.abort(chatId)` entry point.
- Aborting an inactive chat returns `false`; aborting an active chat returns `true`; a repeated abort is harmless.
- Abort is scoped to the requested chat and cannot stop another chat's work.
- OpenAI Responses and DeepSeek pass an `AbortSignal` through streaming fetch and tool-loop iterations.
- Codex passes the signal to the SDK and removes only the matching active controller in `finally`.
- Grok sends graceful termination to the directly spawned child, applies a bounded grace period, then force-kills only that child if necessary.
- Provider completion, error, and abort all clear active state. Starting overlapping work must not let an older request delete a newer request's controller.
- `/clear` removes only the active provider's persisted session. Scheduled `chatId: 0` work remains one-shot.

## Model and effort display

For each registered model, table-driven tests should compare one shared status object/formatter across CLI, Telegram, and dashboard:

```text
Provider: OpenAI
Model: gpt-5.6-terra
Requested effort: medium
Effective effort: medium
```

If a provider normalises an effort, requested and effective values must both remain visible. Secrets, OAuth paths, account IDs, and raw provider errors must not appear.

## Read-only acceptance harness

The baseline mode is safe on the pre-integration branch:

```bash
node scripts/check-provider-integration.mjs baseline
```

After all workstreams are reconciled, the final mode checks the four-provider markers, effort display, strict routing, and the no-Claude sweep:

```bash
node scripts/check-provider-integration.mjs final
```

The final no-Claude sweep covers active source, tests, scripts, docs, guidance, environment examples, and both package manifests. Git history and private home/runtime/OAuth data are deliberately outside its scope.

## Final gates

Run once on the reconciled tree, in this order:

```bash
npm run typecheck
npm test
npm run build
npm run docs:build
node scripts/check-provider-integration.mjs final
NPM_CONFIG_CACHE=/private/tmp/chris-assistant-npm-cache npm audit --omit=dev
git diff --check
git status --short
```

Audit findings require review. Do not run `npm audit fix --force`. A non-zero audit is a recorded blocker unless the remaining advisory is proven non-production or explicitly accepted.

## Live smoke gate — requires later explicit approval

Do not run these during integration. After approval, first confirm `git status --short` is clean, the bot/service is stopped or isolated, and no schedule or trading action can run. Use `chatId: 0` so no provider thread is persisted. Each prompt forbids tools and external actions.

```bash
AI_MODEL=gpt-5.6-terra AI_REASONING_EFFORT=low npx tsx -e 'import { chat } from "./src/providers/index.ts"; console.log(await chat(0, "Reply exactly SMOKE_OK. Do not use tools or perform external actions."));'
AI_MODEL=codex-agent-gpt-5.6-terra AI_REASONING_EFFORT=low npx tsx -e 'import { chat } from "./src/providers/index.ts"; console.log(await chat(0, "Reply exactly SMOKE_OK. Do not use tools or perform external actions."));'
AI_MODEL=grok-agent AI_REASONING_EFFORT=low npx tsx -e 'import { chat } from "./src/providers/index.ts"; console.log(await chat(0, "Reply exactly SMOKE_OK. Do not use tools or perform external actions."));'
AI_MODEL=deepseek-v4-flash AI_REASONING_EFFORT=high npx tsx -e 'import { chat } from "./src/providers/index.ts"; console.log(await chat(0, "Reply exactly SMOKE_OK. Do not use tools or perform external actions."));'
```

Before approval, reconcile the exact Grok alias and each provider's verified effort set from the landed registry. A smoke succeeds only when it returns `SMOKE_OK`, records sane usage without secrets, creates no persisted session for chat 0, and leaves the workspace and runtime state unchanged.

## Landing checklist

- [ ] Record each task's base commit, changed files, focused/full test results, and stated integration dependencies.
- [ ] Apply Task 0 and make its registry/config tests green.
- [ ] Apply Task 2; resolve against the registry; confirm no provider fallback remains.
- [ ] Apply Task 3 and run its SSRF tests before touching later provider conflicts.
- [ ] Apply Tasks 4, 5, and 6 one at a time; after each, reconcile registry, config, abort/session orchestration, usage, and display.
- [ ] Apply Task 7 last; regenerate the lockfile once and verify every documented command/model exists.
- [ ] Add or reconcile the table-driven capability, effort-display, and abort tests described above.
- [ ] Run the final gates and classify every failure as code, environment, dependency advisory, or approval-gated live verification.
- [ ] Inspect `git diff --stat`, `git diff --check`, and `git status --short`; preserve unrelated changes.
- [ ] Stop before live provider calls, service restart, Telegram/Discord messages, schedule execution, trading, commit, push, or PR.
