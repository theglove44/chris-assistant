# Chris Assistant

Personal AI assistant for Chris Taylor — Telegram + Discord bot with multi-provider AI (Claude, OpenAI, MiniMax), GitHub-backed memory, and a web dashboard.

## Commands

```bash
npm run dev              # Run with tsx watch (auto-reload)
npm run typecheck        # TypeScript checks + esbuild compat check
npm test                 # Vitest suite
chris start              # Start bot via pm2
chris stop / restart     # Stop / restart
chris logs -f            # Tail pm2 logs
chris doctor --fix       # Diagnose + auto-repair
```

## Code Style

- TypeScript, ES modules (`import`/`export`), Node.js 22+
- Never use `</` in regex literals — esbuild crashes. Use `new RegExp("<" + "/tag>")` instead
- Dashboard inline JS: use `var` (not `const`/`let`), `data-*` attrs + `addEventListener` (not inline `onclick`)
- Tool registration: create `src/tools/<name>.ts`, import in `src/tools/index.ts` — all providers auto-discover

## Architecture

Model string determines provider:
- `codex-agent-*` → OpenAI Codex Agent SDK
- `gpt-*` / `o3*` / `o4-*` → OpenAI Responses
- `MiniMax-*` → MiniMax
- everything else → Claude Agent SDK

The project is now split into explicit layers:
- `src/app/` — bootstrap, lifecycle, service registry
- `src/agent/` — `ChatService`, provider orchestration, session persistence helpers
- `src/channels/` — Telegram and Discord transport adapters
- `src/domain/` — conversations, memory, schedules
- `src/infra/` — config + storage infrastructure
- `src/providers/` — Claude, OpenAI, Codex Agent, MiniMax implementations
- `src/tools/` — tool registration, filtering, loop guard, provider adapters, tool modules
- `src/dashboard/` — dashboard HTTP runtime + UI template
- `src/skills/` — dynamic JSON workflow system
- `src/symphony/` — autonomous workflow subsystem

Important boundaries:
- `src/agent/chat-service.ts` is the main orchestration seam used by channels and background jobs.
- `src/tools/registry.ts` is now a façade over split modules (`store`, `filtering`, `loop-guard`, provider adapters).
- `src/memory/*`, `src/conversation*.ts`, `src/scheduler.ts`, `src/dashboard.ts`, `src/discord.ts`, and `src/telegram.ts` are mostly compatibility facades over the new structure.
- Config is validated through `src/infra/config/load-config.ts`.

For full architecture, design decisions, and data flow see `README.md` and project docs.

## Critical Safety Rules

- `DANGEROUS_PATTERNS` in `run-code.ts` blocks `pm2`, `kill`, `reboot`, `shutdown`, `rm -rf /`
- `PreToolUse` hook in `claude.ts` blocks same patterns + `npm run start/dev` + `chris start/stop/restart` in native Bash
- `resolveSafePath()` canonicalizes via `fs.realpathSync` — symlinks outside workspace rejected
- Memory guard: 2000 char limit, injection detection, replace throttle, path traversal blocking
- No `git_push` tool — deliberate safety choice

## Gotchas

Critical ones inline, full list in `docs/development/gotchas.md`:

- **esbuild `</` ban**: Use `new RegExp("<" + "/tag>")` — `npm run typecheck` catches violations
- **pm2 PATH**: Doesn't inherit shell PATH — use absolute binary paths (`TSX_BIN` in `pm2-helper.ts`)
- **Telegram HTML**: `markdown.ts` converts to HTML (`parse_mode: "HTML"`). Only escape `&`, `<`, `>`. Falls back to plain text on failure
- **Telegram limits**: 4096 char max, `splitMessage()` breaks at paragraph/sentence boundaries
- **Dashboard template literals**: Backslash escapes consumed by template — use `data-*` + `addEventListener`
- **SSH + pm2**: `~/.ssh/config` `Host` line must include IP for pm2 to resolve correct user
- **Codex API**: Requires `stream: true`, `store: false`, `chatgpt-account-id` header. Only GPT-5.x models
- **Memory cache**: 5-min TTL, invalidated after each conversation

## Environment

Config is validated through `src/infra/config/` (`src/config.ts` is a facade). Key ones: `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `GITHUB_MEMORY_REPO`, `AI_MODEL`. Auth tokens stored in `~/.chris-assistant/`.

## Adding Things

- **New tool**: `src/tools/<name>.ts` with `registerTool()` + import in `src/tools/index.ts`
- **New provider**: `src/providers/<name>.ts` implementing `Provider` + route it via `src/agent/chat-service.ts` / model routing helpers
- **New built-in module**: Prefer a domain or channel service with `start*()` / `stop*()` hooks, then register it in `src/app/service-definitions.ts`
- **New background service**: Add an `AppService` entry in `src/app/service-definitions.ts`
- **New skill**: Runtime via `manage_skills` tool — no code changes needed

## Documentation

- `docs/architecture/` — Overview, design decisions, providers, security, internals
- `docs/development/` — Gotchas, local dev setup
- `docs/tools/` — Per-tool documentation
- `docs/cli/` — CLI reference, environment variables
- `docs/getting-started/` — Setup wizard, usage guide
