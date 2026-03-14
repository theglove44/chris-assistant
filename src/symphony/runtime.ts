import { buildSymphonyConfig } from "./config.js";
import { startSymphonyHttpServer } from "./http.js";
import { SymphonyOrchestrator } from "./orchestrator.js";
import { ensureSymphonyDirs } from "./paths.js";
import { GitHubTracker } from "./tracker/github.js";
import { LinearTracker } from "./tracker/linear.js";
import { MemoryTracker } from "./tracker/memory.js";
import { loadWorkflow } from "./workflow.js";
import type { DynamicToolHandler, Tracker } from "./types.js";

const LINEAR_GRAPHQL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", description: "GraphQL query or mutation to execute against Linear." },
    variables: { type: ["object", "null"], additionalProperties: true },
  },
} as const;

const GITHUB_ISSUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "issue_id"],
  properties: {
    action: {
      type: "string",
      enum: ["comment", "set_state"],
      description: "Create an issue comment or move the issue to a managed Symphony state label.",
    },
    issue_id: {
      type: "string",
      description: "GitHub issue number as a string, with or without a leading #.",
    },
    body: {
      type: "string",
      description: "Comment body for action=comment.",
    },
    state: {
      type: "string",
      description: "Target GitHub Symphony state label for action=set_state, e.g. symphony:human-review.",
    },
  },
} as const;

export interface SymphonyRuntime {
  start(): Promise<void>;
  runOnce(): Promise<void>;
  stop(): Promise<void>;
  orchestrator: SymphonyOrchestrator;
}

export function createTracker(config: ReturnType<typeof buildSymphonyConfig>): Tracker {
  switch (config.tracker.kind) {
    case "memory":
      return new MemoryTracker();
    case "github":
      return new GitHubTracker(config);
    default:
      return new LinearTracker(config);
  }
}

export function createSymphonyRuntime(workflowPath?: string): SymphonyRuntime {
  ensureSymphonyDirs();
  const definition = loadWorkflow(workflowPath);
  const config = buildSymphonyConfig(definition);
  process.env.SYMPHONY_SOURCE_REPO = process.env.SYMPHONY_SOURCE_REPO || process.cwd();

  const tracker = createTracker(config);

  const dynamicTools: DynamicToolHandler = {
    listTools() {
      switch (config.tracker.kind) {
        case "linear":
          return [
            {
              name: "linear_graphql",
              description: "Execute a raw GraphQL query or mutation against Linear using Symphony's configured auth.",
              inputSchema: LINEAR_GRAPHQL_SCHEMA,
            },
          ];
        case "github":
          return [
            {
              name: "github_issue",
              description: "Comment on a GitHub issue or move it to a Symphony-managed state label.",
              inputSchema: GITHUB_ISSUE_SCHEMA,
            },
          ];
        default:
          return [];
      }
    },
    async execute(tool, arguments_) {
      if (tool === "linear_graphql" && typeof tracker.graphql === "function") {
        const args = arguments_ && typeof arguments_ === "object" ? arguments_ as Record<string, unknown> : {};
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const variables = args.variables && typeof args.variables === "object"
          ? args.variables as Record<string, unknown>
          : {};
        if (!query) {
          return {
            success: false,
            contentItems: [{ type: "inputText", text: JSON.stringify({ error: "query is required" }) }],
          };
        }

        try {
          const response = await tracker.graphql(query, variables);
          return {
            success: true,
            contentItems: [{ type: "inputText", text: JSON.stringify(response, null, 2) }],
          };
        } catch (err: any) {
          return {
            success: false,
            contentItems: [{ type: "inputText", text: JSON.stringify({ error: err.message }) }],
          };
        }
      }

      const args = arguments_ && typeof arguments_ === "object" ? arguments_ as Record<string, unknown> : {};
      if (tool === "github_issue" && config.tracker.kind === "github") {
        const issueId = typeof args.issue_id === "string" ? args.issue_id.trim() : "";
        const action = typeof args.action === "string" ? args.action.trim() : "";
        const body = typeof args.body === "string" ? args.body.trim() : "";
        const state = typeof args.state === "string" ? args.state.trim() : "";

        if (!issueId || !action) {
          return {
            success: false,
            contentItems: [{ type: "inputText", text: JSON.stringify({ error: "action and issue_id are required" }) }],
          };
        }

        try {
          if (action === "comment") {
            if (!body) {
              throw new Error("body is required for comment");
            }
            await tracker.createComment(issueId, body);
            return {
              success: true,
              contentItems: [{ type: "inputText", text: JSON.stringify({ ok: true }) }],
            };
          }

          if (action === "set_state") {
            if (!state) {
              throw new Error("state is required for set_state");
            }
            await tracker.updateIssueState(issueId, state);
            return {
              success: true,
              contentItems: [{ type: "inputText", text: JSON.stringify({ ok: true }) }],
            };
          }

          throw new Error(`unsupported action: ${action}`);
        } catch (err: any) {
          return {
            success: false,
            contentItems: [{ type: "inputText", text: JSON.stringify({ error: err.message }) }],
          };
        }
      }

      return {
        success: false,
        contentItems: [{ type: "inputText", text: JSON.stringify({ error: "Unsupported dynamic tool" }) }],
      };
    },
  };

  const orchestrator = new SymphonyOrchestrator(definition, config, tracker, dynamicTools);
  let server = startSymphonyHttpServer(orchestrator, config.server.host, config.server.port);

  return {
    orchestrator,
    async start() {
      await orchestrator.start();
    },
    async runOnce() {
      await orchestrator.runOnce();
    },
    async stop() {
      await orchestrator.stop();
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
      server = null;
    },
  };
}
