---
title: Security
description: Security measures — path guards, SSRF protection, environment sanitization, memory validation
---

# Security

## Workspace Path Guard

File tools scope to `WORKSPACE_ROOT` (default `~/Projects`). The guard in `resolveSafePath()` uses `fs.realpathSync` via a recursive `canonicalize()` helper to follow symlinks before the boundary check. Handles non-existent paths (for `write_file`) by resolving the deepest existing ancestor. A symlink inside the workspace pointing outside it will be correctly rejected.

## SSRF Protection

`fetch-url.ts` resolves hostnames via `dns.promises.lookup()` and checks against private IP ranges before fetching:

- `127.0.0.0/8` — loopback
- `10.0.0.0/8` — private class A
- `172.16.0.0/12` — private class B
- `192.168.0.0/16` — private class C
- `169.254.0.0/16` — link-local
- `0.0.0.0/8` — unspecified
- `::1` — IPv6 loopback
- `fc00::/7` — IPv6 unique local
- `fe80::/10` — IPv6 link-local

Blocks `localhost` and `::1` hostnames directly. DNS failures pass through to let fetch surface natural errors.

## Code Execution Environment Sanitization

`run-code.ts` uses an allowlist (`SAFE_ENV_KEYS`) of safe env vars (PATH, HOME, SHELL, LANG, TMPDIR, etc.) — everything else is stripped. New secrets added to `.env` are automatically excluded without code changes.

All code execution uses `child_process.execFile` (not `exec`) to avoid shell injection. 10s timeout, 1MB buffer, 50KB output truncation.

## Memory Guard

`validateMemoryContent()` in `memory/tools.ts` defends against prompt injection:

- **2000 char limit** per memory write
- **Replace throttle** — 1 replace operation per 5 minutes per category
- **Injection phrase detection** — blocks common prompt injection patterns
- **Dangerous shell block detection** — rejects memory content containing executable shell commands
- **Path traversal blocking** — prevents writing to paths outside the memory repo structure

All rejections logged with `[memory-guard]` prefix.

## Rate Limiting

Sliding window rate limiter (10 messages/minute) in `src/rate-limit.ts`. Integrated as grammY middleware. Replies with retry-after seconds when triggered.

## Authentication

- **Telegram**: Auth guard only responds to `TELEGRAM_ALLOWED_USER_ID`. Unauthorized `/start` gets a polite rejection; all other messages silently ignored.
- **Token files**: Both `minimax-oauth.ts` and `openai-oauth.ts` use `writeFileSync` with `{ mode: 0o600 }` for token files.
- **Error messages**: `telegram.ts` shows generic "Something went wrong" on errors. Raw error details stay in console logs only.

## SSH Tool Safety

- All commands via `execFile()` — no shell injection possible
- `BatchMode=yes` — SSH never prompts for passwords (fails fast instead)
- Absolute binary paths — works under pm2 daemon (no PATH dependency)
- Local SCP paths validated through `resolveSafePath()` — can't escape workspace
- No `git_push` tool — deliberate safety choice to prevent unreviewed pushes
