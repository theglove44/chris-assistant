---
title: Local Development
description: Development workflow, adding tools, and adding providers
---

# Local Development

## Dev Commands

```bash
npm run dev              # Run bot with tsx watch (auto-reload on changes)
npm run typecheck        # TypeScript type checking (includes esbuild compat check)
npm test                 # Run Vitest test suite
npx tsx src/cli/index.ts # Run CLI directly without global install
npm run setup:calendar-helper # Build/install macOS Calendar helper app (~/.chris-assistant/ChrisCalendar.app)
```

## Test Suite

vitest suite in `tests/`:

| File | Tests | Coverage |
|------|-------|----------|
| `markdown.test.ts` | 29 | Telegram MarkdownV2 conversion |
| `path-guard.test.ts` | 10 | Workspace path boundary enforcement |
| `loop-detection.test.ts` | 9 | Tool loop breaker |

CI via `.github/workflows/ci.yml` runs typecheck + tests on push/PR to main.

::: tip Test environment
Test files set dummy env vars before imports to avoid `config.ts` throwing on missing required variables.
:::

## Adding New Tools

1. Create `src/tools/<name>.ts` with a `registerTool()` call
2. Add `import "./<name>.js"` to `src/tools/index.ts`
3. All three providers pick it up automatically — no provider code changes needed

The tool registry auto-generates both OpenAI and Claude MCP format definitions from a single registration.

## Adding New Providers

1. Create `src/providers/<name>.ts` implementing the `Provider` interface
2. Add model routing support via the model-routing helpers and `src/agent/chat-service.ts`
3. Add model shortcuts to `src/cli/commands/model.ts`
4. For OpenAI-compatible providers, use `getOpenAiToolDefinitions()` and `dispatchToolCall()` from `src/tools/index.ts`

## Project Structure

The codebase follows a convention-over-configuration approach:

- **One file per concern** — each tool, provider, and CLI command gets its own file
- **Shared registry** — tools register themselves, providers consume from the registry
- **No build step** — tsx runs TypeScript directly in development and production
- **pm2 for production** — the CLI wraps pm2's programmatic API

## Automated Checks

`npm run typecheck` runs two checks:

1. `tsc --noEmit` — standard TypeScript type checking
2. `node scripts/check-esbuild-compat.js` — scans for `</` inside regex literals (esbuild misparses these as HTML closing tags)
