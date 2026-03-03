import { getRegisteredToolNames } from "../tools/registry.js";
import type { Skill } from "./loader.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_SKILLS = 50;
export const MAX_INSTRUCTION_LENGTH = 5000;
export const MAX_STATE_SIZE = 10240;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_ID_LENGTH = 64;
const VALID_INPUT_TYPES = new Set(["string", "number", "boolean"]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a skill definition. Returns an error message string if invalid,
 * or null if the definition is valid.
 */
export function validateSkillDefinition(skill: Partial<Skill>): string | null {
  // ID format
  if (!skill.id || typeof skill.id !== "string") {
    return "Skill 'id' is required";
  }
  if (skill.id.length > MAX_ID_LENGTH) {
    return `Skill 'id' must be ${MAX_ID_LENGTH} characters or fewer`;
  }
  if (!ID_PATTERN.test(skill.id)) {
    return "Skill 'id' must start with a lowercase letter or digit and contain only lowercase letters, digits, and hyphens";
  }

  // Required string fields
  if (!skill.name || typeof skill.name !== "string" || skill.name.trim() === "") {
    return "Skill 'name' is required and must be non-empty";
  }
  if (!skill.description || typeof skill.description !== "string" || skill.description.trim() === "") {
    return "Skill 'description' is required and must be non-empty";
  }
  if (!skill.instructions || typeof skill.instructions !== "string" || skill.instructions.trim() === "") {
    return "Skill 'instructions' is required and must be non-empty";
  }

  // Instruction length
  if (skill.instructions.length > MAX_INSTRUCTION_LENGTH) {
    return `Skill 'instructions' must be ${MAX_INSTRUCTION_LENGTH} characters or fewer (got ${skill.instructions.length})`;
  }

  // Tools validation
  if (!Array.isArray(skill.tools)) {
    return "Skill 'tools' must be an array";
  }
  const registeredNames = new Set(getRegisteredToolNames());
  for (const toolName of skill.tools) {
    if (typeof toolName !== "string") {
      return `Invalid tool entry: expected string, got ${typeof toolName}`;
    }
    if (!registeredNames.has(toolName)) {
      return `Unknown tool '${toolName}' — must be a registered tool name`;
    }
  }

  // Inputs validation
  if (skill.inputs && typeof skill.inputs === "object") {
    for (const [key, input] of Object.entries(skill.inputs)) {
      if (!input || typeof input !== "object") {
        return `Invalid input definition for '${key}'`;
      }
      if (!VALID_INPUT_TYPES.has(input.type)) {
        return `Input '${key}' has invalid type '${input.type}' — must be string, number, or boolean`;
      }
      if (!input.description || typeof input.description !== "string") {
        return `Input '${key}' must have a description`;
      }
    }
  }

  // State size
  const stateSize = JSON.stringify(skill.state || {}).length;
  if (stateSize > MAX_STATE_SIZE) {
    return `Skill state is too large (${stateSize} bytes, max ${MAX_STATE_SIZE})`;
  }

  return null;
}

/**
 * Validate that all required inputs are provided with correct types.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateInputs(
  skill: Skill,
  provided: Record<string, any>,
): string | null {
  if (!skill.inputs) return null;

  for (const [key, def] of Object.entries(skill.inputs)) {
    const value = provided[key];

    // Check required inputs (required defaults to true if not explicitly false)
    if (def.required !== false && value === undefined && def.default === undefined) {
      return `Missing required input '${key}': ${def.description}`;
    }
  }

  return null;
}
