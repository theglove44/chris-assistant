# OpenClaw Comparison — Adoption Roadmap

What to adopt from [OpenClaw's tool ecosystem](https://docs.openclaw.ai/tools), prioritized for a personal Telegram bot.

**Status:** ⬜ Not started · 🟡 In progress · ✅ Completed
**Impact:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

## Current Parity

Areas where chris-assistant already matches or is close to OpenClaw.

| Area | Chris-Assistant | OpenClaw | Gap |
|------|----------------|----------|-----|
| Web search | `web_search` — Brave API, count/freshness/country params | `web_search` — Brave/Perplexity, count/country/freshness params | Parity |
| URL fetch | `fetch_url` — Readability + regex fallback, 15s, 50KB | `web_fetch` — Readability parser, markdown/text modes, Firecrawl fallback, caching | Minor |
| Code execution | `run_code` — execFile, 4 languages, 10s | `exec` — full shell, background, PTY, multiple hosts, 1800s, approvals | Large |
| File read/write/list/search | 5 tools, workspace-scoped, path guard | `group:fs` | Parity |
| File edit | `edit_file` — single exact-match replace | `apply_patch` — multi-file multi-hunk structured patches | Large |
| Git | `git_status`, `git_diff`, `git_commit` (dedicated tools) | Via `exec` (no dedicated tools) | We're ahead |
| Memory | `update_memory` — add/replace, 6 categories, GitHub | `memory_search` + `memory_get` — semantic vector + BM25, temporal decay | Large |
| Scheduled tasks | `manage_schedule` + `scheduler.ts` — cron, AI execution | `cron` — gateway-managed jobs | Parity |
| Loop detection | 3 consecutive identical + 20/tool frequency limit | Configurable 3-tier thresholds (10/20/30) | Parity |
| Tool categories | `always` / `coding` | Layered profiles + allow/deny + provider policies | Moderate |

---

## Phase 1 — Quick Wins

Low-effort improvements that can all be done in a single session. Each is a small change to existing code.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 1 | 🟠 | ✅ | **Enhanced `web_search` params** | Added optional `count` (1-10, default 5), `freshness` (pd/pw/pm/py), and `country` params to `web-search.ts`. All three passed through to Brave API. |
| 2 | 🟠 | ✅ | **Fix `run_code` working directory** | Already implemented — `run-code.ts` sets `cwd: getWorkspaceRoot()` on execFile options. |
| 3 | 🟡 | ✅ | **Env sanitization for `run_code`** | Already implemented — `run-code.ts` uses `SAFE_ENV_KEYS` allowlist, only passes PATH/HOME/SHELL/LANG/TMPDIR/etc. All secrets automatically excluded. |
| 4 | 🟠 | ✅ | **Readability-based `web_fetch`** | `fetch-url.ts` now uses Mozilla Readability + linkedom for clean article extraction, falling back to regex `stripHtml` when Readability returns nothing. New deps: `@mozilla/readability`, `linkedom`. Strips nav menus, footers, ads automatically. |
| 5 | 🟡 | ✅ | **Better loop detection** | Added per-tool-name frequency counter (`FREQUENCY_LIMIT = 20`) alongside existing exact-duplicate check (`LOOP_THRESHOLD = 3`). Frequency counter catches slow loops where args vary between calls. Both reset via `resetLoopDetection()` between conversations. |

---

## Phase 2 — Major Capability Upgrades

Significant new tools that expand what the bot can do. Each is a standalone feature.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 6 | 🔴 | ⬜ | **`apply_patch` tool** | Multi-file structured editing via diff-like patch format. Supports create, update, delete, rename files. Hunks use context lines for matching. Dramatically reduces tool turns for refactoring — one call can edit multiple files vs many sequential `edit_file` calls that each risk failure. Keep `edit_file` alongside it. No new deps — pure string processing. OpenClaw restricts this to specific models; we can offer it to all. ~1-2 hours. |
| 7 | 🟠 | ⬜ | **Background code execution** | Add optional `background: boolean` to `run_code`. If true, spawn detached process, return a process ID. Add companion `check_process` tool to read output / check status / kill. Enables long-running commands (npm install, test suites, builds) that currently timeout after 10s. Store active processes in a Map, auto-cleanup after 30 min. ~1-2 hours. |

---

## Phase 3 — When Needed

Valuable features that aren't urgent today. Build when the triggering condition is met.

| # | Impact | Status | Item | Trigger | Description |
|---|--------|--------|------|---------|-------------|
| 8 | 🟠 | ⬜ | **Semantic memory search** | Memory files > ~10KB | Start with BM25 keyword search over memory files (`search_memory` tool). Later add OpenAI embeddings for vector search (we already have auth). OpenClaw uses hybrid 70/30 vector/keyword with MMR re-ranking and temporal decay. Currently all memory fits in the system prompt — this becomes needed when it doesn't. |
| 9 | 🟡 | ⬜ | **Image analysis tool** | When AI needs to examine images during tool loops | `analyze_image` tool — takes path (workspace-relative) or URL + prompt, base64-encodes image, sends to OpenAI/MiniMax vision API, returns text. Currently the bot handles images sent via Telegram but the AI can't proactively look at images on disk or at URLs. Useful for scheduled tasks checking dashboards. |
| 10 | 🟡 | ⬜ | **Sub-agent spawning** | When tool turn limits become a bottleneck | `spawn_subtask` tool — launches isolated `chat()` call with separate context and conversation history. Returns result as tool output. 1 level nesting max, 3 concurrent limit. Enables parallel research/work during complex tasks. OpenClaw supports 5 nesting levels and 8 concurrent — we start simpler. |
| 11 | 🟢 | ⬜ | **Response caching for web tools** | When Brave API costs or rate limits matter | In-memory Map with 15-min TTL for `web_search` and `fetch_url`. Key = URL/query, value = response + timestamp. Prevents redundant API calls when AI retries or re-fetches the same content. ~20 min to build. |

---

## Phase 4 — Future Consideration

Larger architectural changes. Worth keeping in mind but not planning actively.

| # | Impact | Status | Item | Description |
|---|--------|--------|------|-------------|
| 12 | 🟡 | ⬜ | **Workflow pipelines** | Lightweight Lobster-inspired sequential pipeline runner. Define workflows as JSON/YAML with steps (each a tool call). Scheduler runs workflows instead of raw prompts. Enables reliable multi-step scheduled tasks like "fetch inbox → categorize → summarize → send digest" without hoping the AI chains tools correctly. Full DSL is overkill — a simple sequential runner suffices. |
| 13 | 🟢 | ⬜ | **Tool profiles / allow-deny** | Extend category system to support allow/deny lists per context (e.g., scheduled tasks without file write access). OpenClaw has layered hierarchy: profile → provider → global → agent-specific. We'd want something simpler — maybe per-schedule tool restrictions. Worth doing when tool count exceeds ~15-20. |

---

## Deliberately Skipped

Features from OpenClaw that don't make sense for a single-user personal Telegram bot.

| Feature | Why Skip |
|---------|----------|
| **Browser automation** | Massive complexity (Chromium, CDP, snapshots). Not needed for chat bot. Revisit if we need web scraping beyond `fetch_url`. |
| **Multi-channel messaging** | Only using Telegram. Discord/Slack/etc not needed. |
| **Canvas/UI tools** | No visual frontend. |
| **Nodes (remote devices)** | No paired devices. Camera/location not applicable. |
| **Gateway management** | We use pm2. Different architecture. |
| **Plugin/skills framework** | Our `registerTool()` pattern is simple and works. Overkill unless tool count grows past 20+. |
| **ClawHub registry** | Community ecosystem, not applicable to personal bot. |
| **Exec approvals** | Single user, single machine. No approval workflows needed. |
| **Elevated mode** | No sandbox/gateway distinction. |
| **Chrome extension relay** | No browser automation. |
| **Firecrawl integration** | Paid service for JS-heavy sites. Not worth cost for personal use. |
| **llm-task** | Only useful with Lobster-style workflows. Revisit if we build pipelines. |

---

## Design Patterns Worth Adopting

Recurring patterns across OpenClaw's architecture that improve quality regardless of specific tools.

| Pattern | What OpenClaw Does | How We Could Apply It |
|---------|-------------------|----------------------|
| **Configurable thresholds** | Almost everything tuneable via `openclaw.json` | Add `~/.chris-assistant/config.json` for timeouts, truncation limits, loop thresholds, etc. instead of hardcoding. |
| **Graceful degradation** | `memory_get` returns `{ text: "", path }` instead of throwing | Standardize tool error responses — consistent shape so the AI doesn't misinterpret error strings as content. |
| **Fire-and-forget with announcement** | Sub-agent spawns return immediately, announce results later | Apply to long-running scheduled tasks — return acknowledgement, deliver results when done. |
| **Layered security** | Multiple policy levels that can only get more restrictive, never less | Keep in mind as we add more powerful tools. Each layer can deny, none can override a parent denial. |
| **Deterministic references** | Browser uses snapshot refs, not CSS selectors | Tools should return stable, unambiguous identifiers the AI can reference in follow-up calls. |
