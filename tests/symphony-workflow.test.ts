import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { buildSymphonyConfig } from "../src/symphony/config.js";
import { loadWorkflow, renderWorkflowPrompt } from "../src/symphony/workflow.js";

describe("Symphony workflow", () => {
  it("loads front matter and renders liquid-style placeholders", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-workflow-"));
    const workflowPath = path.join(tempDir, "WORKFLOW.md");

    fs.writeFileSync(workflowPath, `---
tracker:
  kind: github
  repo: "theglove44/chris-assistant"
polling:
  interval_ms: 45000
workspace:
  root: ${JSON.stringify(path.join(tempDir, "workspaces"))}
landing:
  enabled: true
  base_branch: "main"
agent:
  max_turns: 3
codex:
  command: "codex app-server"
---
Issue: {{ issue.identifier }}
Title: {{ issue.title }}
Attempt: {{ attempt }}
`, "utf-8");

    const workflow = loadWorkflow(workflowPath);
    const config = buildSymphonyConfig(workflow);
    const rendered = await renderWorkflowPrompt(workflow, {
      attempt: 2,
      issue: {
        identifier: "CA-42",
        title: "Build Symphony",
      },
    });

    expect(workflow.path).toBe(workflowPath);
    expect(config.polling.intervalMs).toBe(45_000);
    expect(config.agent.maxTurns).toBe(3);
    expect(config.landing.enabled).toBe(true);
    expect(config.landing.baseBranch).toBe("main");
    expect(rendered).toContain("Issue: CA-42");
    expect(rendered).toContain("Title: Build Symphony");
    expect(rendered).toContain("Attempt: 2");
  });

  it("enforces a test-first implementation sequence in the repository workflow", async () => {
    const workflowPath = path.resolve("WORKFLOW.md");
    const workflow = loadWorkflow(workflowPath);
    const rendered = await renderWorkflowPrompt(workflow, {
      attempt: 1,
      issue: {
        identifier: "#84",
        title: "Enforce test-first Symphony workflow",
        description: "Stage 1 prompt contract",
      },
    });

    const failingTest = rendered.indexOf("Write or update the smallest relevant test first");
    const verifyFailure = rendered.indexOf("Run that test and confirm it fails for the expected reason");
    const implementation = rendered.indexOf("Implement the smallest change that makes the test pass");
    const verifyPass = rendered.indexOf("Run the focused test again and confirm it passes");

    expect(failingTest).toBeGreaterThan(-1);
    expect(verifyFailure).toBeGreaterThan(failingTest);
    expect(implementation).toBeGreaterThan(verifyFailure);
    expect(verifyPass).toBeGreaterThan(implementation);
  });
});
