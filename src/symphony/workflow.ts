import * as fs from "fs";
import * as path from "path";
import { Liquid } from "liquidjs";
import YAML from "yaml";
import type { WorkflowDefinition } from "./types.js";

const liquid = new Liquid({
  strictFilters: true,
  strictVariables: false,
});

function splitFrontMatter(content: string): { yaml: string; promptTemplate: string } {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { yaml: "", promptTemplate: content.trim() };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { yaml: lines.slice(1).join("\n"), promptTemplate: "" };
  }

  return {
    yaml: lines.slice(1, endIndex).join("\n"),
    promptTemplate: lines.slice(endIndex + 1).join("\n").trim(),
  };
}

export function defaultWorkflowPath(workdir = process.cwd()): string {
  return path.join(workdir, "WORKFLOW.md");
}

export function loadWorkflow(workflowPath = defaultWorkflowPath()): WorkflowDefinition {
  const resolved = path.resolve(workflowPath);
  const content = fs.readFileSync(resolved, "utf-8");
  const { yaml, promptTemplate } = splitFrontMatter(content);
  const parsed = yaml.trim() ? YAML.parse(yaml) : {};
  if (parsed !== null && typeof parsed !== "object") {
    throw new Error("WORKFLOW.md front matter must decode to an object");
  }

  return {
    path: resolved,
    config: (parsed ?? {}) as Record<string, unknown>,
    promptTemplate,
  };
}

export async function renderTemplateString(
  template: string,
  context: Record<string, unknown>,
): Promise<string> {
  return liquid.parseAndRender(template, context);
}

export async function renderWorkflowPrompt(
  definition: WorkflowDefinition,
  context: Record<string, unknown>,
): Promise<string> {
  if (!definition.promptTemplate.trim()) {
    return [
      `You are working on issue ${(context.issue as { identifier?: string })?.identifier ?? "unknown"}.`,
      `Title: ${(context.issue as { title?: string })?.title ?? "Untitled"}`,
      "",
      (context.issue as { description?: string | null })?.description || "No description provided.",
    ].join("\n");
  }

  return renderTemplateString(definition.promptTemplate, context);
}
