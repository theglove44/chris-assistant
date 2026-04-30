import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { webhookCallback } from "grammy";
import { bot } from "./bot.js";
import { verifySecretHeader } from "./webhook-verify.js";

export interface WebhookRuntime {
  server: Server;
  // Stop the http listener; setWebhook is cleared separately so callers control
  // ordering between Telegram-side teardown and local socket close.
  close: () => Promise<void>;
}

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export { verifySecretHeader };

export async function startWebhook(opts: {
  url: string;
  secret: string;
  port: number;
}): Promise<WebhookRuntime> {
  // Path is secret-derived so a casual scan of the listening port can't even
  // reach the grammy handler — defense in depth alongside the header check.
  const path = `/telegram/${opts.secret}`;
  const handle = webhookCallback(bot, "http", { secretToken: opts.secret });

  const requestHandler = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "POST" || req.url !== path) {
      res.statusCode = 401;
      res.end();
      return;
    }
    if (!verifySecretHeader(req.headers[SECRET_HEADER], opts.secret)) {
      res.statusCode = 401;
      res.end();
      return;
    }
    Promise.resolve(handle(req, res)).catch((err) => {
      console.error("[telegram] webhook handler error:", err?.message ?? err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  };

  const server = createServer(requestHandler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  await bot.api.setWebhook(opts.url, {
    secret_token: opts.secret,
    allowed_updates: ["message", "edited_message", "callback_query", "channel_post"],
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
