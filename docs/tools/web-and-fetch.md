---
title: Web & Fetch
description: Web search and URL fetching tools
---

# Web & Fetch

## Web Search (`web_search`)

`src/tools/web-search.ts` — Brave Search API tool, conditionally registered only when `BRAVE_SEARCH_API_KEY` is set.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search query string |

Returns top 5 results with titles, URLs, and snippets. Uses native `fetch` — no additional npm dependencies.

::: tip Optional tool
When `BRAVE_SEARCH_API_KEY` is absent, the tool definition is not sent to any provider — no dead tools in the API call.
:::

## URL Fetch (`fetch_url`)

`src/tools/fetch-url.ts` — always registered, reads any URL and returns cleaned content.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL to fetch |

Features:
- Native `fetch` with 15s timeout (AbortController)
- HTML extraction via Mozilla Readability + linkedom for clean article content (strips nav, ads, footers), with regex fallback
- 50KB content truncation
- No API key needed

### SSRF Protection

Resolves hostnames via `dns.promises.lookup()` and blocks private/internal IP ranges before fetching:

- `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- `169.254.0.0/16`, `0.0.0.0/8`
- `::1`, `fc00::/7`, `fe80::/10`
- `localhost` hostname blocked directly

DNS failures pass through to let fetch surface natural errors.
