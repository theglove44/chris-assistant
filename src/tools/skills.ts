import { z } from "zod";
import { registerTool } from "./registry.js";
import {
  loadSkillIndex,
  loadSkill,
  saveSkill,
  deleteSkill,
  invalidateSkillCache,
  type Skill,
} from "../skills/loader.js";
import {
  validateSkillDefinition,
  validateInputs,
  MAX_SKILLS,
} from "../skills/validator.js";
import { executeSkill } from "../skills/executor.js";
import { invalidatePromptCache } from "../providers/shared.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSkillEntry(e: { id: string; name: string; description: string; enabled: boolean; triggers: string[] }): string {
  const status = e.enabled ? "enabled" : "disabled";
  const triggers = e.triggers.length > 0
    ? `\n  Triggers: ${e.triggers.map((t) => `"${t}"`).join(", ")}`
    : "";
  return `- **${e.name}** (${e.id})\n  Status: ${status}${triggers}\n  ${e.description}`;
}

// ---------------------------------------------------------------------------
// manage_skills tool
// ---------------------------------------------------------------------------

registerTool({
  name: "manage_skills",
  description:
    "Create, list, get, update, delete, toggle, or update state for reusable bot skills. " +
    "Skills are structured workflows that compose existing tools into higher-level capabilities. " +
    "Use this to manage the bot's skill library.",
  category: "always",
  zodSchema: {
    action: z.enum(["create", "list", "get", "update", "delete", "toggle", "update_state"]).describe(
      "The action to perform on skills",
    ),
    id: z.string().optional().describe("Skill ID (required for get, update, delete, toggle, update_state)"),
    name: z.string().optional().describe("Human-readable skill name (required for create)"),
    description: z.string().optional().describe("What the skill does (required for create)"),
    instructions: z.string().optional().describe(
      "Step-by-step instructions with {inputName} placeholders (required for create). Max 5000 chars.",
    ),
    tools: z.array(z.string()).optional().describe(
      "Tool names this skill is allowed to use (required for create). Must be registered tool names.",
    ),
    triggers: z.array(z.string()).optional().describe(
      "Phrases that should trigger this skill (optional). Used for discovery in the system prompt.",
    ),
    inputs: z.record(z.string(), z.object({
      type: z.enum(["string", "number", "boolean"]),
      description: z.string(),
      required: z.boolean().optional(),
      default: z.any().optional(),
    })).optional().describe("Typed input parameters with optional defaults"),
    output_format: z.string().optional().describe("Output format hint (default: 'telegram')"),
    state: z.record(z.string(), z.any()).optional().describe("Persistent state object (for update_state action)"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "get", "update", "delete", "toggle", "update_state"],
        description: "The action to perform on skills",
      },
      id: {
        type: "string",
        description: "Skill ID (required for get, update, delete, toggle, update_state)",
      },
      name: {
        type: "string",
        description: "Human-readable skill name (required for create)",
      },
      description: {
        type: "string",
        description: "What the skill does (required for create)",
      },
      instructions: {
        type: "string",
        description: "Step-by-step instructions with {inputName} placeholders (required for create). Max 5000 chars.",
      },
      tools: {
        type: "array",
        items: { type: "string" },
        description: "Tool names this skill is allowed to use (required for create). Must be registered tool names.",
      },
      triggers: {
        type: "array",
        items: { type: "string" },
        description: "Phrases that should trigger this skill (optional).",
      },
      inputs: {
        type: "object",
        description: "Typed input parameters. Each value: { type, description, required?, default? }",
      },
      output_format: {
        type: "string",
        description: "Output format hint (default: 'telegram')",
      },
      state: {
        type: "object",
        description: "Persistent state object (for update_state action)",
      },
    },
  },
  execute: async (args: {
    action: "create" | "list" | "get" | "update" | "delete" | "toggle" | "update_state";
    id?: string;
    name?: string;
    description?: string;
    instructions?: string;
    tools?: string[];
    triggers?: string[];
    inputs?: Record<string, { type: "string" | "number" | "boolean"; description: string; required?: boolean; default?: any }>;
    output_format?: string;
    state?: Record<string, any>;
  }): Promise<string> => {
    switch (args.action) {
      case "create": {
        if (!args.id && !args.name) return "Error: 'name' is required for create";
        if (!args.name) return "Error: 'name' is required for create";
        if (!args.description) return "Error: 'description' is required for create";
        if (!args.instructions) return "Error: 'instructions' is required for create";
        if (!args.tools) return "Error: 'tools' is required for create (can be empty array)";

        // Check skill count limit
        const index = await loadSkillIndex();
        if (index.length >= MAX_SKILLS) {
          return `Error: Maximum skill limit reached (${MAX_SKILLS}). Delete unused skills first.`;
        }

        // Generate ID from name if not provided
        const id = args.id || args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        const now = Date.now();
        const skill: Skill = {
          id,
          name: args.name,
          description: args.description,
          version: 1,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          triggers: args.triggers || [],
          tools: args.tools,
          inputs: args.inputs || {},
          instructions: args.instructions,
          outputFormat: args.output_format || "telegram",
          state: {},
        };

        // Validate
        const error = validateSkillDefinition(skill);
        if (error) return `Error: ${error}`;

        // Check for duplicate ID
        if (index.some((e) => e.id === id)) {
          return `Error: A skill with ID '${id}' already exists. Use 'update' to modify it.`;
        }

        await saveSkill(skill);
        invalidatePromptCache();
        return `Created skill "${skill.name}" (ID: ${skill.id})\nVersion: 1\nTools: ${skill.tools.join(", ") || "none"}\nTriggers: ${skill.triggers.map((t) => `"${t}"`).join(", ") || "none"}`;
      }

      case "list": {
        const index = await loadSkillIndex();
        if (index.length === 0) return "No skills defined. Use the 'create' action to add one.";
        return `${index.length} skill(s):\n\n${index.map(formatSkillEntry).join("\n\n")}`;
      }

      case "get": {
        if (!args.id) return "Error: 'id' is required for get";
        const skill = await loadSkill(args.id);
        if (!skill) return `Error: Skill '${args.id}' not found`;
        return JSON.stringify(skill, null, 2);
      }

      case "update": {
        if (!args.id) return "Error: 'id' is required for update";
        const existing = await loadSkill(args.id);
        if (!existing) return `Error: Skill '${args.id}' not found`;

        // Merge provided fields
        if (args.name) existing.name = args.name;
        if (args.description) existing.description = args.description;
        if (args.instructions) existing.instructions = args.instructions;
        if (args.tools) existing.tools = args.tools;
        if (args.triggers) existing.triggers = args.triggers;
        if (args.inputs) existing.inputs = args.inputs;
        if (args.output_format) existing.outputFormat = args.output_format;
        existing.version += 1;
        existing.updatedAt = Date.now();

        // Validate the merged result
        const error = validateSkillDefinition(existing);
        if (error) return `Error: ${error}`;

        await saveSkill(existing);
        invalidatePromptCache();
        return `Updated skill "${existing.name}" (v${existing.version})`;
      }

      case "delete": {
        if (!args.id) return "Error: 'id' is required for delete";

        // Verify it exists
        const index = await loadSkillIndex();
        if (!index.some((e) => e.id === args.id)) {
          return `Error: Skill '${args.id}' not found`;
        }

        await deleteSkill(args.id);
        invalidatePromptCache();
        return `Deleted skill '${args.id}'`;
      }

      case "toggle": {
        if (!args.id) return "Error: 'id' is required for toggle";
        const skill = await loadSkill(args.id);
        if (!skill) return `Error: Skill '${args.id}' not found`;

        skill.enabled = !skill.enabled;
        skill.updatedAt = Date.now();
        await saveSkill(skill);
        invalidatePromptCache();
        return `Skill "${skill.name}" (${skill.id}) is now ${skill.enabled ? "enabled" : "disabled"}`;
      }

      case "update_state": {
        if (!args.id) return "Error: 'id' is required for update_state";
        if (!args.state) return "Error: 'state' is required for update_state";
        const skill = await loadSkill(args.id);
        if (!skill) return `Error: Skill '${args.id}' not found`;

        // Merge state
        Object.assign(skill.state, args.state);
        skill.updatedAt = Date.now();

        // Check state size after merge
        const stateSize = JSON.stringify(skill.state).length;
        if (stateSize > 10240) {
          return `Error: State would exceed 10KB limit (${stateSize} bytes). Remove some state keys first.`;
        }

        await saveSkill(skill);
        return `Updated state for skill "${skill.name}". State keys: ${Object.keys(skill.state).join(", ") || "none"}`;
      }

      default:
        return `Unknown action: ${args.action}`;
    }
  },
});

// ---------------------------------------------------------------------------
// run_skill tool
// ---------------------------------------------------------------------------

registerTool({
  name: "run_skill",
  description:
    "Execute a registered skill by ID. Skills are reusable workflows that compose existing tools " +
    "into higher-level capabilities. Pass the skill ID and any required inputs.",
  category: "always",
  zodSchema: {
    id: z.string().describe("The skill ID to execute"),
    inputs: z.record(z.string(), z.any()).optional().describe(
      "Input values for the skill. Keys must match the skill's defined inputs.",
    ),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["id"],
    properties: {
      id: {
        type: "string",
        description: "The skill ID to execute",
      },
      inputs: {
        type: "object",
        description: "Input values for the skill. Keys must match the skill's defined inputs.",
      },
    },
  },
  execute: async (args: { id: string; inputs?: Record<string, any> }): Promise<string> => {
    return executeSkill(args.id, args.inputs);
  },
});

console.log("[tools] manage_skills + run_skill registered");
