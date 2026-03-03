import { loadSkill } from "./loader.js";
import { validateInputs } from "./validator.js";
import { chat } from "../providers/index.js";

/**
 * Execute a skill by ID with optional inputs.
 *
 * Loads the full skill definition, validates inputs, substitutes placeholders
 * in the instructions, and runs a nested chat() call with filtered tool access.
 */
export async function executeSkill(
  skillId: string,
  inputs?: Record<string, any>,
): Promise<string> {
  const skill = await loadSkill(skillId);
  if (!skill) {
    return `Error: Skill '${skillId}' not found`;
  }

  if (!skill.enabled) {
    return `Error: Skill '${skill.name}' is currently disabled`;
  }

  // Validate inputs
  const provided = inputs || {};
  const inputError = validateInputs(skill, provided);
  if (inputError) {
    return `Error: ${inputError}`;
  }

  // Substitute {inputName} placeholders with provided values or defaults
  let instructions = skill.instructions;
  if (skill.inputs) {
    for (const [key, def] of Object.entries(skill.inputs)) {
      const value = provided[key] !== undefined ? provided[key] : def.default;
      if (value !== undefined) {
        instructions = instructions.replace(
          new RegExp(`\\{${key}\\}`, "g"),
          String(value),
        );
      }
    }
  }

  // Build execution prompt
  const prompt = [
    `You are executing the skill "${skill.name}".`,
    "",
    skill.description,
    "",
    "Follow these instructions:",
    "",
    instructions,
    "",
    `Format the output for ${skill.outputFormat || "telegram"}.`,
  ].join("\n");

  // Execute via nested chat() with filtered tools
  // chatId 0 = system/internal call (same as scheduler pattern)
  const response = await chat(
    0,
    prompt,
    undefined,
    undefined,
    skill.tools.length > 0 ? skill.tools : undefined,
  );

  return response;
}
