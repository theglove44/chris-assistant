import { z } from "zod";
import { registerTool } from "./registry.js";
import { addJournalEntry } from "../memory/journal.js";
import { datestamp } from "../conversation-archive.js";

registerTool({
  name: "journal_entry",
  category: "always",
  description:
    "Write a note to your daily journal. Use this to record observations, decisions, " +
    "topics discussed, tasks completed, things learned, or anything worth remembering " +
    "from the current conversation. Write naturally — these notes are for your future self " +
    "to maintain continuity across conversations. Don't journal routine greetings or trivial exchanges.",
  zodSchema: {
    entry: z.string().describe("The journal entry text. Write naturally, like a brief note to yourself."),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["entry"],
    properties: {
      entry: {
        type: "string",
        description: "The journal entry text. Write naturally, like a brief note to yourself.",
      },
    },
  },
  execute: async (args: { entry: string }): Promise<string> => {
    if (!args.entry || args.entry.trim().length === 0) {
      return "Error: entry text is required";
    }

    const trimmed = args.entry.trim();
    if (trimmed.length > 2000) {
      return "Error: journal entry too long (max 2000 chars). Be concise.";
    }

    const today = datestamp();
    addJournalEntry(trimmed, today);
    console.log("[journal] Entry added (%d chars)", trimmed.length);
    return `Journal entry saved for ${today}.`;
  },
});

console.log("[tools] journal_entry registered");
