/**
 * GitHub Webhook Server — listens for PR merge events and posts to Discord.
 *
 * Runs on a separate port from the dashboard. Verifies GitHub's HMAC-SHA256
 * signature before processing any payload. Only fires on PR merge (not close).
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import { createHmac, timingSafeEqual } from "crypto";
import { config } from "./config.js";
import { sendToDiscordChannel } from "./discord.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISCORD_CHANNEL = "pr-reviews";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ---------------------------------------------------------------------------
// Body reader
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// PR merge formatter
// ---------------------------------------------------------------------------

function formatPrMergeMessage(pr: any): string {
  const number = pr.number;
  const title = pr.title;
  const url = pr.html_url;
  const author = pr.user?.login || "unknown";
  const mergedAt = pr.merged_at ? new Date(pr.merged_at) : new Date();
  const dateStr = mergedAt.toUTCString().replace("GMT", "UTC");
  const headBranch = pr.head?.ref || "unknown";
  const baseBranch = pr.base?.ref || "main";

  // Extract labels
  const labels = (pr.labels || [])
    .map((l: any) => l.name)
    .filter(Boolean);
  const labelLine = labels.length > 0 ? `\n🏷️ ${labels.join("  ")}` : "";

  // Build summary from PR body (first ~300 chars, cleaned up)
  let summary = "";
  if (pr.body) {
    summary = pr.body
      .replace(/<!--[\s\S]*?-->/g, "")  // strip HTML comments
      .replace(/\r\n/g, "\n")
      .trim()
      .slice(0, 300);
    if (pr.body.length > 300) summary += "...";
  }
  const summaryBlock = summary ? `\n\n📋 **Summary**\n${summary}` : "";

  return [
    `🔀 **PR #${number}: ${title}**`,
    `🔗 [View PR](${url})`,
    "",
    `👤 **Author** — ${author}`,
    `📅 **Merged** — ${dateStr}`,
    `🌿 **Branch** — \`${headBranch}\` → \`${baseBranch}\``,
    summaryBlock,
    labelLine,
  ].filter((line) => line !== undefined).join("\n").trim();
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Only accept POST to /webhooks/github
  if (req.method !== "POST" || req.url !== "/webhooks/github") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const secret = config.webhook.secret;
  if (!secret) {
    console.error("[webhook] GITHUB_WEBHOOK_SECRET not configured — rejecting request");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Webhook secret not configured" }));
    return;
  }

  // Read and verify signature
  const body = await readBody(req);
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  if (!signature || !verifySignature(secret, body, signature)) {
    console.warn("[webhook] Invalid or missing signature — rejecting");
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid signature" }));
    return;
  }

  // Parse event type
  const event = req.headers["x-github-event"] as string | undefined;

  // Respond immediately — process async
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));

  // Handle ping (GitHub sends this when webhook is first created)
  if (event === "ping") {
    console.log("[webhook] Received GitHub ping — webhook verified");
    return;
  }

  // Only process pull_request events
  if (event !== "pull_request") {
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    console.error("[webhook] Failed to parse JSON payload");
    return;
  }

  // Only fire on merged PRs (action: closed + merged: true)
  if (payload.action !== "closed" || !payload.pull_request?.merged) {
    return;
  }

  const pr = payload.pull_request;
  console.log("[webhook] PR merged: #%d %s", pr.number, pr.title);

  try {
    const message = formatPrMergeMessage(pr);
    await sendToDiscordChannel(DISCORD_CHANNEL, message);
    console.log("[webhook] Posted PR #%d merge to #%s", pr.number, DISCORD_CHANNEL);
  } catch (err: any) {
    console.error("[webhook] Failed to post to Discord:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: Server | null = null;

export function startWebhook(): void {
  if (!config.webhook.secret) {
    console.log("[webhook] No GITHUB_WEBHOOK_SECRET configured — webhook server disabled");
    return;
  }

  if (server) return;

  const port = config.webhook.port;
  server = createServer((req, res) => {
    handleRequest(req, res).catch((err: any) => {
      console.error("[webhook] Unhandled error:", err.message);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Internal server error");
      }
    });
  });

  server.listen(port, () => {
    console.log("[webhook] GitHub webhook server running on port %d", port);
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error("[webhook] Port %d already in use — webhook server disabled", port);
      server = null;
    } else {
      console.error("[webhook] Server error:", err.message);
    }
  });
}

export function stopWebhook(): void {
  if (server) {
    server.close();
    server = null;
    console.log("[webhook] Webhook server stopped");
  }
}
