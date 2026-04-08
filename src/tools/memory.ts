import { z } from "zod";
import { registerTool } from "./registry.js";
import { executeMemoryTool } from "../memory/tools.js";

registerTool({
  name: "update_memory",
  description: `Update persistent memory about Chris. Use proactively — don't wait to be asked. Categories:
- about-chris: facts about his life, job, background, health, location, routine
- preferences: likes, dislikes, opinions, style, tools, workflow habits
- projects: active projects and status changes
- people: names, relationships, context
- decisions: significant choices and their reasoning
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
    content: z.string().describe(
      "The memory content. Be specific, concise, factual. Use bullet points for multiple items.",
    ),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["category", "action", "content"],
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
    },
  },
  execute: executeMemoryTool,
});
