/**
 * Web dashboard — built-in HTTP server for monitoring the bot.
 *
 * Serves a single-page dashboard with tabs for Status, Schedules,
 * Conversations, Memory, and Logs. All HTML/CSS/JS is inlined.
 * API endpoints return JSON for the frontend to render.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { config } from "./config.js";
import { getHealthStatus, getProviderName } from "./health.js";
import { getSchedules, updateSchedule, removeSchedule, type Schedule } from "./scheduler.js";
import { listLocalArchiveDates, readLocalArchive } from "./conversation-archive.js";
import { listLocalJournalDates, readLocalJournal } from "./memory/journal.js";
import { readMemoryFile, writeMemoryFile } from "./memory/github.js";
import { getHistory } from "./conversation.js";
import { getBotProcess } from "./cli/pm2-helper.js";
import { loadSkillIndex, loadSkill } from "./skills/loader.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOT_STARTED_AT = new Date().toISOString();

const PM2_LOG_DIR = path.join(os.homedir(), ".pm2", "logs");
const OUT_LOG = path.join(PM2_LOG_DIR, "chris-assistant-out.log");
const ERR_LOG = path.join(PM2_LOG_DIR, "chris-assistant-error.log");

const MEMORY_FILES = [
  "identity/SOUL.md",
  "identity/RULES.md",
  "identity/VOICE.md",
  "knowledge/about-chris.md",
  "knowledge/preferences.md",
  "knowledge/projects.md",
  "knowledge/people.md",
  "memory/decisions.md",
  "memory/learnings.md",
  "memory/SUMMARY.md",
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let server: Server | null = null;
let pm2Cache: { data: any; ts: number } | null = null;
const PM2_CACHE_TTL = 30_000; // 30s

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function isAuthorized(req: IncomingMessage, url: URL): boolean {
  const token = config.dashboard.token;

  if (token) {
    // Token auth: check header or query param
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${token}`) return true;
    if (url.searchParams.get("token") === token) return true;
    return false;
  }

  // No token configured: localhost only
  const remoteAddr = req.socket.remoteAddress || "";
  return remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// API Handlers
// ---------------------------------------------------------------------------

async function handleStatus(res: ServerResponse): Promise<void> {
  // pm2 stats with caching
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
  const content = await readMemoryFile(`conversations/summaries/${date}.md`);
  json(res, { content });
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
  // Validate the path is in the known list or at least doesn't traverse
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
  const outLines = tailFile(OUT_LOG, 150).map((l) => l);
  const errLines = tailFile(ERR_LOG, 50).map((l) => `[ERR] ${l}`);
  // Merge and return the last 200
  const all = [...outLines, ...errLines].slice(-200);
  json(res, { lines: all });
}

function handleLogStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // Send initial batch
  const initial = tailFile(OUT_LOG, 50);
  res.write(`data: ${JSON.stringify({ lines: initial })}\n\n`);

  // Track file sizes for incremental reads
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

          // Read only the new bytes
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
          // File may have been rotated
        }
      });
      watchers.push(watcher);
    } catch {
      // Log file doesn't exist yet
    }
  }

  req.on("close", () => {
    watchers.forEach((w) => w.close());
  });
}

async function handleConversationHistory(res: ServerResponse): Promise<void> {
  const history = await getHistory(config.telegram.allowedUserId);
  json(res, { messages: history });
}

async function handleSkills(res: ServerResponse): Promise<void> {
  try {
    const index = await loadSkillIndex();
    const skills = await Promise.all(
      index.map(async (entry) => {
        const full = await loadSkill(entry.id);
        return full || entry;
      }),
    );
    json(res, skills);
  } catch (err: any) {
    json(res, { error: err.message }, 500);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://localhost:${config.dashboard.port}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    });
    res.end();
    return;
  }

  // Auth check (skip for favicon)
  if (pathname !== "/favicon.ico" && !isAuthorized(req, url)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  try {
    // HTML shell
    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getHTML());
      return;
    }

    // API routes
    if (req.method === "GET" && pathname === "/api/status") return await handleStatus(res);
    if (req.method === "GET" && pathname === "/api/health") return handleHealth(res);
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
      const filePath = pathname.slice("/api/memory/".length);
      return await handleMemoryRead(res, decodeURIComponent(filePath));
    }
    if (req.method === "PUT" && pathname.startsWith("/api/memory/")) {
      const filePath = pathname.slice("/api/memory/".length);
      return await handleMemoryWrite(req, res, decodeURIComponent(filePath));
    }

    if (req.method === "GET" && pathname === "/api/skills") return await handleSkills(res);

    if (req.method === "GET" && pathname === "/api/logs") return handleLogs(res);
    if (req.method === "GET" && pathname === "/api/logs/stream") return handleLogStream(req, res);

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err: any) {
    console.error("[dashboard] Request error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

// ---------------------------------------------------------------------------
// HTML Template
// ---------------------------------------------------------------------------

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chris Assistant</title>
<style>
:root {
  --bg: #0f1117;
  --bg2: #1a1d27;
  --bg3: #242734;
  --border: #2e3144;
  --text: #e1e4ed;
  --text2: #8b90a0;
  --accent: #6c8aff;
  --green: #4ade80;
  --red: #f87171;
  --yellow: #fbbf24;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --mono: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; }
.container { max-width: 1200px; margin: 0 auto; padding: 16px; }
header { display: flex; align-items: center; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
header h1 { font-size: 20px; font-weight: 600; }
header .badge { font-size: 12px; background: var(--bg3); color: var(--text2); padding: 2px 8px; border-radius: 10px; }

/* Tabs */
.tabs { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; }
.tab { background: none; border: 1px solid transparent; color: var(--text2); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; font-family: var(--font); transition: all 0.15s; }
.tab:hover { background: var(--bg2); color: var(--text); }
.tab.active { background: var(--bg2); color: var(--accent); border-color: var(--border); }

/* Sections */
.section { display: none; }
.section.active { display: block; }

/* Cards */
.card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 12px; }
.card h3 { font-size: 14px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.stat { padding: 12px; background: var(--bg3); border-radius: 8px; }
.stat .label { font-size: 12px; color: var(--text2); margin-bottom: 4px; }
.stat .value { font-size: 18px; font-weight: 600; }

/* Health indicators */
.health-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.health-dot { width: 10px; height: 10px; border-radius: 50%; }
.health-dot.ok { background: var(--green); }
.health-dot.fail { background: var(--red); }
.health-dot.unknown { background: var(--text2); }

/* Tables */
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; padding: 8px 12px; color: var(--text2); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
tr:last-child td { border-bottom: none; }
.mono { font-family: var(--mono); font-size: 13px; }

/* Date list */
.date-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.date-btn { background: var(--bg3); border: 1px solid var(--border); color: var(--text2); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; font-family: var(--font); }
.date-btn:hover, .date-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }

/* Messages */
.msg { padding: 10px 14px; margin-bottom: 6px; border-radius: 8px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.msg.user { background: var(--bg3); border-left: 3px solid var(--accent); }
.msg.assistant { background: var(--bg2); border-left: 3px solid var(--green); }
.msg .meta { font-size: 11px; color: var(--text2); margin-bottom: 4px; }

/* Memory */
.file-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
.file-btn { background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 6px; cursor: pointer; font-family: var(--mono); font-size: 13px; text-align: left; }
.file-btn:hover, .file-btn.active { border-color: var(--accent); color: var(--accent); }
.editor { width: 100%; min-height: 400px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: var(--mono); font-size: 13px; padding: 12px; resize: vertical; line-height: 1.5; }
.btn { background: var(--accent); color: #fff; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-family: var(--font); }
.btn:hover { opacity: 0.9; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.save-status { font-size: 13px; color: var(--green); margin-left: 12px; }

/* Logs */
.log-container { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; height: 600px; overflow-y: auto; font-family: var(--mono); font-size: 12px; line-height: 1.6; }
.log-line { white-space: pre-wrap; word-break: break-all; }
.log-line.err { color: var(--red); }
.log-controls { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
.log-controls label { font-size: 13px; color: var(--text2); }

/* Schedule rows clickable */
tr.clickable { cursor: pointer; transition: background 0.15s; }
tr.clickable:hover { background: var(--bg3); }

/* Modal */
.modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); z-index: 100; }
.modal-card { position: fixed; top: 0; right: 0; height: 100vh; width: 480px; max-width: 90vw; background: var(--bg); border-left: 1px solid var(--border); padding: 24px; overflow-y: auto; transform: translateX(100%); transition: transform 0.3s ease; z-index: 101; }
.modal-overlay.open .modal-card { transform: translateX(0); }
.modal-card h2 { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 12px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.form-group input[type="text"], .form-group textarea, .form-group select {
  width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-family: var(--font); font-size: 14px; padding: 8px 12px;
}
.form-group textarea { font-family: var(--mono); font-size: 13px; min-height: 120px; resize: vertical; line-height: 1.5; }
.form-group select { appearance: none; cursor: pointer; }
.form-row { display: flex; gap: 12px; }
.form-row .form-group { flex: 1; }
.cron-preview { font-family: var(--mono); font-size: 13px; color: var(--accent); padding: 6px 0; min-height: 24px; }
.toggle-wrap { display: flex; align-items: center; gap: 10px; }
.toggle { position: relative; width: 44px; height: 24px; cursor: pointer; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle .slider { position: absolute; inset: 0; background: var(--bg3); border-radius: 12px; transition: background 0.2s; }
.toggle .slider::before { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; background: var(--text2); border-radius: 50%; transition: transform 0.2s, background 0.2s; }
.toggle input:checked + .slider { background: var(--accent); }
.toggle input:checked + .slider::before { transform: translateX(20px); background: #fff; }
.modal-actions { display: flex; gap: 8px; margin-top: 20px; }
.modal-actions .btn { flex: 1; text-align: center; }
.btn-danger { background: var(--red); }
.btn-cancel { background: var(--bg3); color: var(--text); }
.modal-status { font-size: 13px; margin-top: 8px; min-height: 20px; }

/* Utility */
.loading { color: var(--text2); font-style: italic; }
.empty { color: var(--text2); font-size: 14px; padding: 20px 0; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 20px; color: var(--text2); }
.empty-state-icon { font-size: 32px; margin-bottom: 12px; opacity: 0.6; }
.empty-state-heading { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
.empty-state-description { font-size: 13px; color: var(--text2); }
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
.skeleton { background: linear-gradient(90deg, var(--bg3) 25%, #2e3450 50%, var(--bg3) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 6px; }
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.skeleton-stat { height: 72px; }
.skeleton-row { height: 18px; margin-bottom: 10px; }
.skeleton-row.short { width: 60%; }
.skeleton-row.medium { width: 80%; }
.skeleton-pill { height: 14px; width: 120px; margin-bottom: 8px; }
.skeleton-msg { height: 48px; margin-bottom: 12px; border-left: 3px solid var(--bg3); padding-left: 12px; }
.toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 200; display: flex; flex-direction: column; gap: 8px; }
.toast { background: var(--bg2); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 8px; padding: 12px 16px; font-size: 13px; color: var(--text); max-width: 320px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transform: translateX(120%); transition: transform 0.3s ease, opacity 0.3s ease; opacity: 0; }
.toast.show { transform: translateX(0); opacity: 1; }
.toast.success { border-left-color: var(--green); }
.toast.error { border-left-color: var(--red); }
.toast.info { border-left-color: var(--accent); }
.progress-bar { position: fixed; top: 0; left: 0; height: 3px; width: 0%; background: var(--accent); z-index: 300; transition: width 0.3s ease; pointer-events: none; }
.progress-bar.active { transition: width 8s cubic-bezier(0.1, 0.5, 0.3, 1); width: 70%; }
.progress-bar.done { width: 100%; opacity: 0; transition: width 0.2s ease, opacity 0.3s ease 0.2s; }
[data-tooltip] { position: relative; }
[data-tooltip]::before { content: attr(data-tooltip); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); padding: 6px 10px; background: var(--bg3); color: var(--text); font-size: 12px; border-radius: 6px; white-space: pre-wrap; max-width: 320px; width: max-content; pointer-events: none; opacity: 0; transition: opacity 0.15s; z-index: 100; border: 1px solid var(--border); line-height: 1.4; }
[data-tooltip]::after { content: ""; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); border: 5px solid transparent; border-top-color: var(--bg3); pointer-events: none; opacity: 0; transition: opacity 0.15s; z-index: 100; }
[data-tooltip]:hover::before, [data-tooltip]:hover::after { opacity: 1; }
.alert { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-radius: 8px; font-size: 13px; line-height: 1.5; margin-bottom: 12px; }
.alert-error { background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.25); color: var(--red); }
.alert-warning { background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.25); color: var(--yellow); }
.alert-info { background: rgba(108, 138, 255, 0.1); border: 1px solid rgba(108, 138, 255, 0.25); color: var(--accent); }
.alert-icon { flex-shrink: 0; font-size: 16px; }
.alert-message { flex: 1; }
.segmented { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.segmented button { background: none; border: none; color: var(--text2); padding: 6px 16px; font-size: 13px; font-family: var(--font); cursor: pointer; transition: all 0.15s; }
.segmented button.active { background: var(--accent); color: #fff; }
.segmented button:not(.active):hover { background: var(--bg3); color: var(--text); }
.badge-pill { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
.badge-success { background: rgba(74, 222, 128, 0.15); color: var(--green); }
.badge-error { background: rgba(248, 113, 113, 0.15); color: var(--red); }
.badge-neutral { background: var(--bg3); color: var(--text2); }
.badge-accent { background: rgba(108, 138, 255, 0.15); color: var(--accent); }
.cal-color-0 { background: rgba(96, 165, 250, 0.25); border-left: 3px solid #60a5fa; color: #93bbfc; }
.cal-color-1 { background: rgba(74, 222, 128, 0.25); border-left: 3px solid #4ade80; color: #7ee8a8; }
.cal-color-2 { background: rgba(251, 191, 36, 0.25); border-left: 3px solid #fbbf24; color: #fcd267; }
.cal-color-3 { background: rgba(192, 132, 252, 0.25); border-left: 3px solid #c084fc; color: #d0a4fd; }
.cal-color-4 { background: rgba(251, 146, 60, 0.25); border-left: 3px solid #fb923c; color: #fcad6e; }
.cal-color-5 { background: rgba(34, 211, 238, 0.25); border-left: 3px solid #22d3ee; color: #5ee0f0; }
.cal-color-6 { background: rgba(248, 113, 113, 0.25); border-left: 3px solid #f87171; color: #fa9898; }
.cal-color-7 { background: rgba(196, 181, 253, 0.25); border-left: 3px solid #c4b5fd; color: #d4c9fe; }
.cal-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.cal-toolbar .cal-nav { display: flex; gap: 4px; }
.cal-toolbar .cal-title { font-size: 16px; font-weight: 600; color: var(--text); min-width: 200px; }
.cal-week { display: grid; grid-template-columns: 60px repeat(7, 1fr); gap: 1px; background: var(--border); border-radius: 8px; overflow: hidden; }
.cal-week-header { background: var(--bg2); padding: 8px 6px; text-align: center; font-size: 12px; font-weight: 600; color: var(--text2); }
.cal-week-header.today { color: var(--accent); }
.cal-time-label { background: var(--bg2); padding: 4px 6px; font-size: 11px; color: var(--text2); text-align: right; display: flex; align-items: flex-start; justify-content: flex-end; }
.cal-week-cell { background: var(--bg); padding: 4px; min-height: 48px; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.cal-event { padding: 2px 6px; border-radius: 4px; font-size: 11px; line-height: 1.4; cursor: default; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 18px; }
.cal-event.disabled { opacity: 0.45; }
.cal-month { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; background: var(--border); border-radius: 8px; overflow: hidden; }
.cal-month-header { background: var(--bg2); padding: 8px 6px; text-align: center; font-size: 12px; font-weight: 600; color: var(--text2); }
.cal-month-cell { background: var(--bg); padding: 6px; min-height: 80px; }
.cal-month-cell .day-num { font-size: 12px; color: var(--text2); margin-bottom: 4px; }
.cal-month-cell.today { border: 1px solid var(--accent); }
.cal-month-cell.outside { opacity: 0.35; }
.cal-month-event { padding: 1px 4px; border-radius: 3px; font-size: 10px; margin-bottom: 2px; cursor: default; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-dot-row { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 2px; }
.cal-dot { width: 8px; height: 8px; border-radius: 50%; }
.cal-legend { display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 0; }
.cal-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text2); }
.cal-legend-swatch { width: 12px; height: 12px; border-radius: 3px; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
</style>
</head>
<body>
<div class="progress-bar" id="progress-bar"></div>
<div class="container">
  <header>
    <h1>Chris Assistant</h1>
    <span class="badge" id="provider-badge">loading...</span>
  </header>

  <div class="tabs">
    <button class="tab active" data-tab="status">Status</button>
    <button class="tab" data-tab="schedules">Schedules</button>
    <button class="tab" data-tab="conversations">Conversations</button>
    <button class="tab" data-tab="memory">Memory</button>
    <button class="tab" data-tab="logs">Logs</button>
    <button class="tab" data-tab="calendar">Calendar</button>
    <button class="tab" data-tab="skills">Skills</button>
  </div>

  <!-- Status -->
  <div class="section active" id="sec-status">
    <div class="card">
      <h3>System</h3>
      <div class="stat-grid" id="status-stats"><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div></div>
    </div>
    <div class="card">
      <h3>Health Checks</h3>
      <div id="health-checks"><div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row short"></div><div class="skeleton skeleton-row medium"></div></div></div>
    </div>
  </div>

  <!-- Schedules -->
  <div class="section" id="sec-schedules">
    <div class="card">
      <h3>Scheduled Tasks</h3>
      <div id="schedules-table"><div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row medium"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row short"></div><div class="skeleton skeleton-row medium"></div></div></div>
    </div>
  </div>

  <!-- Conversations -->
  <div class="section" id="sec-conversations">
    <div class="card">
      <h3>Archive Dates</h3>
      <div id="archive-dates" class="date-list"><div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div></div></div>
    </div>
    <div id="conversation-view"></div>
  </div>

  <!-- Memory -->
  <div class="section" id="sec-memory">
    <div class="card">
      <h3>Memory Files</h3>
      <div id="memory-files" class="file-list"><div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div><div class="skeleton skeleton-pill"></div></div></div>
    </div>
    <div id="memory-editor"><div class="empty-state"><div class="empty-state-icon">\uD83D\uDDC2</div><div class="empty-state-heading">Select a file</div><div class="empty-state-description">Choose a memory file from the list to view or edit it</div></div></div>
  </div>

  <!-- Schedule Editor Modal (hidden by default) -->
  <div class="modal-overlay" id="schedule-modal" style="display:none" onclick="if(event.target===this)closeScheduleModal()">
    <div class="modal-card">
      <h2 id="modal-title">Edit Schedule</h2>
      <input type="hidden" id="sched-id">

      <div class="form-group">
        <label>Name</label>
        <input type="text" id="sched-name">
      </div>

      <div class="form-group">
        <label>Schedule Type</label>
        <select id="sched-type" onchange="onSchedTypeChange()">
          <option value="interval">Every N minutes</option>
          <option value="hourly">Every hour</option>
          <option value="daily">Daily at specific time(s)</option>
          <option value="weekdays">Weekdays at specific time(s)</option>
          <option value="custom">Custom cron</option>
        </select>
      </div>

      <div id="sched-interval-row" class="form-group" style="display:none">
        <label>Interval (minutes)</label>
        <input type="text" id="sched-interval" value="30" oninput="updateCronPreview()">
      </div>

      <div id="sched-times-row" class="form-group" style="display:none">
        <label>Time(s) — comma-separated, e.g. 8:00 AM, 2:30 PM</label>
        <input type="text" id="sched-times" placeholder="8:00 AM" oninput="updateCronPreview()">
      </div>

      <div id="sched-custom-row" class="form-group" style="display:none">
        <label>Cron Expression (min hour dom month dow)</label>
        <input type="text" id="sched-cron-input" placeholder="0 8 * * *" oninput="updateCronPreview()">
      </div>

      <div class="cron-preview" id="cron-preview"></div>

      <div class="form-group">
        <label>Enabled</label>
        <div class="toggle-wrap">
          <label class="toggle"><input type="checkbox" id="sched-enabled" checked><span class="slider"></span></label>
          <span id="sched-enabled-label">Enabled</span>
        </div>
      </div>

      <div class="form-group">
        <label>Prompt</label>
        <textarea id="sched-prompt"></textarea>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Allowed Tools (comma-separated, or leave blank for all)</label>
          <input type="text" id="sched-tools" placeholder="all">
        </div>
        <div class="form-group">
          <label>Discord Channel (optional)</label>
          <input type="text" id="sched-discord" placeholder="">
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-cancel" onclick="closeScheduleModal()">Cancel</button>
        <button class="btn btn-danger" onclick="deleteSchedule()">Delete</button>
        <button class="btn" id="sched-save-btn" onclick="saveSchedule()">Save</button>
      </div>
      <div class="modal-status" id="sched-status"></div>
    </div>
  </div>

  <!-- Logs -->
  <div class="section" id="sec-logs">
    <div class="log-controls">
      <label><input type="checkbox" id="log-autoscroll" checked> Auto-scroll</label>
      <div class="segmented" id="log-mode"><button class="active" data-mode="live">Live</button><button data-mode="snapshot">Snapshot</button></div>
    </div>
    <div class="log-container" id="log-output"><span class="loading">Connecting...</span></div>
  </div>

  <!-- Skills -->
  <div class="section" id="sec-skills">
    <div class="card">
      <h3>Installed Skills</h3>
      <div id="skills-list"><div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row medium"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row short"></div></div></div>
    </div>
  </div>

  <!-- Calendar -->
  <div class="section" id="sec-calendar">
    <div class="card">
      <div class="cal-toolbar">
        <div class="cal-nav">
          <button class="btn btn-cancel" id="cal-prev">\u25C0</button>
          <button class="btn btn-cancel" id="cal-today">Today</button>
          <button class="btn btn-cancel" id="cal-next">\u25B6</button>
        </div>
        <span class="cal-title" id="cal-title"></span>
        <div class="segmented" id="cal-view-toggle">
          <button class="active" data-view="week">Week</button>
          <button data-view="month">Month</button>
        </div>
      </div>
      <div id="cal-grid"><div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row medium"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row short"></div></div></div>
    </div>
    <div class="card">
      <h3>Legend</h3>
      <div class="cal-legend" id="cal-legend-items"></div>
    </div>
  </div>
</div>

<script>
const TOKEN = new URLSearchParams(location.search).get("token") || localStorage.getItem("dashboard_token") || "";
if (TOKEN) localStorage.setItem("dashboard_token", TOKEN);

function showToast(message, type) {
  var container = document.getElementById("toast-container");
  var toast = document.createElement("div");
  toast.className = "toast " + (type || "info");
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { toast.classList.add("show"); });
  });
  setTimeout(function() {
    toast.classList.remove("show");
    setTimeout(function() { toast.remove(); }, 300);
  }, 3000);
}

var progressCount = 0;
function startProgress() {
  progressCount++;
  var bar = document.getElementById("progress-bar");
  if (progressCount === 1) {
    bar.className = "progress-bar";
    bar.offsetWidth;
    bar.classList.add("active");
  }
}

function finishProgress() {
  progressCount--;
  if (progressCount <= 0) {
    progressCount = 0;
    var bar = document.getElementById("progress-bar");
    bar.className = "progress-bar done";
    setTimeout(function() { bar.className = "progress-bar"; }, 500);
  }
}

function apiUrl(path) {
  return path + (TOKEN ? (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(TOKEN) : "");
}

async function api(path) {
  startProgress();
  try {
    var res = await fetch(apiUrl(path));
    if (!res.ok) throw new Error(res.statusText);
    return res.json();
  } finally {
    finishProgress();
  }
}

// --- Tabs ---
const tabs = document.querySelectorAll(".tab");
const sections = document.querySelectorAll(".section");
let activeTab = "status";

tabs.forEach(t => t.addEventListener("click", () => {
  activeTab = t.dataset.tab;
  tabs.forEach(b => b.classList.toggle("active", b === t));
  sections.forEach(s => s.classList.toggle("active", s.id === "sec-" + activeTab));
  activateTab(activeTab);
}));

function activateTab(tab) {
  if (tab === "status") loadStatus();
  if (tab === "schedules") loadSchedules();
  if (tab === "conversations") loadArchiveDates();
  if (tab === "memory") loadMemoryFiles();
  if (tab === "logs") startLogStream();
  if (tab === "calendar") loadCalendar();
  if (tab === "skills") loadSkills();
}

// --- Status ---
async function loadStatus() {
  try {
    const [status, health] = await Promise.all([api("/api/status"), api("/api/health")]);

    document.getElementById("provider-badge").textContent = status.provider + " / " + status.model;

    const pm2 = status.pm2 || {};
    const mem = pm2.memory ? (pm2.memory / 1024 / 1024).toFixed(1) + " MB" : "N/A";

    document.getElementById("status-stats").innerHTML = [
      stat("Uptime", status.uptimeFormatted),
      stat("Model", status.model),
      stat("Provider", status.provider),
      stat("Image Model", status.imageModel),
      stat("PID", pm2.pid ?? "N/A"),
      stat("Memory", mem),
      stat("Restarts", pm2.restarts ?? "N/A"),
      stat("Started", new Date(status.startedAt).toLocaleString()),
    ].join("");

    var failedChecks = health.filter(function(h) { return h.checkedAt > 0 && !h.ok; });
    var alertHtml = "";
    if (failedChecks.length > 0) {
      var names = failedChecks.map(function(h) { return h.name; }).join(", ");
      alertHtml = '<div class="alert alert-error"><span class="alert-icon">\u26A0</span><div class="alert-message"><strong>' + esc(names) + '</strong> ' + (failedChecks.length === 1 ? 'has' : 'have') + ' a problem \u2014 hover for details</div></div>';
    }

    var healthDotsHtml = health.length === 0
      ? '<div class="empty-state"><div class="empty-state-icon">\u2713</div><div class="empty-state-heading">All clear</div><div class="empty-state-description">Health checks will appear here once the bot runs</div></div>'
      : health.map(h => {
          const cls = h.checkedAt === 0 ? "unknown" : h.ok ? "ok" : "fail";
          const ago = h.checkedAt ? timeAgo(h.checkedAt) : "not yet";
          var detailAttr = h.detail ? ' data-tooltip="' + esc(h.detail).replace(/"/g, '&quot;') + '"' : '';
          return '<div class="health-row"' + detailAttr + '><span class="health-dot ' + cls + '"></span><span>' +
            esc(h.name) + '</span><span style="color:var(--text2);font-size:12px;margin-left:auto">' +
            ago + '</span></div>';
        }).join("");
    document.getElementById("health-checks").innerHTML = alertHtml + healthDotsHtml;
  } catch (e) {
    document.getElementById("status-stats").innerHTML = '<span class="loading">Error: ' + esc(e.message) + '</span>';
  }
}

function stat(label, value) {
  return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="value">' + esc(String(value)) + '</div></div>';
}

// --- Schedules ---
let schedulesData = [];
async function loadSchedules() {
  try {
    schedulesData = await api("/api/schedules");
    if (schedulesData.length === 0) {
      document.getElementById("schedules-table").innerHTML = '<div class="empty-state"><div class="empty-state-icon">\u23F1</div><div class="empty-state-heading">No scheduled tasks</div><div class="empty-state-description">Tasks you create will appear here</div></div>';
      return;
    }
    let html = '<table><thead><tr><th>Name</th><th>Schedule</th><th>Status</th><th>Last Run</th><th>Tools</th><th>Prompt</th></tr></thead><tbody>';
    for (const s of schedulesData) {
      const lastRun = s.lastRun ? timeAgo(s.lastRun) : "never";
      const status = s.enabled ? '<span class="badge-pill badge-success">enabled</span>' : '<span class="badge-pill badge-error">disabled</span>';
      const tools = s.allowedTools ? '<span class="badge-pill badge-neutral">' + s.allowedTools.length + ' tools</span>' : '<span class="badge-pill badge-accent">all</span>';
      var promptText = esc(s.prompt.length > 80 ? s.prompt.slice(0, 80) + "..." : s.prompt);
      var promptTooltip = s.prompt.length > 80 ? ' data-tooltip="' + esc(s.prompt).replace(/"/g, '&quot;') + '"' : '';
      var cronDesc = cronToHuman(s.schedule);
      html += '<tr class="clickable" data-id="' + s.id + '"><td><strong>' + esc(s.name) + '</strong></td><td class="mono" data-tooltip="' + esc(cronDesc).replace(/"/g, '&quot;') + '">' + esc(s.schedule) + '</td><td>' + status + '</td><td>' + lastRun + '</td><td style="font-size:12px">' + tools + '</td><td style="font-size:12px;color:var(--text2)"' + promptTooltip + '>' + promptText + '</td></tr>';
    }
    html += '</tbody></table>';
    document.getElementById("schedules-table").innerHTML = html;
    document.querySelectorAll("tr.clickable").forEach(function(row) {
      row.addEventListener("click", function() { openScheduleModal(row.dataset.id); });
    });
  } catch (e) {
    document.getElementById("schedules-table").innerHTML = '<span class="loading">Error: ' + esc(e.message) + '</span>';
  }
}

// --- Cron conversion ---
function cronToHuman(expr) {
  const f = expr.trim().split(/\\s+/);
  if (f.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = f;

  // */N * * * *
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Every " + min.slice(2) + " minutes";
  }
  // 0 * * * *
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Every hour";
  }
  // min hour(s) * * dow
  if (dom === "*" && mon === "*") {
    const hours = hour.split(",");
    const times = hours.map(function(h) { return fmtTime(parseInt(h,10), parseInt(min,10)); }).join(", ");
    if (dow === "*") return "Daily at " + times;
    if (dow === "1-5") return "Weekdays at " + times;
    return times + " (dow: " + dow + ")";
  }
  return expr;
}

function fmtTime(h, m) {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return h12 + ":" + String(m).padStart(2, "0") + " " + ampm;
}

function parseTimes(str) {
  // Parse "8:00 AM, 2:30 PM" into [{h:8,m:0},{h:14,m:30}]
  const results = [];
  const parts = str.split(",");
  for (const p of parts) {
    const match = p.trim().match(/^(\\d{1,2}):(\\d{2})\\s*(AM|PM)?$/i);
    if (!match) continue;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const ampm = (match[3] || "").toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    results.push({ h, m });
  }
  return results;
}

function buildCron() {
  const type = document.getElementById("sched-type").value;
  if (type === "custom") return document.getElementById("sched-cron-input").value.trim();
  if (type === "interval") {
    const n = parseInt(document.getElementById("sched-interval").value, 10);
    if (!n || n <= 0) return "*/5 * * * *";
    return "*/" + n + " * * * *";
  }
  if (type === "hourly") return "0 * * * *";

  // daily or weekdays
  const times = parseTimes(document.getElementById("sched-times").value);
  if (times.length === 0) return "0 8 * * *";
  const dow = type === "weekdays" ? "1-5" : "*";
  // If all times share the same minute
  const mins = [...new Set(times.map(t => t.m))];
  const hours = times.map(t => t.h).join(",");
  const minute = mins.length === 1 ? String(mins[0]) : "0";
  return minute + " " + hours + " * * " + dow;
}

function updateCronPreview() {
  const cron = buildCron();
  document.getElementById("cron-preview").textContent = "Cron: " + cron + "  —  " + cronToHuman(cron);
}

function onSchedTypeChange() {
  const type = document.getElementById("sched-type").value;
  document.getElementById("sched-interval-row").style.display = type === "interval" ? "block" : "none";
  document.getElementById("sched-times-row").style.display = (type === "daily" || type === "weekdays") ? "block" : "none";
  document.getElementById("sched-custom-row").style.display = type === "custom" ? "block" : "none";
  updateCronPreview();
}

function cronToType(expr) {
  const f = expr.trim().split(/\\s+/);
  if (f.length !== 5) return { type: "custom" };
  const [min, hour, dom, mon, dow] = f;
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { type: "interval", interval: min.slice(2) };
  }
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { type: "hourly" };
  }
  if (dom === "*" && mon === "*" && (dow === "*" || dow === "1-5")) {
    const hours = hour.split(",").map(Number);
    const m = parseInt(min, 10);
    const timesStr = hours.map(function(h) { return fmtTime(h, m); }).join(", ");
    return { type: dow === "1-5" ? "weekdays" : "daily", times: timesStr };
  }
  return { type: "custom" };
}

// --- Schedule modal ---
var drawerCloseTimer = null;
function openScheduleModal(id) {
  const s = schedulesData.find(function(x) { return x.id === id; });
  if (!s) return;

  if (drawerCloseTimer) { clearTimeout(drawerCloseTimer); drawerCloseTimer = null; }

  document.getElementById("sched-id").value = s.id;
  document.getElementById("modal-title").textContent = "Edit: " + s.name;
  document.getElementById("sched-name").value = s.name;
  document.getElementById("sched-enabled").checked = s.enabled;
  document.getElementById("sched-enabled-label").textContent = s.enabled ? "Enabled" : "Disabled";
  document.getElementById("sched-prompt").value = s.prompt;
  document.getElementById("sched-tools").value = s.allowedTools ? s.allowedTools.join(", ") : "";
  document.getElementById("sched-discord").value = s.discordChannel || "";
  document.getElementById("sched-status").textContent = "";

  // Parse cron into UI type
  const parsed = cronToType(s.schedule);
  document.getElementById("sched-type").value = parsed.type;
  if (parsed.type === "interval") {
    document.getElementById("sched-interval").value = parsed.interval;
  } else if (parsed.type === "daily" || parsed.type === "weekdays") {
    document.getElementById("sched-times").value = parsed.times;
  } else if (parsed.type === "custom") {
    document.getElementById("sched-cron-input").value = s.schedule;
  }

  onSchedTypeChange();
  var overlay = document.getElementById("schedule-modal");
  overlay.style.display = "block";
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { overlay.classList.add("open"); });
  });
}

function closeScheduleModal() {
  var overlay = document.getElementById("schedule-modal");
  overlay.classList.remove("open");
  drawerCloseTimer = setTimeout(function() { overlay.style.display = "none"; drawerCloseTimer = null; }, 300);
}

document.getElementById("sched-enabled").addEventListener("change", function() {
  document.getElementById("sched-enabled-label").textContent = this.checked ? "Enabled" : "Disabled";
});

async function saveSchedule() {
  const id = document.getElementById("sched-id").value;
  const statusEl = document.getElementById("sched-status");
  const btn = document.getElementById("sched-save-btn");

  const toolsRaw = document.getElementById("sched-tools").value.trim();
  const allowedTools = toolsRaw && toolsRaw.toLowerCase() !== "all"
    ? toolsRaw.split(",").map(function(t) { return t.trim(); }).filter(Boolean)
    : [];

  const updates = {
    name: document.getElementById("sched-name").value.trim(),
    schedule: buildCron(),
    enabled: document.getElementById("sched-enabled").checked,
    prompt: document.getElementById("sched-prompt").value,
    allowedTools: allowedTools,
    discordChannel: document.getElementById("sched-discord").value.trim(),
  };

  btn.disabled = true;
  showToast("Saving...", "info");
  startProgress();

  try {
    const res = await fetch(apiUrl("/api/schedules/" + id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    showToast("Schedule saved", "success");
    setTimeout(function() { closeScheduleModal(); loadSchedules(); }, 800);
  } catch (e) {
    showToast("Error: " + e.message, "error");
  } finally {
    btn.disabled = false;
    finishProgress();
  }
}

async function deleteSchedule() {
  const id = document.getElementById("sched-id").value;
  const name = document.getElementById("sched-name").value;
  if (!confirm("Delete schedule: " + name + "? This cannot be undone.")) return;

  showToast("Deleting...", "info");
  startProgress();

  try {
    const res = await fetch(apiUrl("/api/schedules/" + id), {
      method: "DELETE",
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    showToast("Schedule deleted", "success");
    setTimeout(function() { closeScheduleModal(); loadSchedules(); }, 500);
  } catch (e) {
    showToast("Error: " + e.message, "error");
  } finally {
    finishProgress();
  }
}

// --- Conversations ---
let archiveDates = [];
async function loadArchiveDates() {
  try {
    const data = await api("/api/archives");
    archiveDates = data.dates.reverse(); // newest first
    const el = document.getElementById("archive-dates");
    if (archiveDates.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDCAC</div><div class="empty-state-heading">No conversation archives</div><div class="empty-state-description">Archives are created automatically each day</div></div>';
      return;
    }
    el.innerHTML = archiveDates.map(d =>
      '<button class="date-btn" data-date="' + d + '">' + d + '</button>'
    ).join("");
    el.querySelectorAll(".date-btn").forEach(b => b.addEventListener("click", () => {
      el.querySelectorAll(".date-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      loadConversation(b.dataset.date);
    }));
  } catch (e) {
    document.getElementById("archive-dates").innerHTML = '<span class="loading">Error: ' + esc(e.message) + '</span>';
  }
}

async function loadConversation(date) {
  const view = document.getElementById("conversation-view");
  view.innerHTML = '<div class="card"><div><div class="skeleton skeleton-msg"></div><div class="skeleton skeleton-msg"></div><div class="skeleton skeleton-msg"></div><div class="skeleton skeleton-msg"></div></div></div>';
  try {
    const [archive, summary] = await Promise.all([
      api("/api/archives/" + date),
      api("/api/archives/" + date + "/summary").catch(() => ({ content: null })),
    ]);

    let html = "";
    if (summary.content) {
      html += '<div class="card"><h3>Daily Summary</h3><div class="msg assistant" style="border-left-color:var(--yellow)">' + esc(summary.content) + '</div></div>';
    }

    html += '<div class="card"><h3>Messages (' + archive.entries.length + ')</h3>';
    if (archive.entries.length === 0) {
      html += '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDCAC</div><div class="empty-state-heading">No messages</div><div class="empty-state-description">Select a date to view conversations</div></div>';
    } else {
      for (const e of archive.entries) {
        const time = new Date(e.ts).toLocaleTimeString();
        html += '<div class="msg ' + e.role + '"><div class="meta">' + e.role + ' &middot; ' + time + '</div>' + esc(e.content.slice(0, 2000)) + (e.content.length > 2000 ? "..." : "") + '</div>';
      }
    }
    html += '</div>';
    view.innerHTML = html;
  } catch (e) {
    view.innerHTML = '<div class="card"><span class="loading">Error: ' + esc(e.message) + '</span></div>';
  }
}

// --- Memory ---
let activeMemoryFile = null;
async function loadMemoryFiles() {
  try {
    const data = await api("/api/memory");
    const el = document.getElementById("memory-files");
    el.innerHTML = data.files.map(f =>
      '<button class="file-btn" data-file="' + esc(f) + '">' + esc(f) + '</button>'
    ).join("");
    el.querySelectorAll(".file-btn").forEach(b => b.addEventListener("click", () => {
      el.querySelectorAll(".file-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      loadMemoryFile(b.dataset.file);
    }));
  } catch (e) {
    document.getElementById("memory-files").innerHTML = '<span class="loading">Error: ' + esc(e.message) + '</span>';
  }
}

async function loadMemoryFile(filePath) {
  activeMemoryFile = filePath;
  const el = document.getElementById("memory-editor");
  el.innerHTML = '<div class="card"><div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row medium"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row short"></div><div class="skeleton skeleton-row medium"></div><div class="skeleton skeleton-row"></div></div></div>';
  try {
    const data = await api("/api/memory/" + encodeURIComponent(filePath));
    el.innerHTML = '<div class="card"><div class="flex-between"><h3>' + esc(filePath) + '</h3><div><button class="btn" id="save-btn" onclick="saveMemory()">Save</button><span class="save-status" id="save-status"></span></div></div><textarea class="editor" id="memory-textarea">' + esc(data.content) + '</textarea></div>';
  } catch (e) {
    el.innerHTML = '<div class="card"><span class="loading">Error: ' + esc(e.message) + '</span></div>';
  }
}

async function saveMemory() {
  const btn = document.getElementById("save-btn");
  const status = document.getElementById("save-status");
  const textarea = document.getElementById("memory-textarea");
  if (!activeMemoryFile || !textarea) return;

  btn.disabled = true;
  showToast("Saving...", "info");
  startProgress();

  try {
    const res = await fetch(apiUrl("/api/memory/" + encodeURIComponent(activeMemoryFile)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: textarea.value }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    showToast("Memory file saved", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  } finally {
    btn.disabled = false;
    finishProgress();
  }
}

// --- Skills ---
async function loadSkills() {
  try {
    var skills = await api("/api/skills");
    var el = document.getElementById("skills-list");
    if (skills.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\u26A1</div><div class="empty-state-heading">No skills installed</div><div class="empty-state-description">Skills can be created via the manage_skills tool</div></div>';
      return;
    }
    var html = '<table><thead><tr><th>Name</th><th>Description</th><th>Status</th><th>Version</th><th>Triggers</th><th>Tools</th><th>Updated</th></tr></thead><tbody>';
    for (var i = 0; i < skills.length; i++) {
      var s = skills[i];
      var status = s.enabled ? '<span class="badge-pill badge-success">enabled</span>' : '<span class="badge-pill badge-neutral">disabled</span>';
      var triggers = s.triggers && s.triggers.length > 0 ? esc(s.triggers.join(", ")) : '<span style="color:var(--text2)">none</span>';
      var tools = s.tools && s.tools.length > 0 ? '<span class="badge-pill badge-neutral">' + s.tools.length + ' tools</span>' : '<span class="badge-pill badge-accent">all</span>';
      var updated = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "\u2014";
      html += '<tr><td><strong>' + esc(s.name) + '</strong></td><td style="font-size:13px;color:var(--text2)">' + esc(s.description || "") + '</td><td>' + status + '</td><td class="mono">' + esc(String(s.version || 1)) + '</td><td style="font-size:12px">' + triggers + '</td><td style="font-size:12px">' + tools + '</td><td style="font-size:12px;color:var(--text2)">' + esc(updated) + '</td></tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  } catch (e) {
    document.getElementById("skills-list").innerHTML = '<span class="loading">Error: ' + esc(e.message) + '</span>';
  }
}

// --- Logs ---
let logSource = null;
function getLogMode() {
  var active = document.querySelector("#log-mode button.active");
  return active ? active.dataset.mode : "live";
}

function startLogStream() {
  const el = document.getElementById("log-output");

  // Close existing stream
  if (logSource) { logSource.close(); logSource = null; }

  if (getLogMode() !== "live") {
    // Snapshot mode
    loadLogSnapshot();
    return;
  }

  el.innerHTML = "";
  logSource = new EventSource(apiUrl("/api/logs/stream"));

  logSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    appendLogLines(data.lines);
  };

  logSource.onerror = () => {
    appendLogLines(["[dashboard] SSE connection lost, retrying..."]);
  };
}

async function loadLogSnapshot() {
  const el = document.getElementById("log-output");
  try {
    const data = await api("/api/logs");
    el.innerHTML = "";
    appendLogLines(data.lines);
  } catch (e) {
    el.innerHTML = '<span class="loading">Error: ' + esc(e.message) + '</span>';
  }
}

function appendLogLines(lines) {
  const el = document.getElementById("log-output");
  const autoScroll = document.getElementById("log-autoscroll").checked;

  for (const line of lines) {
    const div = document.createElement("div");
    div.className = "log-line" + (line.startsWith("[ERR]") ? " err" : "");
    div.textContent = line;
    el.appendChild(div);
  }

  // Keep at most 1000 lines
  while (el.children.length > 1000) el.removeChild(el.firstChild);

  if (autoScroll) el.scrollTop = el.scrollHeight;
}

document.querySelectorAll("#log-mode button").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll("#log-mode button").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    if (activeTab === "logs") startLogStream();
  });
});

// --- Utilities ---
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return Math.floor(diff / 86400000) + "d ago";
}

// --- Calendar ---
var calView = "week";
var calDate = new Date();
var calSchedules = [];

function cronFieldMatches(field, value, isDow) {
  if (field.includes(",")) {
    return field.split(",").some(function(p) { return cronFieldMatches(p.trim(), value, isDow); });
  }
  if (field.startsWith("*/")) {
    var step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && value % step === 0;
  }
  if (field === "*") return true;
  if (field.includes("-")) {
    var parts = field.split("-");
    var lo = parseInt(parts[0], 10);
    var hi = parseInt(parts[1], 10);
    if (isNaN(lo) || isNaN(hi)) return false;
    if (isDow) { lo = lo === 7 ? 0 : lo; hi = hi === 7 ? 0 : hi; }
    return lo <= hi ? (value >= lo && value <= hi) : (value >= lo || value <= hi);
  }
  var num = parseInt(field, 10);
  if (isNaN(num)) return false;
  if (isDow && num === 7) return value === 0;
  return value === num;
}

function getOccurrences(cronStr, start, end) {
  var fields = cronStr.trim().split(" ");
  if (fields.length !== 5) return [];
  var results = [];
  var cur = new Date(start);
  cur.setSeconds(0, 0);
  var endTs = end.getTime();
  while (cur.getTime() <= endTs) {
    var m = cur.getMinutes(), h = cur.getHours(), dom = cur.getDate(), mon = cur.getMonth() + 1, dow = cur.getDay();
    if (cronFieldMatches(fields[0], m, false) && cronFieldMatches(fields[1], h, false) && cronFieldMatches(fields[2], dom, false) && cronFieldMatches(fields[3], mon, false) && cronFieldMatches(fields[4], dow, true)) {
      results.push(new Date(cur));
    }
    cur = new Date(cur.getTime() + 60000);
  }
  return results;
}

function groupByDay(occurrences) {
  var groups = {};
  occurrences.forEach(function(d) {
    var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  return groups;
}

function getWeekStart(d) {
  var date = new Date(d);
  var day = date.getDay();
  var diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function todayStr() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function dateKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

var CAL_COLORS = ["#60a5fa", "#4ade80", "#fbbf24", "#c084fc", "#fb923c", "#22d3ee", "#f87171", "#c4b5fd"];

function renderWeekView() {
  var grid = document.getElementById("cal-grid");
  var ws = getWeekStart(calDate);
  var we = new Date(ws);
  we.setDate(we.getDate() + 6);
  we.setHours(23, 59, 59, 999);
  var today = todayStr();
  var dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  var schedData = calSchedules.map(function(s, i) {
    return { sched: s, color: i % 8, occs: getOccurrences(s.schedule, ws, we) };
  });

  var hoursWithEvents = {};
  schedData.forEach(function(sd) {
    sd.occs.forEach(function(o) { hoursWithEvents[o.getHours()] = true; });
  });
  var hours = [];
  for (var h = 6; h <= 22; h++) hours.push(h);
  Object.keys(hoursWithEvents).forEach(function(hk) {
    var hn = parseInt(hk, 10);
    if (hours.indexOf(hn) === -1) hours.push(hn);
  });
  hours.sort(function(a, b) { return a - b; });

  var html = '<div class="cal-week">';
  html += '<div class="cal-week-header"></div>';
  for (var d = 0; d < 7; d++) {
    var dayDate = new Date(ws);
    dayDate.setDate(dayDate.getDate() + d);
    var dayK = dateKey(dayDate);
    var isToday = dayK === today;
    html += '<div class="cal-week-header' + (isToday ? " today" : "") + '">' + dayNames[d] + " " + dayDate.getDate() + '</div>';
  }

  hours.forEach(function(hr) {
    html += '<div class="cal-time-label">' + fmtTime(hr, 0) + '</div>';
    for (var d = 0; d < 7; d++) {
      html += '<div class="cal-week-cell">';
      var dayDate = new Date(ws);
      dayDate.setDate(dayDate.getDate() + d);
      schedData.forEach(function(sd) {
        sd.occs.forEach(function(o) {
          if (o.getHours() === hr && o.getDate() === dayDate.getDate() && o.getMonth() === dayDate.getMonth()) {
            var label = esc(sd.sched.name) + " " + fmtTime(o.getHours(), o.getMinutes());
            var disabledCls = sd.sched.enabled ? "" : " disabled";
            html += '<div class="cal-event cal-color-' + sd.color + disabledCls + '" data-tooltip="' + label.replace(/"/g, "&quot;") + '">' + esc(sd.sched.name) + '</div>';
          }
        });
      });
      html += '</div>';
    }
  });
  html += '</div>';

  if (schedData.length === 0) {
    html = '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDCC5</div><div class="empty-state-heading">No schedules</div><div class="empty-state-description">Create scheduled tasks to see them here</div></div>';
  }
  grid.innerHTML = html;
}

function renderMonthView() {
  var grid = document.getElementById("cal-grid");
  var year = calDate.getFullYear();
  var month = calDate.getMonth();
  var firstDay = new Date(year, month, 1);
  var lastDay = new Date(year, month + 1, 0);
  var today = todayStr();
  var dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Get start of calendar grid (Monday before or on first day)
  var startOffset = firstDay.getDay() === 0 ? -6 : 1 - firstDay.getDay();
  var gridStart = new Date(year, month, 1 + startOffset);
  gridStart.setHours(0, 0, 0, 0);

  // Get end of calendar grid (fill to complete week)
  var totalDays = lastDay.getDate() - startOffset;
  var gridWeeks = Math.ceil(totalDays / 7);
  var gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + gridWeeks * 7 - 1);
  gridEnd.setHours(23, 59, 59, 999);

  var schedData = calSchedules.map(function(s, i) {
    return { sched: s, color: i % 8, occs: getOccurrences(s.schedule, gridStart, gridEnd), byDay: {} };
  });

  // Group occurrences by day for each schedule
  schedData.forEach(function(sd) {
    sd.byDay = groupByDay(sd.occs);
  });

  var html = '<div class="cal-month">';
  dayNames.forEach(function(dn) {
    html += '<div class="cal-month-header">' + dn + '</div>';
  });

  var cur = new Date(gridStart);
  for (var i = 0; i < gridWeeks * 7; i++) {
    var dk = dateKey(cur);
    var isOutside = cur.getMonth() !== month;
    var isToday = dk === today;
    var cls = "cal-month-cell" + (isOutside ? " outside" : "") + (isToday ? " today" : "");
    html += '<div class="' + cls + '">';
    html += '<div class="day-num">' + cur.getDate() + '</div>';

    // Collect schedules that fire on this day
    var daySchedules = [];
    schedData.forEach(function(sd) {
      if (sd.byDay[dk] && sd.byDay[dk].length > 0) {
        daySchedules.push(sd);
      }
    });

    if (daySchedules.length <= 4) {
      daySchedules.forEach(function(sd) {
        var disabledCls = sd.sched.enabled ? "" : " disabled";
        var count = sd.byDay[dk].length;
        var times = sd.byDay[dk].map(function(o) { return fmtTime(o.getHours(), o.getMinutes()); }).join(", ");
        var tip = esc(sd.sched.name) + " (" + times + ")";
        html += '<div class="cal-month-event cal-color-' + sd.color + disabledCls + '" data-tooltip="' + tip.replace(/"/g, "&quot;") + '">' + esc(sd.sched.name) + (count > 1 ? " \u00D7" + count : "") + '</div>';
      });
    } else {
      html += '<div class="cal-dot-row">';
      daySchedules.forEach(function(sd) {
        var times = sd.byDay[dk].map(function(o) { return fmtTime(o.getHours(), o.getMinutes()); }).join(", ");
        var tip = esc(sd.sched.name) + " (" + times + ")";
        html += '<div class="cal-dot" style="background:' + CAL_COLORS[sd.color] + '" data-tooltip="' + tip.replace(/"/g, "&quot;") + '"></div>';
      });
      html += '</div>';
    }

    html += '</div>';
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 1);
  }
  html += '</div>';

  if (calSchedules.length === 0) {
    html = '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDCC5</div><div class="empty-state-heading">No schedules</div><div class="empty-state-description">Create scheduled tasks to see them here</div></div>';
  }
  grid.innerHTML = html;
}

function updateCalTitle() {
  var el = document.getElementById("cal-title");
  if (calView === "week") {
    var ws = getWeekStart(calDate);
    var we = new Date(ws);
    we.setDate(we.getDate() + 6);
    var opts = { month: "short", day: "numeric" };
    el.textContent = ws.toLocaleDateString(undefined, opts) + " \u2013 " + we.toLocaleDateString(undefined, opts) + ", " + ws.getFullYear();
  } else {
    el.textContent = calDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
}

function renderCalendarLegend() {
  var el = document.getElementById("cal-legend-items");
  if (calSchedules.length === 0) { el.innerHTML = ""; return; }
  var html = "";
  calSchedules.forEach(function(s, i) {
    html += '<div class="cal-legend-item"><div class="cal-legend-swatch" style="background:' + CAL_COLORS[i % 8] + '"></div>' + esc(s.name) + '</div>';
  });
  el.innerHTML = html;
}

function renderCalendar() {
  if (calView === "week") renderWeekView();
  else renderMonthView();
  updateCalTitle();
  renderCalendarLegend();
}

async function loadCalendar() {
  try {
    calSchedules = await api("/api/schedules");
    renderCalendar();
  } catch (e) {
    document.getElementById("cal-grid").innerHTML = '<div class="empty-state"><div class="empty-state-icon">\u26A0</div><div class="empty-state-heading">Failed to load</div><div class="empty-state-description">' + esc(e.message) + '</div></div>';
  }
}

document.getElementById("cal-prev").addEventListener("click", function() {
  if (calView === "week") { calDate.setDate(calDate.getDate() - 7); }
  else { calDate.setMonth(calDate.getMonth() - 1); }
  renderCalendar();
});
document.getElementById("cal-next").addEventListener("click", function() {
  if (calView === "week") { calDate.setDate(calDate.getDate() + 7); }
  else { calDate.setMonth(calDate.getMonth() + 1); }
  renderCalendar();
});
document.getElementById("cal-today").addEventListener("click", function() {
  calDate = new Date();
  renderCalendar();
});
document.querySelectorAll("#cal-view-toggle button").forEach(function(btn) {
  btn.addEventListener("click", function() {
    calView = btn.dataset.view;
    document.querySelectorAll("#cal-view-toggle button").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    renderCalendar();
  });
});

// --- Auto-refresh ---
let refreshInterval = null;
function startAutoRefresh() {
  refreshInterval = setInterval(() => {
    if (activeTab === "status") loadStatus();
    if (activeTab === "schedules") loadSchedules();
    if (activeTab === "calendar") loadCalendar();
  }, 30000);
}

// --- Init ---
loadStatus();
startAutoRefresh();

// Clean up on tab close
window.addEventListener("beforeunload", () => {
  if (logSource) logSource.close();
  if (refreshInterval) clearInterval(refreshInterval);
});
<\/script>
<div class="toast-container" id="toast-container"></div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startDashboard(): void {
  if (server) return;

  const port = config.dashboard.port;
  server = createServer((req, res) => {
    handleRequest(req, res).catch((err: any) => {
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

export function stopDashboard(): void {
  if (server) {
    server.close();
    server = null;
    console.log("[dashboard] Dashboard stopped");
  }
}
