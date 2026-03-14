# Webhook Server

## Overview

The webhook server listens for GitHub webhook events and posts notifications to Discord. It runs as a separate HTTP server alongside the main bot and dashboard.

Currently it handles one event: **PR merge notifications**. When a pull request is merged, it formats a summary and posts it to the `#pr-reviews` Discord channel.

## Configuration

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `GITHUB_WEBHOOK_SECRET` | Yes | — | HMAC-SHA256 secret configured in your GitHub webhook settings. Server won't start without it. |
| `WEBHOOK_PORT` | No | `3001` | Port the webhook server listens on. |

The webhook endpoint is `POST /webhooks/github`. A health check is available at `GET /health`.

## GitHub Setup

1. Go to your repo's Settings > Webhooks > Add webhook
2. Set **Payload URL** to `https://your-server:3001/webhooks/github`
3. Set **Content type** to `application/json`
4. Set **Secret** to match your `GITHUB_WEBHOOK_SECRET` env var
5. Select "Let me select individual events" and check **Pull requests**

## Events Handled

| GitHub Event | Action | Behavior |
|-------------|--------|----------|
| `ping` | — | Logs confirmation, no Discord message |
| `pull_request` | `closed` + `merged: true` | Formats and posts merge notification to Discord |
| `pull_request` | Any other action | Ignored |
| Any other event | — | Ignored |

## Security

- All payloads are verified against the `x-hub-signature-256` header using HMAC-SHA256 with timing-safe comparison
- Request bodies are capped at 1 MB
- Discord mentions (`@everyone`, `@here`, user/role pings) are stripped from PR titles and bodies before posting

## Integration

The webhook server is registered as a background service in the service registry and follows the standard `start*()`/`stop*()` lifecycle. It starts automatically on boot if `GITHUB_WEBHOOK_SECRET` is set.

## Files

| File | Purpose |
|------|---------|
| `src/webhook.ts` | Server implementation, signature verification, message formatting |
| `src/infra/config/schema.ts` | Env var validation for `GITHUB_WEBHOOK_SECRET` and `WEBHOOK_PORT` |
