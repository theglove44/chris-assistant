import * as os from "os";
import * as path from "path";
import { resolveCodexBinary } from "../codex.js";
import { SYMPHONY_HOME } from "./paths.js";
import type { CodexApprovalPolicy, SymphonyConfig, WorkflowDefinition } from "./types.js";

const DEFAULT_ACTIVE_STATES = ["Todo", "In Progress"];
const DEFAULT_TERMINAL_STATES = ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"];

function section(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = config[key];
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function listValue(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const next = value.map((entry) => String(entry).trim()).filter(Boolean);
    return next.length > 0 ? next : fallback;
  }
  return fallback;
}

function intValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function boolLikePath(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  const envExpanded = raw.startsWith("$") ? process.env[raw.slice(1)] || fallback : raw;
  return envExpanded.startsWith("~")
    ? path.join(os.homedir(), envExpanded.slice(1))
    : envExpanded;
}

function approvalPolicyValue(value: unknown): CodexApprovalPolicy {
  if (
    value === "untrusted" ||
    value === "on-failure" ||
    value === "on-request" ||
    value === "never"
  ) {
    return value;
  }

  if (value && typeof value === "object" && "reject" in (value as Record<string, unknown>)) {
    return value as CodexApprovalPolicy;
  }

  return {
    reject: {
      sandbox_approval: true,
      rules: true,
      mcp_elicitations: true,
    },
  };
}

export function buildSymphonyConfig(definition: WorkflowDefinition): SymphonyConfig {
  const tracker = section(definition.config, "tracker");
  const polling = section(definition.config, "polling");
  const workspace = section(definition.config, "workspace");
  const landing = section(definition.config, "landing");
  const hooks = section(definition.config, "hooks");
  const agent = section(definition.config, "agent");
  const codex = section(definition.config, "codex");
  const server = section(definition.config, "server");

  const resolvedConfig: SymphonyConfig = {
    workflowPath: definition.path,
    tracker: {
      kind: trackerKindValue(stringValue(tracker.kind)),
      endpoint: stringValue(tracker.endpoint) || "https://api.linear.app/graphql",
      apiKey: stringValue(tracker.api_key) || process.env.LINEAR_API_KEY || null,
      projectSlug: stringValue(tracker.project_slug),
      repo: stringValue(tracker.repo) || process.env.SYMPHONY_GITHUB_REPO || null,
      assignee: stringValue(tracker.assignee) || process.env.SYMPHONY_TRACKER_ASSIGNEE || process.env.LINEAR_ASSIGNEE || null,
      activeStates: listValue(tracker.active_states, DEFAULT_ACTIVE_STATES),
      terminalStates: listValue(tracker.terminal_states, DEFAULT_TERMINAL_STATES),
    },
    polling: {
      intervalMs: intValue(polling.interval_ms, 30_000),
    },
    workspace: {
      root: path.resolve(boolLikePath(stringValue(workspace.root), path.join(SYMPHONY_HOME, "workspaces"))),
    },
    landing: {
      enabled: boolValue(landing.enabled, false),
      triggerState: stringValue(landing.trigger_state) || "symphony:human-review",
      baseBranch: stringValue(landing.base_branch),
      branchPrefix: stringValue(landing.branch_prefix) || "codex/symphony/",
      draft: boolValue(landing.draft, true),
      commitMessageTemplate: stringValue(landing.commit_message)
        || "chore: Symphony landing for {{ issue.identifier }}",
      pullRequestTitleTemplate: stringValue(landing.pull_request_title)
        || "{{ issue.identifier }} {{ issue.title }}",
      pullRequestBodyTemplate: stringValue(landing.pull_request_body)
        || [
          "## Summary",
          "",
          "Automated Symphony landing for {{ issue.identifier }}.",
          "",
          "## Latest Agent Summary",
          "",
          "{{ last_agent_message | default: \"No agent summary provided.\" }}",
          "",
          "Refs {{ issue.identifier }}",
        ].join("\n"),
      authorName: stringValue(landing.author_name) || "Symphony Bot",
      authorEmail: stringValue(landing.author_email) || "symphony-bot@users.noreply.github.com",
    },
    hooks: {
      afterCreate: stringValue(hooks.after_create),
      beforeRun: stringValue(hooks.before_run),
      afterRun: stringValue(hooks.after_run),
      beforeRemove: stringValue(hooks.before_remove),
      timeoutMs: intValue(hooks.timeout_ms, 60_000),
    },
    agent: {
      maxConcurrentAgents: intValue(agent.max_concurrent_agents, 2),
      maxTurns: intValue(agent.max_turns, 20),
      maxRetryBackoffMs: intValue(agent.max_retry_backoff_ms, 300_000),
    },
    codex: {
      command: stringValue(codex.command) || `${resolveCodexBinary() || "codex"} app-server`,
      model: stringValue(codex.model),
      reasoningEffort: (stringValue(codex.reasoning_effort) as SymphonyConfig["codex"]["reasoningEffort"]) || null,
      approvalPolicy: approvalPolicyValue(codex.approval_policy),
      threadSandbox: (stringValue(codex.thread_sandbox) as SymphonyConfig["codex"]["threadSandbox"]) || "workspace-write",
      turnTimeoutMs: intValue(codex.turn_timeout_ms, 3_600_000),
      readTimeoutMs: intValue(codex.read_timeout_ms, 5_000),
      stallTimeoutMs: intValue(codex.stall_timeout_ms, 300_000),
      serviceName: stringValue(codex.service_name) || "chris-assistant-symphony",
    },
    server: {
      host: stringValue(server.host) || "127.0.0.1",
      port: typeof server.port === "number" ? Math.trunc(server.port) : 3010,
    },
  };

  validateSymphonyConfig(resolvedConfig);
  return resolvedConfig;
}

export function buildTurnSandboxPolicy(config: SymphonyConfig, workspacePath: string): Record<string, unknown> {
  switch (config.codex.threadSandbox) {
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    case "read-only":
      return { type: "readOnly", access: { type: "restricted" } };
    default:
      return {
        type: "workspaceWrite",
        writableRoots: [workspacePath],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
  }
}

export function validateSymphonyConfig(config: SymphonyConfig): void {
  if (config.tracker.kind === "linear") {
    if (!config.tracker.apiKey) {
      throw new Error("Missing tracker.api_key or LINEAR_API_KEY for Symphony");
    }
    if (!config.tracker.projectSlug) {
      throw new Error("Missing tracker.project_slug in WORKFLOW.md");
    }
  }

  if (config.tracker.kind === "github" && !config.tracker.repo) {
    throw new Error("Missing tracker.repo or SYMPHONY_GITHUB_REPO in WORKFLOW.md");
  }

  if (config.landing.enabled && config.tracker.kind !== "github") {
    throw new Error("landing.enabled currently requires tracker.kind: github");
  }

  if (config.landing.enabled && !config.landing.branchPrefix.startsWith("codex/")) {
    throw new Error("landing.branch_prefix must start with codex/");
  }

  if (!config.codex.command.trim()) {
    throw new Error("Missing codex.command in WORKFLOW.md");
  }
}

function trackerKindValue(value: string | null): SymphonyConfig["tracker"]["kind"] {
  switch ((value || "").trim().toLowerCase()) {
    case "memory":
      return "memory";
    case "github":
      return "github";
    default:
      return "linear";
  }
}
