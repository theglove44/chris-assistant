import { buildSymphonyConfig } from "./config.js";
import { startSymphonyHttpServer } from "./http.js";
import { SymphonyOrchestrator } from "./orchestrator.js";
import { ensureSymphonyDirs } from "./paths.js";
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

export interface SymphonyRuntime {
  start(): Promise<void>;
  runOnce(): Promise<void>;
  stop(): Promise<void>;
  orchestrator: SymphonyOrchestrator;
}

export function createSymphonyRuntime(workflowPath?: string): SymphonyRuntime {
  ensureSymphonyDirs();
  const definition = loadWorkflow(workflowPath);
  const config = buildSymphonyConfig(definition);
  process.env.SYMPHONY_SOURCE_REPO = process.env.SYMPHONY_SOURCE_REPO || process.cwd();

  const tracker: Tracker = config.tracker.kind === "memory"
    ? new MemoryTracker()
    : new LinearTracker(config);

  const dynamicTools: DynamicToolHandler = {
    listTools() {
      return [
        {
          name: "linear_graphql",
          description: "Execute a raw GraphQL query or mutation against Linear using Symphony's configured auth.",
          inputSchema: LINEAR_GRAPHQL_SCHEMA,
        },
      ];
    },
    async execute(tool, arguments_) {
      if (tool !== "linear_graphql" || typeof tracker.graphql !== "function") {
        return {
          success: false,
          contentItems: [{ type: "inputText", text: JSON.stringify({ error: "Unsupported dynamic tool" }) }],
        };
      }

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
