import { z } from "zod";
import { registerTool } from "./registry.js";
import { executeMemoryTool } from "../memory/tools.js";

const decisionSchema = z.object({
  date: z.string().describe("Decision date in YYYY-MM-DD format"),
  chose: z.string().describe("Option selected"),
  alternatives: z.array(z.object({
    name: z.string(),
    rejected_because: z.string(),
  })).describe("Options considered but not chosen, with rejection reasons"),
  reasoning_trace: z.array(z.string()).describe("Evidence and reasoning behind choice"),
  revisit_conditions: z.array(z.object({
    condition: z.string().describe("What would justify reviewing decision"),
    review_on: z.string().optional().describe("Optional review date in YYYY-MM-DD format"),
    status: z.enum(["pending", "met", "dismissed"]).optional(),
  })).describe("Triggers or dates that should reopen decision"),
});

registerTool({
  name: "update_memory",
  description: `Update persistent memory about Chris. Use proactively — don't wait to be asked. Categories:
- about-chris: facts about his life, job, background, health, location, routine
- preferences: likes, dislikes, opinions, style, tools, workflow habits
- projects: active projects and status changes
- people: names, relationships, context
- decisions: significant choices, rejected alternatives, reasoning trace, and revisit conditions. Prefer structured decision payload.
- learnings: patterns in how to better serve him (interaction style, what to avoid)`,
  zodSchema: {
    category: z.enum([
      "about-chris",
      "preferences",
      "projects",
      "people",
      "decisions",
      "learnings",
    ]),
    action: z.enum(["add", "replace"]).describe(
      "add: append new info. replace: rewrite the entire file (use sparingly, only to correct/consolidate).",
    ),
    content: z.string().optional().describe(
      "The memory content. Be specific, concise, factual. Use bullet points for multiple items.",
    ),
    decision: decisionSchema.optional().describe(
      "Structured counterfactual record. Only valid with category=decisions and action=add.",
    ),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["category", "action"],
    properties: {
      category: {
        type: "string",
        enum: [
          "about-chris",
          "preferences",
          "projects",
          "people",
          "decisions",
          "learnings",
        ],
      },
      action: {
        type: "string",
        enum: ["add", "replace"],
        description:
          "add: append new info. replace: rewrite the entire file (use sparingly).",
      },
      content: {
        type: "string",
        description:
          "The memory content. Be specific, concise, factual. Use bullet points for multiple items.",
      },
      decision: {
        type: "object",
        description: "Structured counterfactual record. Only valid for decisions/add.",
        required: ["date", "chose", "alternatives", "reasoning_trace", "revisit_conditions"],
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          chose: { type: "string" },
          alternatives: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "rejected_because"],
              properties: { name: { type: "string" }, rejected_because: { type: "string" } },
            },
          },
          reasoning_trace: { type: "array", items: { type: "string" } },
          revisit_conditions: {
            type: "array",
            items: {
              type: "object",
              required: ["condition"],
              properties: {
                condition: { type: "string" },
                review_on: { type: "string", description: "Optional YYYY-MM-DD review date" },
                status: { type: "string", enum: ["pending", "met", "dismissed"] },
              },
            },
          },
        },
      },
    },
  },
  execute: executeMemoryTool,
});
