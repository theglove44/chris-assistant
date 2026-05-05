import { Command } from "commander";
import { inspectPrompt } from "../../providers/shared.js";

export function registerPromptCommand(program: Command): void {
  const prompt = program
    .command("prompt")
    .description("Inspect assistant prompt assembly");

  prompt
    .command("inspect")
    .description("Show redacted prompt sections and runtime metadata")
    .action(async () => {
      console.log(await inspectPrompt());
    });
}
