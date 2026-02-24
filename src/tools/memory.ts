import { z } from "zod";
import { registerTool } from "./registry.js";
import { executeMemoryTool } from "../memory/tools.js";

registerTool({
  name: "update_memory",
  description: `Update your persistent memory about Chris. Use this proactively — your memory is what makes you a personal assistant. If you learn something worth remembering, save it. Don't wait to be asked.

Categories and when to use them:
- about-chris: Chris shares facts about his life, job, background, health, location, daily routine, or history. Example: "I just moved to Austin" → save it.
- preferences: Chris expresses likes, dislikes, opinions, or style preferences — food, tech, tools, communication style, workflow habits. Example: "I prefer short answers" → save it.
- projects: Chris mentions starting, finishing, updating, or shifting focus on a project. Example: "I'm building a Telegram bot" → save it. Also update when a project's status changes.
- people: Chris mentions someone by name or relationship. Save who they are and context. Example: "My coworker Jake is handling the backend" → save it.
- decisions: Chris makes or announces a significant decision — career, technical architecture, life choices. Save what was decided and any reasoning. Example: "I'm going with PostgreSQL instead of MongoDB" → save it.
- learnings: You discover something about how to better serve Chris — what kinds of answers he prefers, mistakes to avoid, interaction patterns. Example: Chris seems frustrated by long explanations → save "Chris prefers concise answers, avoid lengthy explanations."`,
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
