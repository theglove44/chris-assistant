import { z } from "zod";
import { formatUsageReport } from "../usage-tracker.js";
import { registerTool } from "./registry.js";

registerTool({
  name: "get_usage_report",
  category: "always",
  description: "Get the provider-neutral token usage and cost report for a UTC date. Defaults to today.",
  zodSchema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      .describe("UTC date in YYYY-MM-DD format. Defaults to today."),
  },
  jsonSchemaParameters: {
    type: "object",
    properties: {
      date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "UTC date in YYYY-MM-DD format. Defaults to today." },
    },
    required: [],
  },
  execute: async ({ date }: { date?: string }) => formatUsageReport(date ?? new Date().toISOString().slice(0, 10)),
});
