import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readMemoryFile, writeMemoryFile, appendToMemoryFile } from "./github.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

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
 * Raw execution function for the update_memory tool.
 * Shared by both Claude (MCP) and OpenAI-compatible (function calling) providers.
 */
export async function executeMemoryTool(args: {
  category: string;
  action: "add" | "replace";
  content: string;
}): Promise<string> {
  const { category, action, content } = args;
  const filePath = MEMORY_FILES[category];
  if (!filePath) return `Unknown category: ${category}`;

  const timestamp = new Date().toISOString().split("T")[0];
  const entry = `<!-- Updated: ${timestamp} -->\n${content}`;

  try {
    if (action === "replace") {
      await writeMemoryFile(filePath, entry, `memory: replace ${category}`);
    } else {
      await appendToMemoryFile(filePath, entry, `memory: add to ${category}`);
    }
    return `Memory updated (${category}/${action})`;
  } catch (error: any) {
    return `Failed to update memory: ${error.message}`;
  }
}

const TOOL_DESCRIPTION = `Update your persistent memory about Chris. Use this when you learn something
new and important that should be remembered across conversations. Categories:
- about-chris: Facts about Chris (background, work, life)
- preferences: Things Chris likes/dislikes, communication style
- projects: What Chris is working on
- people: People Chris mentions and their context
- decisions: Important decisions Chris has made
- learnings: Things you've learned about how to better serve Chris`;

/**
 * MCP tool definition for Claude Agent SDK.
 */
export const updateMemoryTool = tool(
  "update_memory",
  TOOL_DESCRIPTION,
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
    const result = await executeMemoryTool({ category, action, content });
    const isError = result.startsWith("Unknown category") || result.startsWith("Failed");
    return {
      content: [{ type: "text" as const, text: result }],
      ...(isError && { isError: true }),
    };
  },
);

/**
 * OpenAI-format tool definition for MiniMax and other OpenAI-compatible providers.
 */
export const MEMORY_TOOL_DEFINITION: ChatCompletionTool = {
  type: "function",
  function: {
    name: "update_memory",
    description: TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      required: ["category", "action", "content"],
      properties: {
        category: {
          type: "string",
          enum: ["about-chris", "preferences", "projects", "people", "decisions", "learnings"],
        },
        action: {
          type: "string",
          enum: ["add", "replace"],
          description: "add: append new info. replace: rewrite the entire file (use sparingly).",
        },
        content: {
          type: "string",
          description: "The memory content. Be specific, concise, factual. Use bullet points for multiple items.",
        },
      },
    },
  },
};
