import { z } from "zod";
import { registerTool } from "./registry.js";
import {
  getSchedules,
  addSchedule,
  removeSchedule,
  toggleSchedule,
  type Schedule,
} from "../scheduler.js";

function formatSchedule(s: Schedule): string {
  const status = s.enabled ? "enabled" : "disabled";
  const lastRun = s.lastRun
    ? new Date(s.lastRun).toLocaleString()
    : "never";
  return `- **${s.name}** (${s.id})\n  Schedule: \`${s.schedule}\`\n  Status: ${status}\n  Last run: ${lastRun}\n  Prompt: ${s.prompt.slice(0, 100)}${s.prompt.length > 100 ? "..." : ""}`;
}

registerTool({
  name: "manage_schedule",
  description:
    "Create, list, delete, or toggle scheduled tasks. Scheduled tasks run on a cron schedule — the prompt is sent to the AI with full tool access and the response is delivered via Telegram. Use this when the user wants recurring checks, reminders, or periodic tasks.",
  category: "always",
  zodSchema: {
    action: z.enum(["create", "list", "delete", "toggle"]).describe(
      "The action to perform: create a new schedule, list all schedules, delete a schedule, or toggle a schedule on/off",
    ),
    name: z.string().optional().describe("Human-readable name for the schedule (required for create)"),
    prompt: z.string().optional().describe(
      "The prompt to send to the AI when the schedule fires (required for create). The AI will have full tool access.",
    ),
    schedule: z.string().optional().describe(
      "Cron expression with 5 fields: minute hour day-of-month month day-of-week. Examples: '0 9 * * *' = daily at 9am, '*/30 * * * *' = every 30 min, '0 9 * * 1-5' = weekdays at 9am. Required for create.",
    ),
    id: z.string().optional().describe("Schedule ID (required for delete and toggle)"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "delete", "toggle"],
        description:
          "The action to perform: create a new schedule, list all schedules, delete a schedule, or toggle a schedule on/off",
      },
      name: {
        type: "string",
        description: "Human-readable name for the schedule (required for create)",
      },
      prompt: {
        type: "string",
        description:
          "The prompt to send to the AI when the schedule fires (required for create). The AI will have full tool access.",
      },
      schedule: {
        type: "string",
        description:
          "Cron expression with 5 fields: minute hour day-of-month month day-of-week. Examples: '0 9 * * *' = daily at 9am, '*/30 * * * *' = every 30 min, '0 9 * * 1-5' = weekdays at 9am. Required for create.",
      },
      id: {
        type: "string",
        description: "Schedule ID (required for delete and toggle)",
      },
    },
  },
  execute: async (args: {
    action: "create" | "list" | "delete" | "toggle";
    name?: string;
    prompt?: string;
    schedule?: string;
    id?: string;
  }): Promise<string> => {
    switch (args.action) {
      case "create": {
        if (!args.name) return "Error: 'name' is required for create";
        if (!args.prompt) return "Error: 'prompt' is required for create";
        if (!args.schedule) return "Error: 'schedule' is required for create";

        // Basic validation: 5 space-separated fields
        const fields = args.schedule.trim().split(/\s+/);
        if (fields.length !== 5) {
          return `Error: Invalid cron expression — expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`;
        }

        const task = addSchedule({
          name: args.name,
          prompt: args.prompt,
          schedule: args.schedule.trim(),
          enabled: true,
        });

        return `Created schedule "${task.name}" (ID: ${task.id})\nCron: \`${task.schedule}\`\nThe task will run on the next matching minute.`;
      }

      case "list": {
        const all = getSchedules();
        if (all.length === 0) return "No scheduled tasks.";
        return `${all.length} scheduled task(s):\n\n${all.map(formatSchedule).join("\n\n")}`;
      }

      case "delete": {
        if (!args.id) return "Error: 'id' is required for delete";
        const removed = removeSchedule(args.id);
        if (!removed) return `Error: No schedule found with ID "${args.id}"`;
        return `Deleted schedule ${args.id}`;
      }

      case "toggle": {
        if (!args.id) return "Error: 'id' is required for toggle";
        const toggled = toggleSchedule(args.id);
        if (!toggled) return `Error: No schedule found with ID "${args.id}"`;
        return `Schedule "${toggled.name}" (${toggled.id}) is now ${toggled.enabled ? "enabled" : "disabled"}`;
      }

      default:
        return `Unknown action: ${args.action}`;
    }
  },
});

console.log("[tools] manage_schedule registered");
