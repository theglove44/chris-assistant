import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAppServerSession,
  decideCommandApproval,
  decideFileChangeApproval,
} from "../src/symphony/codex/app-server.js";
import type { DynamicToolHandler, Issue, SymphonyConfig } from "../src/symphony/types.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function writeFakeAppServerScript(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-codex-app-server-"));
  cleanupPaths.push(dir);
  const scriptPath = path.join(dir, "fake-app-server.js");

  fs.writeFileSync(scriptPath, `
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });
let pendingToolCallId = null;
function send(payload) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...payload }) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    send({ id: msg.id, result: { userAgent: "fake-codex" } });
    return;
  }
  if (msg.method === "initialized") return;
  if (msg.method === "thread/start") {
    send({ id: msg.id, result: { thread: { id: "thread-1" } } });
    return;
  }
  if (msg.method === "turn/start") {
    send({ id: msg.id, result: { turn: { id: "turn-1" } } });
    pendingToolCallId = 900;
    send({
      method: "item/tool/call",
      id: pendingToolCallId,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "tool-call-1",
        tool: "linear_graphql",
        arguments: { query: "{ viewer { id } }" }
      }
    });
    return;
  }
  if (msg.id === pendingToolCallId) {
    send({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", lastAgentMessage: "tool call completed" }
      }
    });
  }
});
`, "utf-8");

  return scriptPath;
}

function makeConfig(command: string, workspaceRoot: string): SymphonyConfig {
  return {
    workflowPath: path.join(workspaceRoot, "WORKFLOW.md"),
    tracker: {
      kind: "memory",
      endpoint: "",
      apiKey: null,
      projectSlug: null,
      repo: null,
      assignee: null,
      activeStates: ["Todo"],
      terminalStates: ["Done"],
    },
    polling: { intervalMs: 30_000 },
    workspace: { root: workspaceRoot },
    landing: {
      enabled: false,
      triggerState: null,
      baseBranch: null,
      branchPrefix: "codex/symphony/",
      draft: true,
      commitMessageTemplate: "",
      pullRequestTitleTemplate: "",
      pullRequestBodyTemplate: "",
      authorName: "Symphony Bot",
      authorEmail: "symphony@example.com",
    },
    hooks: {
      afterCreate: null,
      beforeRun: null,
      afterRun: null,
      beforeRemove: null,
      timeoutMs: 10_000,
    },
    agent: { maxConcurrentAgents: 1, maxTurns: 1, maxRetryBackoffMs: 10_000, provider: "codex" as const },
    codex: {
      command,
      model: null,
      reasoningEffort: null,
      approvalPolicy: "never",
      threadSandbox: "workspace-write",
      turnTimeoutMs: 10_000,
      readTimeoutMs: 5_000,
      stallTimeoutMs: 5_000,
      serviceName: "test-symphony",
    },
    claudeCode: {
      model: "claude-sonnet-4-6",
      maxTurnsPerQuery: null,
      systemPromptAppend: null,
      turnTimeoutMs: 3_600_000,
    },
    server: { host: "127.0.0.1", port: null },
  };
}

const TEST_ISSUE: Issue = {
  id: "issue-1",
  identifier: "CA-200",
  title: "Fake app server test",
  description: null,
  priority: null,
  state: "Todo",
  branchName: null,
  url: null,
  labels: [],
  blockedBy: [],
  assigneeId: null,
  assignedToWorker: false,
  createdAt: null,
  updatedAt: null,
};

describe("CodexAppServerSession", () => {
  it("handles dynamic tool calls and completes a turn", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-app-server-"));
    cleanupPaths.push(workspaceRoot);
    const scriptPath = writeFakeAppServerScript();

    let executeCalls = 0;
    const dynamicTools: DynamicToolHandler = {
      listTools() {
        return [{
          name: "linear_graphql",
          description: "fake",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        }];
      },
      async execute() {
        executeCalls++;
        return {
          success: true,
          contentItems: [{ type: "inputText", text: JSON.stringify({ ok: true }) }],
        };
      },
    };

    const session = new CodexAppServerSession(
      makeConfig(`node ${JSON.stringify(scriptPath)}`, workspaceRoot),
      workspaceRoot,
      TEST_ISSUE,
      dynamicTools,
    );

    await session.start();
    const result = await session.runTurn("Do the work");
    session.stop();

    expect(result.turnId).toBe("turn-1");
    expect(result.lastAgentMessage).toBe("tool call completed");
    expect(executeCalls).toBe(1);
  });

  it("approves only safe workspace-scoped command requests", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-approval-workspace-"));
    cleanupPaths.push(workspaceRoot);

    expect(decideCommandApproval({
      commandActions: [
        { type: "read", path: "README.md" },
        { type: "search", path: "src" },
      ],
    }, workspaceRoot)).toBe("approved");

    expect(decideCommandApproval({
      commandActions: [{ type: "unknown", command: "git commit -m test" }],
    }, workspaceRoot)).toBe("denied");

    expect(decideCommandApproval({
      commandActions: [{ type: "read", path: "/etc/passwd" }],
    }, workspaceRoot)).toBe("denied");

    expect(decideCommandApproval({
      commandActions: [{ type: "read", path: "README.md" }],
      additionalPermissions: { network: true },
    }, workspaceRoot)).toBe("denied");
  });

  it("approves file changes only inside the workspace without root grants", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-file-approval-"));
    cleanupPaths.push(workspaceRoot);

    expect(decideFileChangeApproval({
      changes: [
        { filePath: "src/index.ts" },
        { targetPath: "./tests/example.test.ts" },
      ],
    }, workspaceRoot)).toBe("approved");

    expect(decideFileChangeApproval({
      grantRoot: "/tmp/elsewhere",
    }, workspaceRoot)).toBe("denied");

    expect(decideFileChangeApproval({
      changes: [{ filePath: "/etc/hosts" }],
    }, workspaceRoot)).toBe("denied");
  });
});
