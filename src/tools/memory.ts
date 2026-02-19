import { z } from "zod";
import { registerTool } from "./registry.js";
import { executeMemoryTool } from "../memory/tools.js";

registerTool({
  name: "update_memory",
  description: `Update your persistent memory about Chris. Use this when you learn something
new and important that should be remembered across conversations. Categories:
- about-chris: Facts about Chris (background, work, life)
- preferences: Things Chris likes/dislikes, communication style
- projects: What Chris is working on
- people: People Chris mentions and their context
- decisions: Important decisions Chris has made
- learnings: Things you've learned about how to better serve Chris`,
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
