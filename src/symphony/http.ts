import { createServer, type Server } from "http";
import { readIssueLog } from "./paths.js";
import type { SymphonyOrchestrator } from "./orchestrator.js";

export function startSymphonyHttpServer(orchestrator: SymphonyOrchestrator, host: string, port: number | null): Server | null {
  if (port === null) return null;

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    const pathname = url.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (pathname === "/health") {
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname === "/api/v1/state") {
      res.end(JSON.stringify(orchestrator.snapshot()));
      return;
    }

    const issueMatch = pathname.match(/^\/api\/v1\/issues\/([^/]+)$/);
    if (issueMatch) {
      res.end(JSON.stringify({
        identifier: issueMatch[1],
        lines: readIssueLog(decodeURIComponent(issueMatch[1])),
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, host, () => {
    console.log("[symphony] Status API listening on http://%s:%d", host, port);
  });

  return server;
}
