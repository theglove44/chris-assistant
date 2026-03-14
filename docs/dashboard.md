---
title: Dashboard
description: Web-based monitoring UI for the bot
---

# Dashboard

A single-page web UI for monitoring and managing the bot. Served as a built-in HTTP server alongside the main process.

## Accessing the Dashboard

The dashboard starts automatically with the bot on the port set by `DASHBOARD_PORT` (default `3100`).

```
http://localhost:3100
```

**Authentication**: When `DASHBOARD_TOKEN` is set, requests must include either a `Bearer` token in the `Authorization` header or a `?token=` query parameter. When no token is configured, access is restricted to localhost connections only.

## Tabs

### Status

Bot uptime, active model and provider, image model, pm2 process info, and health check indicators (GitHub, Telegram, token expiry).

### Schedules

Lists all cron-scheduled tasks with their expression, prompt, enabled state, and next-run info. Supports editing, toggling, and deleting schedules directly from the UI.

### Conversations

Browse conversation archives by date. Shows the raw message log (user/assistant turns) and links to AI-generated daily summaries.

### Memory

Lists all memory files from the GitHub-backed memory repo (identity, knowledge, memory categories). Select a file to view or edit its contents with a built-in editor. Changes are committed directly to the memory repo.

### Logs

Tails pm2 stdout and stderr logs. Supports live streaming via SSE for real-time log watching.

### Calendar

Displays upcoming calendar events.

### Skills

Lists all registered skills with their definitions, triggers, and enabled state.

## API Endpoints

All endpoints return JSON and support CORS.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Bot status, uptime, model, pm2 info |
| `GET` | `/api/health` | Health check results |
| `GET` | `/api/symphony/state` | Symphony sidecar state (proxied) |
| `GET` | `/api/schedules` | List all schedules |
| `PUT` | `/api/schedules/:id` | Update a schedule |
| `DELETE` | `/api/schedules/:id` | Delete a schedule |
| `GET` | `/api/conversation` | Current conversation history |
| `GET` | `/api/archives` | List archive dates |
| `GET` | `/api/archives/:date` | Read archive for a date |
| `GET` | `/api/archives/:date/summary` | Read AI summary for a date |
| `GET` | `/api/journals` | List journal dates |
| `GET` | `/api/journals/:date` | Read journal for a date |
| `GET` | `/api/memory` | List memory files |
| `GET` | `/api/memory/:path` | Read a memory file |
| `PUT` | `/api/memory/:path` | Write a memory file |
| `GET` | `/api/skills` | List all skills |
| `GET` | `/api/logs` | Recent log lines (snapshot) |
| `GET` | `/api/logs/stream` | SSE stream of new log lines |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `DASHBOARD_PORT` | `3100` | HTTP port for the dashboard |
| `DASHBOARD_TOKEN` | — | Bearer token for remote access (optional) |
| `DOCS_URL` | — | URL to a docs site, shown as a link in the header (optional) |
