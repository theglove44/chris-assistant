import { z } from "zod";
import {
  decisionsDueForRevisit,
  formatDecisionsDue,
  isIsoCalendarDate,
} from "../domain/memory/decision-service.js";
import { registerTool } from "./registry.js";

export async function executeDecisionsDueForRevisit({ as_of }: { as_of?: string }): Promise<string> {
  const asOf = as_of ?? new Date().toISOString().slice(0, 10);
  if (!isIsoCalendarDate(asOf)) return "Invalid as_of date; expected a valid YYYY-MM-DD date";
  return formatDecisionsDue(await decisionsDueForRevisit(asOf), asOf);
}

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
  execute: executeDecisionsDueForRevisit,
});
