import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { config } from "../config.js";
import { getHealthStatus, getProviderName } from "../health.js";
import { getSchedules, updateSchedule, removeSchedule } from "../scheduler.js";
import { listLocalArchiveDates, readLocalArchive } from "../conversation-archive.js";
import { listLocalJournalDates, readLocalJournal } from "../memory/journal.js";
import { readMemoryFile, writeMemoryFile } from "../memory/github.js";
import { getHistory } from "../conversation.js";
import { getBotProcess } from "../cli/pm2-helper.js";
import { loadSkillIndex, loadSkill } from "../skills/loader.js";
import { LIMITS } from "../infra/config/limits.js";

const BOT_STARTED_AT = new Date().toISOString();
const PM2_LOG_DIR = path.join(os.homedir(), ".pm2", "logs");
const OUT_LOG = path.join(PM2_LOG_DIR, "chris-assistant-out.log");
const ERR_LOG = path.join(PM2_LOG_DIR, "chris-assistant-error.log");
const PM2_CACHE_TTL = LIMITS.pm2CacheTtlMs;

const MEMORY_FILES = [
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "MEMORY.md",
  "AGENTS.md",
  "TOOLS.md",
  "BOOTSTRAP.md",
  "memory/SUMMARY.md",
  "memory/DASHBOARD.md",
  "memory/learnings.md",
];

let server: Server | null = null;
let pm2Cache: { data: any; ts: number } | null = null;

function isAuthorized(req: IncomingMessage, url: URL): boolean {
  const token = config.dashboard.token;

  if (token) {
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${token}`) return true;
    if (url.searchParams.get("token") === token) return true;
    return false;
  }

  const remoteAddr = req.socket.remoteAddress || "";
  return remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
}

function json(res: ServerResponse, data: any, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function tailFile(filePath: string, lines: number): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const allLines = content.split("\n").filter(Boolean);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function handleStatus(res: ServerResponse): Promise<void> {
  let pm2Info = null;
  const now = Date.now();
  if (pm2Cache && now - pm2Cache.ts < PM2_CACHE_TTL) {
    pm2Info = pm2Cache.data;
  } else {
    try {
      pm2Info = await getBotProcess();
      pm2Cache = { data: pm2Info, ts: now };
    } catch {
      pm2Info = null;
    }
  }

  json(res, {
    uptime: process.uptime(),
    uptimeFormatted: formatUptime(process.uptime()),
    startedAt: BOT_STARTED_AT,
    model: config.model,
    provider: getProviderName(config.model),
    imageModel: config.imageModel,
    pm2: pm2Info,
  });
}

function handleHealth(res: ServerResponse): void {
  json(res, getHealthStatus());
}

async function fetchSymphonyState(): Promise<any | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${config.symphony.statusUrl}/api/v1/state`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function handleSchedules(res: ServerResponse): void {
  json(res, getSchedules());
}

async function handleScheduleUpdate(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const updated = updateSchedule(id, body);
    if (!updated) {
      json(res, { error: "Schedule not found" }, 404);
      return;
    }
    json(res, updated);
  } catch (err: any) {
    json(res, { error: err.message }, 500);
  }
}

function handleScheduleDelete(res: ServerResponse, id: string): void {
  const removed = removeSchedule(id);
  if (!removed) {
    json(res, { error: "Schedule not found" }, 404);
    return;
  }
  json(res, { ok: true });
}

function handleArchives(res: ServerResponse): void {
  json(res, { dates: listLocalArchiveDates() });
}

function handleArchiveDate(res: ServerResponse, date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    json(res, { error: "Invalid date format" }, 400);
    return;
  }
  json(res, { entries: readLocalArchive(date) });
}

async function handleArchiveSummary(res: ServerResponse, date: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    json(res, { error: "Invalid date format" }, 400);
    return;
  }
  json(res, { content: await readMemoryFile(`conversations/summaries/${date}.md`) });
}

function handleJournals(res: ServerResponse): void {
  json(res, { dates: listLocalJournalDates() });
}

function handleJournalDate(res: ServerResponse, date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    json(res, { error: "Invalid date format" }, 400);
    return;
  }
  json(res, { content: readLocalJournal(date) });
}

function handleMemoryList(res: ServerResponse): void {
  json(res, { files: MEMORY_FILES });
}

async function handleMemoryRead(res: ServerResponse, filePath: string): Promise<void> {
  if (filePath.includes("..")) {
    json(res, { error: "Invalid path" }, 400);
    return;
  }
  const content = await readMemoryFile(filePath);
  if (content === null) {
    json(res, { error: "File not found" }, 404);
    return;
  }
  json(res, { content });
}

async function handleMemoryWrite(req: IncomingMessage, res: ServerResponse, filePath: string): Promise<void> {
  if (filePath.includes("..")) {
    json(res, { error: "Invalid path" }, 400);
    return;
  }
  try {
    const body = JSON.parse(await readBody(req));
    const content = body.content;
    const message = body.message || `Dashboard: update ${filePath}`;
    if (typeof content !== "string") {
      json(res, { error: "content must be a string" }, 400);
      return;
    }
    await writeMemoryFile(filePath, content, message);
    json(res, { ok: true });
  } catch (err: any) {
    json(res, { error: err.message }, 500);
  }
}

function handleLogs(res: ServerResponse): void {
  const outLines = tailFile(OUT_LOG, 150);
  const errLines = tailFile(ERR_LOG, 50).map((l) => `[ERR] ${l}`);
  json(res, { lines: [...outLines, ...errLines].slice(-200) });
}

function handleLogStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.write(`data: ${JSON.stringify({ lines: tailFile(OUT_LOG, 50) })}\n\n`);

  const sizes = new Map<string, number>();
  for (const logPath of [OUT_LOG, ERR_LOG]) {
    try {
      sizes.set(logPath, fs.statSync(logPath).size);
    } catch {
      sizes.set(logPath, 0);
    }
  }

  const watchers: fs.FSWatcher[] = [];
  for (const logPath of [OUT_LOG, ERR_LOG]) {
    try {
      const isErr = logPath === ERR_LOG;
      const watcher = fs.watch(logPath, () => {
        try {
          const currentSize = fs.statSync(logPath).size;
          const lastSize = sizes.get(logPath) || 0;
          if (currentSize <= lastSize) {
            sizes.set(logPath, currentSize);
            return;
          }

          const fd = fs.openSync(logPath, "r");
          const buf = Buffer.alloc(currentSize - lastSize);
          fs.readSync(fd, buf, 0, buf.length, lastSize);
          fs.closeSync(fd);
          sizes.set(logPath, currentSize);

          const newLines = buf.toString("utf-8").split("\n").filter(Boolean);
          const prefixed = isErr ? newLines.map((l) => `[ERR] ${l}`) : newLines;
          if (prefixed.length > 0) {
            res.write(`data: ${JSON.stringify({ lines: prefixed })}\n\n`);
          }
        } catch {
          // rotated
        }
      });
      watchers.push(watcher);
    } catch {
      // log file missing
    }
  }

  req.on("close", () => {
    watchers.forEach((w) => w.close());
  });
}

async function handleConversationHistory(res: ServerResponse): Promise<void> {
  json(res, { messages: await getHistory(config.telegram.allowedUserId) });
}

async function handleSkills(res: ServerResponse): Promise<void> {
  try {
    const index = await loadSkillIndex();
    const skills = await Promise.all(index.map(async (entry) => (await loadSkill(entry.id)) || entry));
    json(res, skills);
  } catch (err: any) {
    json(res, { error: err.message }, 500);
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, getHtml: () => string): Promise<void> {
  const url = new URL(req.url || "/", `http://localhost:${config.dashboard.port}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    });
    res.end();
    return;
  }

  if (pathname !== "/favicon.ico" && !isAuthorized(req, url)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  try {
    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getHtml());
      return;
    }

    if (req.method === "GET" && pathname === "/api/status") return await handleStatus(res);
    if (req.method === "GET" && pathname === "/api/health") return handleHealth(res);
    if (req.method === "GET" && pathname === "/api/symphony/state") return json(res, await fetchSymphonyState());
    if (req.method === "GET" && pathname === "/api/schedules") return handleSchedules(res);

    const scheduleIdMatch = pathname.match(/^\/api\/schedules\/([a-f0-9]+)$/);
    if (req.method === "PUT" && scheduleIdMatch) return await handleScheduleUpdate(req, res, scheduleIdMatch[1]);
    if (req.method === "DELETE" && scheduleIdMatch) return handleScheduleDelete(res, scheduleIdMatch[1]);

    if (req.method === "GET" && pathname === "/api/conversation") return await handleConversationHistory(res);
    if (req.method === "GET" && pathname === "/api/archives") return handleArchives(res);

    const archiveDateMatch = pathname.match(/^\/api\/archives\/(\d{4}-\d{2}-\d{2})$/);
    if (req.method === "GET" && archiveDateMatch) return handleArchiveDate(res, archiveDateMatch[1]);
    const archiveSummaryMatch = pathname.match(/^\/api\/archives\/(\d{4}-\d{2}-\d{2})\/summary$/);
    if (req.method === "GET" && archiveSummaryMatch) return await handleArchiveSummary(res, archiveSummaryMatch[1]);

    if (req.method === "GET" && pathname === "/api/journals") return handleJournals(res);
    const journalDateMatch = pathname.match(/^\/api\/journals\/(\d{4}-\d{2}-\d{2})$/);
    if (req.method === "GET" && journalDateMatch) return handleJournalDate(res, journalDateMatch[1]);

    if (req.method === "GET" && pathname === "/api/memory") return handleMemoryList(res);
    if (req.method === "GET" && pathname.startsWith("/api/memory/")) {
      return await handleMemoryRead(res, decodeURIComponent(pathname.slice("/api/memory/".length)));
    }
    if (req.method === "PUT" && pathname.startsWith("/api/memory/")) {
      return await handleMemoryWrite(req, res, decodeURIComponent(pathname.slice("/api/memory/".length)));
    }

    if (req.method === "GET" && pathname === "/api/skills") return await handleSkills(res);
    if (req.method === "GET" && pathname === "/api/logs") return handleLogs(res);
    if (req.method === "GET" && pathname === "/api/logs/stream") return handleLogStream(req, res);

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err: any) {
    console.error("[dashboard] Request error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

export function startDashboardServer(getHtml: () => string): void {
  if (server) return;

  const port = config.dashboard.port;
  server = createServer((req, res) => {
    handleRequest(req, res, getHtml).catch((err: any) => {
      console.error("[dashboard] Unhandled error:", err.message);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Internal server error");
      }
    });
  });

  server.listen(port, () => {
    const authMode = config.dashboard.token ? "token auth" : "localhost only";
    console.log("[dashboard] Dashboard running at http://localhost:%d (%s)", port, authMode);
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error("[dashboard] Port %d already in use — dashboard disabled", port);
      server = null;
    } else {
      console.error("[dashboard] Server error:", err.message);
    }
  });
}

export function stopDashboardServer(): void {
  if (server) {
    server.close();
    server = null;
    console.log("[dashboard] Dashboard stopped");
  }
}
