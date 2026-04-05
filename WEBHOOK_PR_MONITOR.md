# GitHub Webhook — PR Merge Monitor

## Goal

Replace the current polling-based PR monitor (which checks every 30 minutes) with a GitHub webhook that fires instantly when a PR is merged. The bot should post a formatted summary to the `#pr-reviews` Discord channel within seconds of a merge.

---

## Why webhooks over polling

- **Instant** — no delay between merge and notification
- **Efficient** — no wasted API calls when nothing has happened
- **Reliable** — no risk of missing a PR if the timing gaps align badly

---

## How it works

```
PR merged on GitHub
      ↓
GitHub fires POST → https://your-domain.com/webhooks/github
      ↓
Bot verifies HMAC-SHA256 signature (X-Hub-Signature-256 header)
      ↓
Checks event: action == "closed" AND merged == true
      ↓
Formats PR summary → posts to #pr-reviews via sendToDiscordChannel()
```

---

## What needs building

### 1. HTTP endpoint in the bot

Add a lightweight HTTP server (e.g. Express or Node's built-in `http`) that listens for incoming webhook POST requests.

- Route: `POST /webhooks/github`
- Verify the `X-Hub-Signature-256` header using `GITHUB_WEBHOOK_SECRET` from `.env`
- Parse the JSON body
- Filter for `X-GitHub-Event: pull_request` + `action: "closed"` + `pull_request.merged: true`
- Call the formatter and post to Discord

**Key files to create/modify:**
- `src/webhook.ts` — new file, HTTP server + signature verification + handler
- `src/index.ts` — call `startWebhookServer()` alongside the bot startup
- `.env` — add `GITHUB_WEBHOOK_SECRET` and optionally `WEBHOOK_PORT`

### 2. Signature verification

GitHub signs every payload with HMAC-SHA256 using your chosen secret. Always verify before processing:

```typescript
import * as crypto from "crypto";

function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

### 3. PR summary formatter

Format the incoming payload into a Discord-friendly message:

```
🔀 **PR #[number]: [title]**
🔗 [View PR](html_url)

👤 **Author** — [login]
📅 **Merged** — [merged_at, DD MMM YYYY HH:mm UTC]
🌿 **Branch** — `[head.ref]` → `[base.ref]`

📋 **Summary**
[2-4 sentence summary generated from PR title + body]

🛠️ **Changes**
• [key change 1]
• [key change 2]

🏷️ [label1] [label2]
```

For the summary, either use the PR body directly (truncated/cleaned) or pass it to the AI provider for a concise summary.

### 4. Remove the polling schedule

Once the webhook is live, delete or disable the `PR Merge Monitor` entry in `~/.chris-assistant/schedules.json` (id: `pr001`). The webhook replaces it entirely.

---

## Making the bot publicly reachable

The bot needs a stable public HTTPS URL for GitHub to POST to. Options:

### Option A — Cloudflare Tunnel (recommended)

Free, no port forwarding, gives a stable `*.trycloudflare.com` or custom domain URL.

```bash
# Install
brew install cloudflare/cloudflare/cloudflared

# Authenticate
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create jarvis

# Configure (~/.cloudflared/config.yml)
tunnel: jarvis
credentials-file: ~/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: webhooks.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404

# Run
cloudflared tunnel run jarvis
```

Then add a CNAME DNS record pointing `webhooks.yourdomain.com` to `<tunnel-id>.cfargotunnel.com`.

### Option B — ngrok (quick but URL changes on restart unless paid)

```bash
brew install ngrok
ngrok http 3001
# Copy the https URL → use as webhook URL in GitHub
```

Not recommended for permanent use unless on a paid plan with a static domain.

### Option C — Static IP + port forward

If the Mac Mini has a static public IP or your router supports port forwarding, forward an external port to the bot's webhook port and use that URL directly. Requires a static IP or dynamic DNS.

---

## GitHub repo setup

Once the bot is reachable:

1. Go to `https://github.com/theglove44/chris-assistant/settings/hooks`
2. Click **Add webhook**
3. Set:
   - **Payload URL**: `https://your-domain.com/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: same value as `GITHUB_WEBHOOK_SECRET` in `.env`
   - **Events**: select **Individual events** → tick **Pull requests** only
4. Click **Add webhook**
5. GitHub will send a ping — verify it returns 200

---

## Environment variables to add

```env
GITHUB_WEBHOOK_SECRET=your-chosen-secret-here
WEBHOOK_PORT=3001
```

---

## Config to update

Add to `src/config.ts`:

```typescript
webhook: {
  secret: process.env.GITHUB_WEBHOOK_SECRET || null,
  port: Number(process.env.WEBHOOK_PORT || "3001"),
},
```

---

## Rollback / fallback

The polling schedule (`pr001` in `schedules.json`) can be re-enabled at any time if the webhook goes down. Keep it disabled rather than deleted until the webhook is confirmed stable.
