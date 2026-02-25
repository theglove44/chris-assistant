/**
 * Conversation recall tool.
 *
 * Gives the AI access to full conversation archives and daily summaries
 * so it can answer "what did we talk about yesterday?" style questions.
 *
 * Actions: list, read_day, search, summarize
 */

import { z } from "zod";
import { registerTool } from "./registry.js";
import {
  readLocalArchive,
  listLocalArchiveDates,
  type ArchiveEntry,
} from "../conversation-archive.js";
import { readMemoryFile } from "../memory/github.js";
import { generateSummary } from "../conversation-summary.js";

const MAX_OUTPUT = 50_000;

function truncate(s: string): string {
  if (s.length > MAX_OUTPUT) {
    return s.slice(0, MAX_OUTPUT) + "\n\n[... truncated ...]";
  }
  return s;
}

function summaryRepoPath(date: string): string {
  return `conversations/summaries/${date}.md`;
}

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

function actionList(): string {
  const dates = listLocalArchiveDates();
  if (dates.length === 0) {
    return "No conversation archives found.";
  }

  const lines = dates.map((date) => {
    const entries = readLocalArchive(date);
    return `- ${date} (${entries.length} messages)`;
  });

  return `Available archive dates:\n${lines.join("\n")}`;
}

async function actionReadDay(args: { date: string; type?: string }): Promise<string> {
  const type = args.type ?? "summary";

  if (type === "summary") {
    const content = await readMemoryFile(summaryRepoPath(args.date));
    if (content) return content;
    return `No summary found for ${args.date}. Try type="log" for the full conversation, or action="summarize" to generate one.`;
  }

  // type === "log"
  const entries = readLocalArchive(args.date);
  if (entries.length === 0) {
    return `No archive found for ${args.date}.`;
  }

  const lines = entries.map((e) => {
    const time = new Date(e.ts).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const speaker = e.role === "user" ? "Chris" : "Assistant";
    return `[${time}] ${speaker}: ${e.content}`;
  });

  return truncate(lines.join("\n\n"));
}

function actionSearch(args: { query: string }): string {
  const dates = listLocalArchiveDates();
  const query = args.query.toLowerCase();
  const results: string[] = [];

  for (const date of dates) {
    const entries = readLocalArchive(date);
    for (const entry of entries) {
      if (entry.content.toLowerCase().includes(query)) {
        const time = new Date(entry.ts).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        const speaker = entry.role === "user" ? "Chris" : "Assistant";
        // Truncate long matches to keep output manageable
        const snippet = entry.content.length > 300
          ? entry.content.slice(0, 300) + "..."
          : entry.content;
        results.push(`[${date} ${time}] ${speaker}: ${snippet}`);
      }
    }
  }

  if (results.length === 0) {
    return `No matches for "${args.query}" across all archives.`;
  }

  // Cap at 50 results
  const capped = results.length > 50
    ? results.slice(0, 50).concat([`\n... and ${results.length - 50} more matches`])
    : results;

  return truncate(capped.join("\n\n"));
}

async function actionSummarize(args: { date: string }): Promise<string> {
  try {
    const result = await generateSummary(args.date);
    if (!result) {
      return `No messages found for ${args.date} — nothing to summarize.`;
    }
    return result;
  } catch (err: any) {
    return `Error generating summary: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

registerTool({
  name: "recall_conversations",
  category: "always",
  description:
    "Search and recall past conversations. Use this when Chris asks about previous discussions, " +
    "what was talked about on a specific day, or to find something mentioned in the past. " +
    "Actions: list (show available dates), read_day (read a day's summary or full log), " +
    "search (find messages matching a keyword), summarize (generate an AI summary for a date).",
  zodSchema: {
    action: z.enum(["list", "read_day", "search", "summarize"])
      .describe("The recall action to perform"),
    date: z.string().optional()
      .describe("Date in YYYY-MM-DD format (required for read_day, summarize)"),
    type: z.string().optional()
      .describe('For read_day: "summary" (default) or "log" for the full conversation'),
    query: z.string().optional()
      .describe("Search query (required for search action)"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["list", "read_day", "search", "summarize"],
        description: "The recall action to perform",
      },
      date: {
        type: "string",
        description: "Date in YYYY-MM-DD format (required for read_day, summarize)",
      },
      type: {
        type: "string",
        enum: ["summary", "log"],
        description: 'For read_day: "summary" (default) or "log" for the full conversation',
      },
      query: {
        type: "string",
        description: "Search query (required for search action)",
      },
    },
  },
  execute: async (args: {
    action: string;
    date?: string;
    type?: string;
    query?: string;
  }): Promise<string> => {
    switch (args.action) {
      case "list":
        return actionList();

      case "read_day": {
        if (!args.date) return "Error: 'date' is required for read_day";
        return actionReadDay({ date: args.date, type: args.type });
      }

      case "search": {
        if (!args.query) return "Error: 'query' is required for search";
        return actionSearch({ query: args.query });
      }

      case "summarize": {
        if (!args.date) return "Error: 'date' is required for summarize";
        return actionSummarize({ date: args.date });
      }

      default:
        return `Unknown action: ${args.action}`;
    }
  },
});

console.log("[tools] recall_conversations registered");
