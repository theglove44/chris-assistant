# Chris Assistant

Personal AI assistant for Chris Taylor — Telegram + Discord bot with multi-provider AI (Claude, OpenAI, MiniMax), GitHub-backed memory, and a web dashboard.

## Commands

```bash
npm run dev              # Run with tsx watch (auto-reload)
npm run typecheck        # TypeScript checks + esbuild compat check
npm test                 # vitest suite (48 tests)
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

Model string determines provider: `gpt-*`/`o3*`/`o4-*` → OpenAI, `MiniMax-*` → MiniMax, else → Claude.

Claude uses `@anthropic-ai/claude-agent-sdk` as full agent with native tools + custom MCP tools. OpenAI uses Codex Responses API (requires `stream: true`, `store: false`, GPT-5.x only). MiniMax uses OpenAI-compatible SDK.

Key directories:
- `src/providers/` — AI provider implementations + routing
- `src/tools/` — Tool registry + individual tool modules
- `src/memory/` — GitHub-backed memory storage + system prompt builder
- `src/skills/` — Dynamic JSON workflow system
- `src/cli/` — Commander.js CLI (`chris` command)

For full architecture, design decisions, and data flow see `docs/architecture/`.

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

See `src/config.ts` for all env vars. Key ones: `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `GITHUB_MEMORY_REPO`, `AI_MODEL`. Auth tokens stored in `~/.chris-assistant/`.

## Adding Things

- **New tool**: `src/tools/<name>.ts` with `registerTool()` + import in `src/tools/index.ts`
- **New provider**: `src/providers/<name>.ts` implementing `Provider` + prefix in `providers/index.ts`
- **New built-in module**: Follow tick-every-60s pattern (see `conversation-summary.ts`), add `start*()`/`stop*()` to `index.ts`
- **New skill**: Runtime via `manage_skills` tool — no code changes needed

## Documentation

- `docs/architecture/` — Overview, design decisions, providers, security, internals
- `docs/development/` — Gotchas, local dev setup
- `docs/tools/` — Per-tool documentation
- `docs/cli/` — CLI reference, environment variables
- `docs/getting-started/` — Setup wizard, usage guide
