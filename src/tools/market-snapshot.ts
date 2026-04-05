import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { registerTool } from "./registry.js";

const execFileAsync = promisify(execFile);

// SSH constants (same as ssh.ts)
const SSH_BIN = "/usr/bin/ssh";
const SSH_OPTS = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=10",
  "-o", "StrictHostKeyChecking=accept-new",
];

// Mac Mini IP
const MAC_MINI_HOST = "100.99.188.80";
const TASTY_COACH_CMD = "cd ~/Projects/tasty-coach && source venv/bin/activate && python main.py --snapshot --json";

const MAX_OUTPUT = 50_000;

function truncate(s: string): string {
  if (s.length > MAX_OUTPUT) {
    return s.slice(0, MAX_OUTPUT) + "\n\n[... truncated ...]";
  }
  return s;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotItem {
  symbol: string;
  last: number;
  net_change: number;
  percent_change: number;
  prev_close: number;
  description: string;
  iv_rank: number | null;
  iv_percentile: number | null;
  // Derived
  direction: "up" | "down" | "flat";
}

// ---------------------------------------------------------------------------
// Parse JSON snapshot output
// ---------------------------------------------------------------------------

function parseSnapshotJson(raw: string): SnapshotItem[] {
  // Find the JSON array in the output (may have preamble text)
  const jsonStart = raw.indexOf("[");
  const jsonEnd = raw.lastIndexOf("]");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("No JSON array found in snapshot output");
  }

  const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
  const data = JSON.parse(jsonStr) as Array<Record<string, unknown>>;

  return data.map((d) => {
    const pct = Number(d.percent_change ?? 0);
    let direction: "up" | "down" | "flat" = "flat";
    if (pct > 0.05) direction = "up";
    else if (pct < -0.05) direction = "down";

    return {
      symbol: String(d.symbol ?? ""),
      last: Number(d.last ?? 0),
      net_change: Number(d.net_change ?? 0),
      percent_change: pct,
      prev_close: Number(d.prev_close ?? 0),
      description: String(d.description ?? ""),
      iv_rank: d.iv_rank != null ? Number(d.iv_rank) : null,
      iv_percentile: d.iv_percentile != null ? Number(d.iv_percentile) : null,
      direction,
    };
  });
}

// ---------------------------------------------------------------------------
// Fetch economic calendar (US events for tomorrow) from ForexFactory
// ---------------------------------------------------------------------------

interface FFEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

async function fetchFFCalendar(url: string): Promise<FFEvent[]> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!resp.ok) return [];
    return await resp.json() as FFEvent[];
  } catch {
    return [];
  }
}

async function fetchEconomicEvents(): Promise<string[]> {
  try {
    // ForexFactory public JSON feed — no API key required
    const [thisWeek, nextWeek] = await Promise.all([
      fetchFFCalendar("https://nfs.faireconomy.media/ff_calendar_thisweek.json"),
      fetchFFCalendar("https://nfs.faireconomy.media/ff_calendar_nextweek.json"),
    ]);
    const all = [...thisWeek, ...nextWeek];

    // Tomorrow's date in ET (UTC-4 or UTC-5)
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const tomorrowET = new Date(nowET);
    tomorrowET.setDate(tomorrowET.getDate() + 1);
    const tomorrowStr = `${tomorrowET.getFullYear()}-${String(tomorrowET.getMonth() + 1).padStart(2, "0")}-${String(tomorrowET.getDate()).padStart(2, "0")}`;

    const events = all.filter((e) => {
      if (e.country !== "USD") return false;
      if (e.impact !== "High" && e.impact !== "Medium") return false;
      // e.date is ISO like "2026-04-02T08:30:00-04:00"
      return (e.date ?? "").startsWith(tomorrowStr);
    });

    // Sort by time and format
    events.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

    return events.slice(0, 5).map((e) => {
      const timeStr = e.date
        ? new Date(e.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", hour12: true })
        : "";
      const impact = e.impact === "High" ? "🔴" : "🟡";
      const forecast = e.forecast ? ` (est. ${e.forecast})` : "";
      return `${impact} ${e.title}${forecast}${timeStr ? " — " + timeStr + " ET" : ""}`;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Format for Telegram (HTML parse mode)
// ---------------------------------------------------------------------------

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function fmtPrice(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function arrow(item: SnapshotItem): string {
  if (item.direction === "up") return "▲";
  if (item.direction === "down") return "▼";
  return "•";
}

// Strip futures contract suffix (e.g. /ESH6 → ES, /NQM6 → NQ)
function shortSym(symbol: string): string {
  return symbol
    .replace(/^\//, "")         // remove leading /
    .replace(/[A-Z]\d+$/, "");  // remove expiry code like H6, M6, Z6
}

async function formatForTelegram(items: SnapshotItem[]): Promise<string> {
  // Categorize
  const futures: SnapshotItem[] = [];
  const etfEquities: SnapshotItem[] = [];   // SPY, QQQ, IWM etc
  const commodities: SnapshotItem[] = [];
  const cryptoItems: SnapshotItem[] = [];
  let vix: SnapshotItem | null = null;
  let xsp: SnapshotItem | null = null;

  for (const item of items) {
    const sym = item.symbol.toUpperCase();

    if (sym === "VIX") {
      vix = item;
    } else if (sym === "XSP") {
      xsp = item;
    } else if (sym.includes("BTC") || sym === "BTCUSD") {
      cryptoItems.push(item);
    } else if (sym.startsWith("/GC") || sym.startsWith("/SI") || sym.startsWith("/CL")) {
      commodities.push(item);
    } else if (sym.startsWith("/")) {
      futures.push(item);
    } else {
      // Equity ETFs — SPY, QQQ, IWM, etc.
      etfEquities.push(item);
    }
  }

  // Format date header
  const now = new Date();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = dayNames[now.getDay()];
  const mon = monthNames[now.getMonth()];
  const date = now.getDate();
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }) + " ET";

  let output = `🧾 <b>Market Snapshot — ${day}, ${mon} ${date} · ${timeStr}</b>\n\n`;

  // ── Futures ──────────────────────────────────────────────────────────────
  if (futures.length > 0) {
    output += "📈 <b>Futures</b>\n";
    for (const eq of futures) {
      const sym = shortSym(eq.symbol);
      const prevStr = eq.prev_close > 0 ? ` <i>(prev ${fmtPrice(eq.prev_close)})</i>` : "";
      output += `→ <b>/${sym}:</b> ${fmtPrice(eq.last)} ${fmtPct(eq.percent_change)} ${arrow(eq)}${prevStr}\n`;
    }
    output += "\n";
  }

  // ── ETF Equities (SPY, QQQ, etc.) ────────────────────────────────────────
  if (etfEquities.length > 0) {
    output += "🏦 <b>ETFs</b>\n";
    for (const eq of etfEquities) {
      const prevStr = eq.prev_close > 0 ? ` <i>(prev ${fmtPrice(eq.prev_close)})</i>` : "";
      const ivrStr = eq.iv_rank != null ? ` · IVR <b>${eq.iv_rank.toFixed(0)}%</b>` : "";
      output += `→ <b>${eq.symbol}:</b> ${fmtPrice(eq.last)} ${fmtPct(eq.percent_change)} ${arrow(eq)}${prevStr}${ivrStr}\n`;
    }
    output += "\n";
  }

  // ── Commodities ──────────────────────────────────────────────────────────
  if (commodities.length > 0) {
    output += "🛢️ <b>Commodities</b>\n";
    for (const cmd of commodities) {
      const sym = shortSym(cmd.symbol);
      let name = sym;
      if (name === "GC") name = "Gold";
      else if (name === "SI") name = "Silver";
      else if (name === "CL") name = "Crude";
      const prevStr = cmd.prev_close > 0 ? ` <i>(prev ${fmtPrice(cmd.prev_close)})</i>` : "";
      output += `→ <b>${name}:</b> ${fmtPrice(cmd.last)} ${fmtPct(cmd.percent_change)} ${arrow(cmd)}${prevStr}\n`;
    }
    output += "\n";
  }

  // ── Crypto ───────────────────────────────────────────────────────────────
  if (cryptoItems.length > 0) {
    output += "₿ <b>Crypto</b>\n";
    for (const c of cryptoItems) {
      const prevStr = c.prev_close > 0 ? ` <i>(prev ${fmtPrice(c.prev_close)})</i>` : "";
      output += `→ <b>BTC:</b> ${fmtPrice(c.last)} ${fmtPct(c.percent_change)} ${arrow(c)}${prevStr}\n`;
    }
    output += "\n";
  }

  // ── Volatility ───────────────────────────────────────────────────────────
  if (vix || xsp) {
    output += "🌡️ <b>Volatility</b>\n";
    if (vix) {
      const vixLevel = vixLabel(vix.last);
      output += `→ <b>VIX:</b> ${fmtPrice(vix.last, 2)} ${fmtPct(vix.percent_change)} ${arrow(vix)} — ${vixLevel}\n`;
    }
    if (xsp) {
      const ivrStr = xsp.iv_rank != null
        ? ` · IVR <b>${xsp.iv_rank.toFixed(0)}%</b>`
        : "";
      output += `→ <b>XSP:</b> ${fmtPrice(xsp.last)} ${fmtPct(xsp.percent_change)} ${arrow(xsp)}${ivrStr}\n`;
    }
    output += "\n";
  }

  // ── Sector divergence ────────────────────────────────────────────────────
  const divergence = detectSectorDivergence(futures, commodities, cryptoItems, vix);
  if (divergence) {
    output += `🔀 <b>Divergence:</b> ${divergence}\n\n`;
  }

  // ── Economic calendar ────────────────────────────────────────────────────
  const econEvents = await fetchEconomicEvents();
  if (econEvents.length > 0) {
    output += `📅 <b>Tomorrow:</b> ${econEvents.join(", ")}\n\n`;
  }

  // ── Trading Insights ─────────────────────────────────────────────────────
  output += generateInsights(futures, etfEquities, commodities, cryptoItems, vix, xsp);

  return output;
}

// ---------------------------------------------------------------------------
// VIX label
// ---------------------------------------------------------------------------

function vixLabel(vixVal: number): string {
  if (vixVal >= 30) return "elevated — rich premium";
  if (vixVal >= 20) return "elevated";
  if (vixVal >= 15) return "moderate";
  return "low — thin premium";
}

// ---------------------------------------------------------------------------
// Sector divergence detection
// ---------------------------------------------------------------------------

function detectSectorDivergence(
  futures: SnapshotItem[],
  commodities: SnapshotItem[],
  crypto: SnapshotItem[],
  vix: SnapshotItem | null
): string | null {
  const es = futures.find((f) => shortSym(f.symbol) === "ES");
  const crude = commodities.find((c) => c.symbol.toUpperCase().includes("/CL") || shortSym(c.symbol) === "CL");
  const gold = commodities.find((c) => c.symbol.toUpperCase().includes("/GC") || shortSym(c.symbol) === "GC");
  const btc = crypto[0] ?? null;

  const signals: string[] = [];

  // Crude up + equities down → geopolitical pressure
  if (crude && es) {
    if (crude.percent_change > 1.5 && es.percent_change < -0.5) {
      signals.push(`Crude surging ${fmtPct(crude.percent_change)} while /ES falls — geopolitical bid`);
    } else if (crude.percent_change < -1.5 && es.percent_change > 0.5) {
      signals.push(`Crude dropping ${fmtPct(crude.percent_change)} while /ES rallies — demand concerns`);
    }
  }

  // Gold up + equities up = unusual (normally inverse)
  if (gold && es) {
    if (gold.percent_change > 1 && es.percent_change > 1) {
      signals.push(`Gold and equities both up — broad demand or dollar weakness`);
    } else if (gold.percent_change < -1 && es.percent_change < -0.5) {
      signals.push(`Gold and equities both falling — forced liquidation?`);
    }
  }

  // VIX up + equities up = unusual
  if (vix && es) {
    if (vix.percent_change > 10 && es.percent_change > 0.5) {
      signals.push(`VIX spiking despite green equities — hedging activity`);
    }
  }

  // BTC vs equities divergence
  if (btc && es) {
    if (btc.percent_change < -3 && es.percent_change > 0.5) {
      signals.push(`Crypto selling off ${fmtPct(btc.percent_change)} while equities hold — crypto-specific risk`);
    } else if (btc.percent_change > 3 && es.percent_change < -0.5) {
      signals.push(`BTC ripping ${fmtPct(btc.percent_change)} as equities fall — flight to crypto?`);
    }
  }

  return signals.length > 0 ? signals[0] : null;
}

// ---------------------------------------------------------------------------
// Generate trading insights
// ---------------------------------------------------------------------------

function generateInsights(
  futures: SnapshotItem[],
  etfEquities: SnapshotItem[],
  commodities: SnapshotItem[],
  crypto: SnapshotItem[],
  vix: SnapshotItem | null,
  xsp: SnapshotItem | null
): string {
  const insights: string[] = [];

  // Combined equity picture (futures + ETFs)
  const allEquity = [...futures, ...etfEquities];
  if (allEquity.length > 0) {
    const upCount = allEquity.filter((e) => e.direction === "up").length;
    const downCount = allEquity.filter((e) => e.direction === "down").length;
    const total = allEquity.length;

    if (upCount === total) {
      insights.push("Broad green — all equity instruments up");
    } else if (downCount === total) {
      insights.push("Broad red — equities under pressure across the board");
    } else {
      // Find biggest mover
      const biggest = allEquity.reduce((a, b) =>
        Math.abs(b.percent_change) > Math.abs(a.percent_change) ? b : a
      );
      const sym = biggest.symbol.startsWith("/") ? `/${shortSym(biggest.symbol)}` : biggest.symbol;
      insights.push(`Mixed — ${sym} leading ${biggest.direction === "up" ? "gains" : "declines"} at ${fmtPct(biggest.percent_change)}`);
    }
  }

  // Commodities
  const gold = commodities.find((c) => shortSym(c.symbol) === "GC");
  const silver = commodities.find((c) => shortSym(c.symbol) === "SI");
  const crude = commodities.find((c) => shortSym(c.symbol) === "CL");

  if (crude && Math.abs(crude.percent_change) > 1.5) {
    const dir = crude.percent_change > 0 ? "surge" : "drop";
    insights.push(`Crude ${dir} ${fmtPct(crude.percent_change)} — energy risk in play`);
  }

  if (gold) {
    if (gold.percent_change < -1) {
      insights.push(`Gold down ${fmtPct(gold.percent_change)} — risk-on environment`);
    } else if (gold.percent_change > 1) {
      insights.push(`Gold up ${fmtPct(gold.percent_change)} — safe haven flows`);
    }
  }

  if (silver && Math.abs(silver.percent_change) > 2) {
    insights.push(`Silver ripping ${fmtPct(silver.percent_change)} — industrial demand signal`);
  }

  // Crypto
  const btc = crypto[0];
  if (btc) {
    if (btc.percent_change < -2) {
      insights.push(`BTC sliding ${fmtPct(btc.percent_change)} — crypto weakness`);
    } else if (btc.percent_change > 2) {
      insights.push(`BTC up ${fmtPct(btc.percent_change)} — crypto strength`);
    }
  }

  // VIX + XSP IVR for 0DTE context
  if (vix) {
    const v = vix.last;
    if (v >= 30) {
      insights.push(`VIX at ${fmtPrice(vix.last, 1)} — elevated, premium juicy for 0DTE`);
    } else if (v >= 20) {
      insights.push(`VIX at ${fmtPrice(vix.last, 1)} — moderate, decent 0DTE premium`);
    } else {
      insights.push(`VIX at ${fmtPrice(vix.last, 1)} — low, thin 0DTE premium, size conservatively`);
    }
  }

  if (xsp?.iv_rank != null) {
    const ivr = xsp.iv_rank;
    if (ivr >= 50) {
      insights.push(`XSP IVR ${ivr.toFixed(0)}% — high vol, favour selling premium`);
    } else if (ivr <= 20) {
      insights.push(`XSP IVR ${ivr.toFixed(0)}% — low vol, be selective on 0DTE`);
    }
  }

  if (insights.length === 0) {
    insights.push("No major moves to report");
  }

  return "💡 <b>Trading Insights</b>\n" + insights.map((i) => `• ${i}`).join("\n");
}

// ---------------------------------------------------------------------------
// Execute snapshot
// ---------------------------------------------------------------------------

async function runSnapshot(): Promise<string> {
  console.log("[market-snapshot] Fetching from Mac Mini (JSON mode)...");

  try {
    const { stdout, stderr } = await execFileAsync(
      SSH_BIN,
      [...SSH_OPTS, MAC_MINI_HOST, TASTY_COACH_CMD],
      { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 },
    );

    const raw = truncate(`${stdout ?? ""}${stderr ?? ""}`);
    console.log("[market-snapshot] Raw output:", raw.slice(0, 300));

    let items: SnapshotItem[];
    try {
      items = parseSnapshotJson(raw);
    } catch (parseErr: any) {
      console.error("[market-snapshot] JSON parse failed:", parseErr.message);
      return "⚠️ Could not parse market snapshot data. Raw output:\n" + raw.slice(0, 500);
    }

    console.log("[market-snapshot] Parsed", items.length, "items");

    if (items.length === 0) {
      return "⚠️ Market snapshot returned no data. Raw output:\n" + raw.slice(0, 500);
    }

    return await formatForTelegram(items);
  } catch (err: any) {
    console.error("[market-snapshot] Error:", err.message);
    return `❌ Failed to fetch market snapshot: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

registerTool({
  name: "market_snapshot",
  category: "always",
  description:
    "Fetch the current market snapshot from tasty-coach on the Mac Mini, format it nicely for Telegram, " +
    "and generate trading insights. Use this for daily market reports at 8am and 2pm. " +
    "Returns a formatted Telegram-ready message with sections for Futures, ETFs, Commodities, Crypto, and Volatility, " +
    "plus auto-generated trading insights, sector divergence signals, and tomorrow's economic calendar events.",
  zodSchema: {},
  jsonSchemaParameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (): Promise<string> => {
    return runSnapshot();
  },
});

console.log("[tools] market_snapshot registered");
