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
const TASTY_COACH_CMD = "cd ~/Projects/tasty-coach && source venv/bin/activate && python main.py --snapshot";

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
  last: string;
  chg: string;
  chgPercent: string;
  direction: "up" | "down" | "flat";
}

interface ParsedSnapshot {
  items: SnapshotItem[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Parse the raw snapshot output
// ---------------------------------------------------------------------------

function parseSnapshot(raw: string): ParsedSnapshot {
  const lines = raw.split("\n");
  const items: SnapshotItem[] = [];
  let timestamp = "";

  // Find the data table - look for lines with / or VIX
  for (const line of lines) {
    const trimmed = line.trim();

    // Capture timestamp (appears after the table)
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      timestamp = trimmed;
      continue;
    }

    // Skip header lines and empty lines
    if (!trimmed || trimmed.includes("Symbol") || trimmed.includes("---")) {
      continue;
    }

    // Parse data lines: Symbol        Last      Chg   Chg%
    // Example: VIX          19.60    +1.67 +9.31% 🟢
    const match = trimmed.match(/^(\S+)\s+([\d,.-]+)\s+([\d,.-]+)\s+([+-]?[\d.]+%)/);
    if (match) {
      const [, symbol, last, chg, chgPercentRaw] = match;
      const chgPercent = chgPercentRaw.replace(/[+%]/g, "");
      const num = parseFloat(chgPercent);

      let direction: "up" | "down" | "flat" = "flat";
      if (num > 0) direction = "up";
      else if (num < 0) direction = "down";

      items.push({
        symbol: symbol.replace(/[$🟢🔴]/g, ""), // remove emoji/currency if present
        last,
        chg,
        chgPercent: chgPercentRaw,
        direction,
      });
    }
  }

  return { items, timestamp };
}

// ---------------------------------------------------------------------------
// Format for Telegram (HTML parse mode)
// ---------------------------------------------------------------------------

function formatForTelegram(parsed: ParsedSnapshot): string {
  // Categorize items
  const equities: SnapshotItem[] = [];
  const commodities: SnapshotItem[] = [];
  let crypto: SnapshotItem | null = null;
  let vix: SnapshotItem | null = null;

  for (const item of parsed.items) {
    const sym = item.symbol.toUpperCase();

    if (sym === "VIX") {
      vix = item;
    } else if (sym.includes("BTC")) {
      crypto = item;
    } else if (sym.includes("GC") || sym.includes("SI") || sym.includes("CL")) {
      commodities.push(item);
    } else {
      // Equities: /ES, /NQ, /YM, /RTY
      equities.push(item);
    }
  }

  // Helper for arrow
  const arrow = (item: SnapshotItem) => {
    if (item.direction === "up") return "▲";
    if (item.direction === "down") return "▼";
    return "•";
  };

  // Format date
  const now = new Date();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = dayNames[now.getDay()];
  const mon = monthNames[now.getMonth()];
  const date = now.getDate();

  // Build output with HTML bold
  let output = `🧾 <b>Market Snapshot — ${day}, ${mon} ${date}</b>\n\n`;

  // Equities
  if (equities.length > 0) {
    output += "📈 <b>Equities</b>\n";
    for (const eq of equities) {
      const sym = eq.symbol.replace("/", "").replace("H6", "");
      output += `→ <b>/${sym}:</b> ${eq.last} ${eq.chg} (${eq.chgPercent}) ${arrow(eq)}\n`;
    }
    output += "\n";
  }

  // Commodities
  if (commodities.length > 0) {
    output += "🛢️ <b>Commodities</b>\n";
    for (const cmd of commodities) {
      let name = cmd.symbol.replace("/", "").replace("H6", "");
      if (name === "GC") name = "Gold";
      if (name === "SI") name = "Silver";
      if (name === "CL") name = "Crude";
      output += `→ <b>${name}:</b> ${cmd.last} ${cmd.chg} (${cmd.chgPercent}) ${arrow(cmd)}\n`;
    }
    output += "\n";
  }

  // Crypto
  if (crypto) {
    output += "₿ <b>Crypto</b>\n";
    output += `→ <b>BTC:</b> ${crypto.last} ${crypto.chg} (${crypto.chgPercent}) ${arrow(crypto)}\n\n`;
  }

  // Volatility
  if (vix) {
    output += "🌡️ <b>Volatility</b>\n";
    output += `→ <b>VIX:</b> ${vix.last} ${vix.chg} (${vix.chgPercent}) ${arrow(vix)}\n\n`;
  }

  // Insights
  output += generateInsights(equities, commodities, crypto, vix);

  return output;
}

// ---------------------------------------------------------------------------
// Generate trading insights
// ---------------------------------------------------------------------------

function generateInsights(
  equities: SnapshotItem[],
  commodities: SnapshotItem[],
  crypto: SnapshotItem | null,
  vix: SnapshotItem | null
): string {
  const insights: string[] = [];

  // Analyze equities
  if (equities.length > 0) {
    const upCount = equities.filter(e => e.direction === "up").length;
    const downCount = equities.filter(e => e.direction === "down").length;
    const total = equities.length;

    if (upCount === total) {
      insights.push("Broad green — equities up across the board");
    } else if (downCount === total) {
      insights.push("Broad red — equities under pressure");
    } else if (upCount > downCount) {
      // Find the biggest mover
      const biggest = equities.reduce((a, b) => {
        const aVal = Math.abs(parseFloat(a.chgPercent));
        const bVal = Math.abs(parseFloat(b.chgPercent));
        return bVal > aVal ? b : a;
      });
      const sym = biggest.symbol.replace("/", "").replace("H6", "");
      insights.push(`Mixed — ${sym} leading ${biggest.direction === "up" ? "gains" : "declines"}`);
    }
  }

  // Analyze commodities
  if (commodities.length > 0) {
    const gold = commodities.find(c => c.symbol.includes("GC"));
    const silver = commodities.find(c => c.symbol.includes("SI"));
    const crude = commodities.find(c => c.symbol.includes("CL"));

    if (silver) {
      const silverVal = parseFloat(silver.chgPercent);
      if (Math.abs(silverVal) > 2) {
        insights.push(`Silver ripping ${silverVal > 0 ? "+" : ""}${silver.chgPercent} — industrial demand?`);
      }
    }

    if (gold) {
      const goldVal = parseFloat(gold.chgPercent);
      if (goldVal < -1) {
        insights.push(`Gold down ${gold.chgPercent} — risk-on environment`);
      } else if (goldVal > 1) {
        insights.push(`Gold up ${gold.chgPercent} — safe haven flows`);
      }
    }
  }

  // Crypto
  if (crypto) {
    const btcVal = parseFloat(crypto.chgPercent);
    if (btcVal < -2) {
      insights.push(`BTC sliding ${crypto.chgPercent} — crypto weakness`);
    } else if (btcVal > 2) {
      insights.push(`BTC ripping ${crypto.chgPercent} — crypto strength`);
    }
  }

  // VIX
  if (vix) {
    const vixVal = parseFloat(vix.chgPercent);
    if (vixVal > 20) {
      insights.push(`VIX spiking ${vix.chgPercent} — elevated volatility, premium for 0DTE`);
    } else if (vixVal < -20) {
      insights.push(`VIX compressing ${vix.chgPercent} — calm market, lower premium`);
    } else if (vixVal > 0) {
      insights.push(`VIX up ${vix.chgPercent} — slight elevated volatility`);
    } else {
      insights.push(`VIX flat — calm market, decent premium for 0DTE`);
    }
  }

  if (insights.length === 0) {
    insights.push("No major moves to report");
  }

  return "💡 <b>Trading Insights</b>\n" + insights.map(i => `• ${i}`).join("\n");
}

// ---------------------------------------------------------------------------
// Execute snapshot
// ---------------------------------------------------------------------------

async function runSnapshot(): Promise<string> {
  console.log("[market-snapshot] Fetching from Mac Mini...");

  try {
    const { stdout, stderr } = await execFileAsync(
      SSH_BIN,
      [...SSH_OPTS, MAC_MINI_HOST, TASTY_COACH_CMD],
      { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
    );

    const raw = truncate(`${stdout ?? ""}${stderr ?? ""}`);

    // Debug: log raw output
    console.log("[market-snapshot] Raw output:", raw.slice(0, 500));

    const parsed = parseSnapshot(raw);
    console.log("[market-snapshot] Parsed", parsed.items.length, "items");

    if (parsed.items.length === 0) {
      return "⚠️ Could not parse market snapshot data. Raw output:\n" + raw;
    }

    return formatForTelegram(parsed);
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
    "Returns a formatted Telegram-ready message with sections for Equities, Commodities, Crypto, and Volatility, " +
    "plus auto-generated trading insights.",
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
