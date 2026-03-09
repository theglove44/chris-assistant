import { z } from "zod";
import { registerTool } from "./registry.js";
import { formatUsageReport, getDailySummary, getRollingAverage } from "../usage-tracker.js";

registerTool({
  name: "get_usage_report",
  category: "always",
  description:
    "Get a token usage and cost report. Defaults to today. " +
    "Use this when Chris asks about API costs, token usage, or model spending.",
  zodSchema: {
    date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
    days: z.number().optional().describe("Number of days to include (for multi-day summaries). Defaults to 1."),
  },
  jsonSchemaParameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today." },
      days: { type: "number", description: "Number of days to include. Defaults to 1." },
    },
    required: [],
  },
  execute: async (args: { date?: string; days?: number }): Promise<string> => {
    const days = args.days ?? 1;

    if (days === 1) {
      const date = args.date ?? new Date().toISOString().slice(0, 10);
      return formatUsageReport(date);
    }

    // Multi-day report
    const lines: string[] = [];
    const startDate = args.date
      ? new Date(args.date)
      : new Date();

    let grandTotal = 0;

    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const summary = getDailySummary(dateStr);

      if (Object.keys(summary.models).length === 0) continue;

      lines.push(`**${dateStr}** — $${summary.totalCost.toFixed(2)}`);
      for (const [model, stats] of Object.entries(summary.models)) {
        lines.push(`  ${model}: ${stats.calls} calls, $${stats.totalCost.toFixed(2)}`);
      }
      grandTotal += summary.totalCost;
    }

    if (lines.length === 0) {
      return `📊 **Token Usage — last ${days} days**\n\nNo API calls recorded.`;
    }

    const avg = getRollingAverage(days);
    lines.unshift(`📊 **Token Usage — last ${days} days**\n`);
    lines.push("");
    lines.push(`**Total:** $${grandTotal.toFixed(2)}`);
    lines.push(`**Daily avg:** $${avg.toFixed(2)}/day`);

    return lines.join("\n");
  },
});

console.log("[tools] get_usage_report registered");
