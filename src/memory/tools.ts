import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readMemoryFile, writeMemoryFile, appendToMemoryFile } from "./github.js";

/** The memory categories the assistant can write to */
const MEMORY_FILES: Record<string, string> = {
  "about-chris": "knowledge/about-chris.md",
  preferences: "knowledge/preferences.md",
  projects: "knowledge/projects.md",
  people: "knowledge/people.md",
  decisions: "memory/decisions.md",
  learnings: "memory/learnings.md",
};

/**
 * MCP tool that lets the assistant update its own persistent memory.
 */
export const updateMemoryTool = tool(
  "update_memory",
  `Update your persistent memory about Chris. Use this when you learn something
new and important that should be remembered across conversations. Categories:
- about-chris: Facts about Chris (background, work, life)
- preferences: Things Chris likes/dislikes, communication style
- projects: What Chris is working on
- people: People Chris mentions and their context
- decisions: Important decisions Chris has made
- learnings: Things you've learned about how to better serve Chris`,
  {
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
  async ({ category, action, content }) => {
    const filePath = MEMORY_FILES[category];
    if (!filePath) {
      return {
        content: [{ type: "text" as const, text: `Unknown category: ${category}` }],
        isError: true,
      };
    }

    const timestamp = new Date().toISOString().split("T")[0];
    const entry = `<!-- Updated: ${timestamp} -->\n${content}`;

    try {
      if (action === "replace") {
        await writeMemoryFile(filePath, entry, `memory: replace ${category}`);
      } else {
        await appendToMemoryFile(filePath, entry, `memory: add to ${category}`);
      }

      return {
        content: [{ type: "text" as const, text: `Memory updated (${category}/${action})` }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text" as const, text: `Failed to update memory: ${error.message}` }],
        isError: true,
      };
    }
  },
);
