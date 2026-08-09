---
title: Web & Fetch
description: Web search and URL fetching tools
---

# Web & Fetch

## Web Search (`web_search`)

`src/tools/web-search.ts` — Firecrawl v2 Search API tool, conditionally registered only when `FIRECRAWL_API_KEY` is set.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search query string |
| `count` | No | Number of results (1-10, default 8) |
| `freshness` | No | Past day, week, month, or year (`pd`, `pw`, `pm`, `py`) |
| `country` | No | ISO country code such as `UK` or `US` |
| `location` | No | Geo-targeting location string |

Returns titles, URLs, and descriptions. Uses the native Firecrawl v2 API with no additional npm dependency.

::: tip Optional tool
When `FIRECRAWL_API_KEY` is absent, neither `web_search` nor `scrape_url` is sent to a provider — no dead tools in the API call.
:::

## URL Scrape (`scrape_url`)

`src/tools/scrape-url.ts` — sends a public HTTP(S) URL to Firecrawl and returns its main content as clean Markdown. Output is truncated to the normal tool-output limit, and private/internal destinations are rejected before the API request.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | Public HTTP(S) URL to scrape |

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
