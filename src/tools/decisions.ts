import { z } from "zod";
import { decisionsDueForRevisit, formatDecisionsDue } from "../domain/memory/decision-service.js";
import { registerTool } from "./registry.js";

registerTool({
  name: "decisions_due_for_revisit",
  category: "always",
  description: "List structured decisions whose review date has arrived or whose revisit condition is marked met.",
  zodSchema: {
    as_of: z.string().optional().describe("Cutoff date in YYYY-MM-DD format; defaults to today"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: [],
    properties: {
      as_of: { type: "string", description: "Optional cutoff date in YYYY-MM-DD format" },
    },
  },
  execute: async ({ as_of }: { as_of?: string }) => {
    const asOf = as_of ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return "Invalid as_of date; expected YYYY-MM-DD";
    return formatDecisionsDue(await decisionsDueForRevisit(asOf), asOf);
  },
});
