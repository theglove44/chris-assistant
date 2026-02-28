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
import { getSchedules, type Schedule } from "./scheduler.js";
import { listLocalArchiveDates, readLocalArchive } from "./conversation-archive.js";
import { listLocalJournalDates, readLocalJournal } from "./memory/journal.js";
import { readMemoryFile, writeMemoryFile } from "./memory/github.js";
import { getHistory } from "./conversation.js";
import { getBotProcess } from "./cli/pm2-helper.js";

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
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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
.badge-enabled { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge-enabled.on { background: rgba(74,222,128,0.15); color: var(--green); }
.badge-enabled.off { background: rgba(248,113,113,0.15); color: var(--red); }

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

/* Utility */
.loading { color: var(--text2); font-style: italic; }
.empty { color: var(--text2); font-size: 14px; padding: 20px 0; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
</style>
</head>
<body>
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
  </div>

  <!-- Status -->
  <div class="section active" id="sec-status">
    <div class="card">
      <h3>System</h3>
      <div class="stat-grid" id="status-stats"></div>
    </div>
    <div class="card">
      <h3>Health Checks</h3>
      <div id="health-checks"><span class="loading">Loading...</span></div>
    </div>
  </div>

  <!-- Schedules -->
  <div class="section" id="sec-schedules">
    <div class="card">
      <h3>Scheduled Tasks</h3>
      <div id="schedules-table"><span class="loading">Loading...</span></div>
    </div>
  </div>

  <!-- Conversations -->
  <div class="section" id="sec-conversations">
    <div class="card">
      <h3>Archive Dates</h3>
      <div id="archive-dates" class="date-list"><span class="loading">Loading...</span></div>
    </div>
    <div id="conversation-view"></div>
  </div>

  <!-- Memory -->
  <div class="section" id="sec-memory">
    <div class="card">
      <h3>Memory Files</h3>
      <div id="memory-files" class="file-list"><span class="loading">Loading...</span></div>
    </div>
    <div id="memory-editor"></div>
  </div>

  <!-- Logs -->
  <div class="section" id="sec-logs">
    <div class="log-controls">
      <label><input type="checkbox" id="log-autoscroll" checked> Auto-scroll</label>
      <label><input type="checkbox" id="log-live" checked> Live tail</label>
    </div>
    <div class="log-container" id="log-output"><span class="loading">Connecting...</span></div>
  </div>
</div>

<script>
const TOKEN = new URLSearchParams(location.search).get("token") || localStorage.getItem("dashboard_token") || "";
if (TOKEN) localStorage.setItem("dashboard_token", TOKEN);

function apiUrl(path) {
  return path + (TOKEN ? (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(TOKEN) : "");
}

async function api(path) {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
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

    document.getElementById("health-checks").innerHTML = health.length === 0
      ? '<span class="empty">No health checks yet</span>'
      : health.map(h => {
          const cls = h.checkedAt === 0 ? "unknown" : h.ok ? "ok" : "fail";
          const ago = h.checkedAt ? timeAgo(h.checkedAt) : "not yet";
          return '<div class="health-row"><span class="health-dot ' + cls + '"></span><span>' +
            esc(h.name) + '</span><span style="color:var(--text2);font-size:12px;margin-left:auto">' +
            ago + '</span>' + (h.detail ? '<div style="font-size:12px;color:var(--red);margin-left:18px">' + esc(h.detail) + '</div>' : '') + '</div>';
        }).join("");
  } catch (e) {
    document.getElementById("status-stats").innerHTML = '<span class="loading">Error: ' + esc(e.message) + '</span>';
  }
}

function stat(label, value) {
  return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="value">' + esc(String(value)) + '</div></div>';
}

// --- Schedules ---
async function loadSchedules() {
  try {
    const schedules = await api("/api/schedules");
    if (schedules.length === 0) {
      document.getElementById("schedules-table").innerHTML = '<span class="empty">No scheduled tasks</span>';
      return;
    }
    let html = '<table><thead><tr><th>Name</th><th>Schedule</th><th>Status</th><th>Last Run</th><th>Tools</th><th>Prompt</th></tr></thead><tbody>';
    for (const s of schedules) {
      const lastRun = s.lastRun ? timeAgo(s.lastRun) : "never";
      const status = s.enabled ? '<span class="badge-enabled on">enabled</span>' : '<span class="badge-enabled off">disabled</span>';
      const tools = s.allowedTools ? esc(s.allowedTools.join(", ")) : '<span style="color:var(--text2)">all</span>';
      const prompt = esc(s.prompt.length > 80 ? s.prompt.slice(0, 80) + "..." : s.prompt);
      html += '<tr><td><strong>' + esc(s.name) + '</strong></td><td class="mono">' + esc(s.schedule) + '</td><td>' + status + '</td><td>' + lastRun + '</td><td style="font-size:12px">' + tools + '</td><td style="font-size:12px;color:var(--text2)">' + prompt + '</td></tr>';
    }
    html += '</tbody></table>';
    document.getElementById("schedules-table").innerHTML = html;
  } catch (e) {
    document.getElementById("schedules-table").innerHTML = '<span class="loading">Error: ' + esc(e.message) + '</span>';
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
      el.innerHTML = '<span class="empty">No archives</span>';
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
  view.innerHTML = '<div class="card"><span class="loading">Loading...</span></div>';
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
      html += '<span class="empty">No messages</span>';
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
  el.innerHTML = '<div class="card"><span class="loading">Loading...</span></div>';
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
  status.textContent = "Saving...";
  status.style.color = "var(--text2)";

  try {
    const res = await fetch(apiUrl("/api/memory/" + encodeURIComponent(activeMemoryFile)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: textarea.value }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    status.textContent = "Saved!";
    status.style.color = "var(--green)";
  } catch (e) {
    status.textContent = "Error: " + e.message;
    status.style.color = "var(--red)";
  } finally {
    btn.disabled = false;
    setTimeout(() => { status.textContent = ""; }, 3000);
  }
}

// --- Logs ---
let logSource = null;
function startLogStream() {
  const el = document.getElementById("log-output");
  const liveCheckbox = document.getElementById("log-live");

  // Close existing stream
  if (logSource) { logSource.close(); logSource = null; }

  if (!liveCheckbox.checked) {
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

document.getElementById("log-live").addEventListener("change", () => {
  if (activeTab === "logs") startLogStream();
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

// --- Auto-refresh ---
let refreshInterval = null;
function startAutoRefresh() {
  refreshInterval = setInterval(() => {
    if (activeTab === "status") loadStatus();
    if (activeTab === "schedules") loadSchedules();
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
