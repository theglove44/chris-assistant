# Chris Assistant Repository Guidance

Chris Assistant is a personal Telegram and Discord assistant with OpenAI Responses, Codex Agent, Grok Agent, and DeepSeek modes, GitHub-backed memory, and a web dashboard.

## Operating Constraints

- Read `README.md` before changing providers, memory, or schedules.
- Use `npm test` and `npm run build` after code changes.
- Keep tokens, OAuth files, personal messages, and user data private.
- Ask before sending messages, changing external services, or enabling live trading.
- Keep headless operation and existing conversation memory working.

## Commands

```bash
npm run dev
npm run typecheck
npm test
chris start
chris stop
chris restart
chris logs -f
chris doctor --fix
```

## Code Style

- TypeScript, ES modules (`import`/`export`), Node.js 22+
- Never use `</` in regex literals; use `new RegExp("<" + "/tag>")` because esbuild rejects the literal form
- Dashboard inline JavaScript uses `var`, `data-*` attributes, and `addEventListener`
- Register tools in `src/tools/<name>.ts` and import them from `src/tools/index.ts`

## Architecture

Model strings route through `src/providers/model-routing.ts`:

- `codex-agent-*` uses the OpenAI Codex Agent SDK
- `grok-agent-*` uses the OAuth-authenticated Grok CLI agent
- `deepseek-*` uses the DeepSeek API with the shared text-tool loop
- `gpt-*`, `o3*`, and `o4-*` use OpenAI Responses

The main layers are:

- `src/app/` — bootstrap, lifecycle, and service registry
- `src/agent/` — chat orchestration and session helpers
- `src/channels/` — Telegram and Discord adapters
- `src/domain/` — conversations, memory, and schedules
- `src/infra/` — configuration and storage
- `src/providers/` — OpenAI Responses, Codex Agent, Grok Agent, and DeepSeek implementations
- `src/tools/` — tool registration, filtering, loop guard, adapters, and tool modules
- `src/dashboard/` — dashboard runtime and UI
- `src/skills/` — dynamic JSON workflows
- `src/symphony/` — autonomous workflow subsystem using Codex

Important boundaries:

- `src/agent/chat-service.ts` is the orchestration seam for channels and background jobs
- `src/tools/registry.ts` is a facade over store, filtering, loop guard, and provider adapters
- Compatibility facades remain around older domain and channel entry points
- Configuration is validated through `src/infra/config/load-config.ts`

## Critical Safety Rules

- `DANGEROUS_PATTERNS` in `run-code.ts` blocks process-control and destructive shell commands
- `resolveSafePath()` canonicalises paths and rejects symlinks that leave the workspace
- Memory writes enforce length, injection, throttling, and path-traversal guards
- There is deliberately no `git_push` tool
- Never delete or modify files under `~/.chris-assistant/`; they are live runtime data, not repository source

## Gotchas

- pm2 does not inherit the interactive shell PATH; use resolved absolute binary paths
- Telegram renders HTML and limits messages to 4096 characters
- Dashboard template-literal escapes are consumed at build time; prefer `data-*` attributes and listeners
- Codex Responses requires streaming, `store: false`, and the account header
- Prompt memory is cached for five minutes and invalidated after conversations
- Before squash-merging the base of a stacked PR, retarget dependent PRs to avoid losing commits
- Documentation deployment uses `npm run docs:deploy`

## Environment

Required runtime configuration includes `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `GITHUB_MEMORY_REPO`, and `AI_MODEL`. DeepSeek uses the optional redacted `DEEPSEEK_API_KEY`; model effort uses `AI_REASONING_EFFORT`. Authentication and runtime state live outside the repository under `~/.chris-assistant/`, `~/.codex/`, and the Grok CLI's own OAuth store.

## Adding Things

- New tool: add `src/tools/<name>.ts` and import it from `src/tools/index.ts`
- New provider: implement `Provider` under `src/providers/` and route it through the chat service and model routing helpers
- New built-in module: prefer a domain or channel service with explicit start/stop hooks and register it in `src/app/service-definitions.ts`
- New background service: add an `AppService` entry in `src/app/service-definitions.ts`
- New skill: use the runtime `manage_skills` tool; no source change is normally needed

## Documentation

- `docs/architecture/` — architecture, providers, security, and internals
- `docs/development/` — local development and gotchas
- `docs/tools/` — tool documentation
- `docs/cli/` — CLI and environment reference
- `docs/getting-started/` — setup and usage
