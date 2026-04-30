import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { readCodexAuthFile } from "../../codex.js";
import { appendIssueLog } from "../paths.js";
import type {
  AppServerSessionMeta,
  AppServerTurnResult,
  AppServerUpdate,
  DynamicToolHandler,
  Issue,
  SymphonyConfig,
} from "../types.js";
import { buildTurnSandboxPolicy } from "../config.js";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
}

interface PendingTurn {
  turnId: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: AppServerTurnResult) => void;
  reject: (reason?: unknown) => void;
}

type ApprovalDecision = "approved" | "denied";

export class CodexAppServerSession {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private lastTurnStartedAt = 0;
  private threadId: string | null = null;
  private closed = false;
  private pendingTurn: PendingTurn | null = null;

  constructor(
    private readonly config: SymphonyConfig,
    private readonly workspacePath: string,
    private readonly issue: Issue,
    private readonly dynamicTools: DynamicToolHandler,
    private readonly onUpdate?: (update: AppServerUpdate) => void,
  ) {
    this.child = spawn("sh", ["-lc", this.config.codex.command], {
      cwd: this.workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      detached: true,
    });

    this.child.stderr.setEncoding("utf-8");
    this.child.stderr.on("data", (chunk: string) => {
      appendIssueLog(this.issue.identifier, `[stderr] ${chunk.trim()}`);
    });

    this.child.on("exit", (code, signal) => {
      this.closed = true;
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`Codex app-server exited (${code ?? "null"} / ${signal ?? "null"})`));
      }
      this.pending.clear();
    });

    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      this.handleLine(line).catch((err: any) => {
        appendIssueLog(this.issue.identifier, `[protocol-error] ${err.message}`);
      });
    });
  }

  async start(): Promise<AppServerSessionMeta> {
    await this.request("initialize", {
      clientInfo: {
        name: "chris-assistant-symphony",
        title: "Chris Assistant Symphony",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    this.notify("initialized", {});

    const response = await this.request("thread/start", {
      model: this.config.codex.model,
      cwd: this.workspacePath,
      approvalPolicy: this.config.codex.approvalPolicy,
      sandbox: this.config.codex.threadSandbox,
      serviceName: this.config.codex.serviceName,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
      dynamicTools: this.dynamicTools.listTools(),
    });

    const threadId = response?.thread?.id;
    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id");
    }

    this.threadId = threadId;
    return { threadId };
  }

  async runTurn(prompt: string): Promise<AppServerTurnResult> {
    if (!this.threadId) {
      throw new Error("Codex app-server session not started");
    }

    this.lastTurnStartedAt = Date.now();

    const start = await this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt }],
      cwd: this.workspacePath,
      approvalPolicy: this.config.codex.approvalPolicy,
      sandboxPolicy: buildTurnSandboxPolicy(this.config, this.workspacePath),
      model: this.config.codex.model,
      effort: this.config.codex.reasoningEffort,
      summary: "auto",
    });

    const turnId = start?.turn?.id;
    if (!turnId) {
      throw new Error("Codex app-server did not return a turn id");
    }

    return new Promise<AppServerTurnResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Codex turn timed out"));
      }, this.config.codex.turnTimeoutMs);
      this.pendingTurn = { turnId, timeout, resolve, reject };
    });
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    // run-once leaked 40+ codex children over weeks: killing the sh wrapper
    // left codex orphaned. Kill the whole process group so codex dies with sh.
    killProcessTree(this.child.pid);
  }

  private send(payload: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
  }

  private request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    this.send({ method, id, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ method, params });
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    const payload = JSON.parse(trimmed) as Record<string, any>;

    if ("result" in payload || "error" in payload) {
      const pending = this.pending.get(Number(payload.id));
      if (!pending) return;
      this.pending.delete(Number(payload.id));
      if (payload.error) {
        pending.reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      } else {
        pending.resolve(payload.result);
      }
      return;
    }

    if (payload.method && "id" in payload) {
      await this.handleServerRequest(payload);
      return;
    }

    if (payload.method) {
      this.handleNotification(payload);
    }
  }

  private async handleServerRequest(payload: Record<string, any>): Promise<void> {
    const method = String(payload.method);
    const id = payload.id;
    const params = payload.params || {};

    if (method === "item/tool/call") {
      const result = await this.dynamicTools.execute(params.tool, params.arguments);
      this.send({ id, result });
      return;
    }

    if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
      const decision = decideCommandApproval(params, this.workspacePath);
      appendIssueLog(this.issue.identifier, `[approval] ${method} ${decision}`);
      this.send({ id, result: { decision } });
      return;
    }

    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
      const decision = decideFileChangeApproval(params, this.workspacePath);
      appendIssueLog(this.issue.identifier, `[approval] ${method} ${decision}`);
      this.send({ id, result: { decision } });
      return;
    }

    if (method === "skill/requestApproval") {
      this.send({ id, result: { decision: "decline" } });
      return;
    }

    if (method === "item/tool/requestUserInput") {
      const answers = Object.fromEntries(
        (Array.isArray(params.questions) ? params.questions : []).map((question: any) => [
          question.id,
          { answers: ["This is a non-interactive Symphony run. Human input is unavailable."] },
        ]),
      );
      this.send({ id, result: { answers } });
      return;
    }

    if (method === "account/chatgptAuthTokens/refresh") {
      const auth = readCodexAuthFile();
      const accessToken = auth?.tokens?.access_token;
      const chatgptAccountId = auth?.tokens?.account_id;
      if (!accessToken || !chatgptAccountId) {
        this.send({
          id,
          error: { code: -32000, message: "Codex auth refresh unavailable" },
        });
        return;
      }
      this.send({
        id,
        result: {
          accessToken,
          chatgptAccountId,
          chatgptPlanType: null,
        },
      });
      return;
    }

    this.send({
      id,
      error: { code: -32601, message: `Unhandled server request: ${method}` },
    });
  }

  private handleNotification(payload: Record<string, any>): void {
    const method = String(payload.method);
    const params = payload.params || {};

    appendIssueLog(this.issue.identifier, `[${method}] ${JSON.stringify(params).slice(0, 1200)}`);

    if (method === "item/agentMessage/delta") {
      this.onUpdate?.({
        type: method,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        text: params.delta,
        raw: params,
      });
      return;
    }

    if (method === "thread/tokenUsage/updated") {
      this.onUpdate?.({
        type: method,
        threadId: params.threadId,
        turnId: params.turnId,
        tokenUsage: {
          inputTokens: params.tokenUsage?.total?.inputTokens ?? params.tokenUsage?.total?.input_tokens,
          outputTokens: params.tokenUsage?.total?.outputTokens ?? params.tokenUsage?.total?.output_tokens,
          totalTokens: params.tokenUsage?.total?.totalTokens ?? params.tokenUsage?.total?.total_tokens,
        },
        raw: params,
      });
      return;
    }

    if (method === "turn/completed") {
      const update = {
        type: "turn.completed",
        threadId: params.threadId,
        turnId: params.turn?.id,
        text: params.turn?.lastAgentMessage || params.turn?.last_agent_message || null,
        raw: params,
      } satisfies AppServerUpdate;
      this.onUpdate?.(update);
      if (this.pendingTurn && this.pendingTurn.turnId === update.turnId) {
        clearTimeout(this.pendingTurn.timeout);
        this.pendingTurn.resolve({
          turnId: update.turnId || "",
          lastAgentMessage: update.text || null,
        });
        this.pendingTurn = null;
      }
      return;
    }

    if (method === "error") {
      const update = {
        type: "turn.failed",
        text: params.message || "Codex error",
        raw: params,
      } satisfies AppServerUpdate;
      this.onUpdate?.(update);
      if (this.pendingTurn) {
        clearTimeout(this.pendingTurn.timeout);
        this.pendingTurn.reject(new Error(update.text || "Codex error"));
        this.pendingTurn = null;
      }
      return;
    }

    this.onUpdate?.({ type: method, raw: params });
  }
}

export function decideCommandApproval(params: Record<string, any>, workspacePath: string): ApprovalDecision {
  if (hasAdditionalPermissions(params)) {
    return "denied";
  }

  const actions = extractCommandActions(params);
  if (actions.length === 0) {
    return "denied";
  }

  const safeTypes = new Set(["read", "listFiles", "search"]);
  for (const action of actions) {
    const type = typeof action?.type === "string" ? action.type : "";
    if (!safeTypes.has(type)) {
      return "denied";
    }

    const candidatePaths = extractPaths(action);
    if (candidatePaths.some((candidatePath) => !isPathInsideWorkspace(candidatePath, workspacePath))) {
      return "denied";
    }
  }

  return "approved";
}

export function decideFileChangeApproval(params: Record<string, any>, workspacePath: string): ApprovalDecision {
  if (hasAdditionalPermissions(params)) {
    return "denied";
  }

  if (extractGrantRoots(params).length > 0) {
    return "denied";
  }

  const candidatePaths = extractPaths(params);
  if (candidatePaths.some((candidatePath) => !isPathInsideWorkspace(candidatePath, workspacePath))) {
    return "denied";
  }

  return "approved";
}

function extractCommandActions(params: Record<string, any>): Array<Record<string, any>> {
  const candidates = [
    params.commandActions,
    params.command_actions,
    params.actions,
    params.review?.commandActions,
    params.review?.command_actions,
    params.request?.commandActions,
    params.request?.command_actions,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((entry): entry is Record<string, any> => !!entry && typeof entry === "object");
    }
  }

  return [];
}

function extractGrantRoots(params: Record<string, any>): string[] {
  const results = new Set<string>();
  const candidates = [
    params.grantRoot,
    params.grant_root,
    params.grantRoots,
    params.grant_roots,
    params.writableRoots,
    params.writable_roots,
    params.review?.grantRoot,
    params.review?.grant_root,
    params.review?.grantRoots,
    params.review?.grant_roots,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      results.add(candidate.trim());
      continue;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        if (typeof entry === "string" && entry.trim()) {
          results.add(entry.trim());
        }
      }
    }
  }

  return Array.from(results);
}

function hasAdditionalPermissions(params: Record<string, any>): boolean {
  const candidates = [
    params.additionalPermissions,
    params.additional_permissions,
    params.additionalPermissionProfiles,
    params.additional_permission_profiles,
    params.permissionRequest,
    params.permission_request,
    params.review?.additionalPermissions,
    params.review?.additional_permissions,
  ];

  return candidates.some(hasMeaningfulPermissionRequest);
}

function hasMeaningfulPermissionRequest(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulPermissionRequest);
  if (typeof value !== "object") return false;

  return Object.values(value).some((entry) => {
    if (typeof entry === "boolean") return entry;
    if (typeof entry === "string") return entry.trim().length > 0;
    if (Array.isArray(entry)) return entry.some(hasMeaningfulPermissionRequest);
    if (entry && typeof entry === "object") return hasMeaningfulPermissionRequest(entry);
    return false;
  });
}

function extractPaths(value: unknown): string[] {
  const results = new Set<string>();
  collectPaths(value, results, 0);
  return Array.from(results);
}

function collectPaths(value: unknown, results: Set<string>, depth: number): void {
  if (!value || depth > 4) return;

  if (typeof value === "string") {
    if (looksLikePath(value)) {
      results.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, results, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    if (!entry) continue;

    if (
      typeof entry === "string" &&
      /(^|_|-)(path|file|root|cwd|target|destination|source|from|to)$/i.test(key) &&
      looksLikePath(entry)
    ) {
      results.add(entry);
      continue;
    }

    collectPaths(entry, results, depth + 1);
  }
}

function looksLikePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes("\n")) return false;
  if (trimmed === "." || trimmed === ".." || trimmed.startsWith("/") || trimmed.startsWith("~/")) return true;
  return trimmed.includes("/") || trimmed.includes("\\") || trimmed.startsWith(".");
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    // Negative pid targets the whole process group created by detached:true.
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already exited
    }
  }
}

function isPathInsideWorkspace(candidatePath: string, workspacePath: string): boolean {
  const normalizedWorkspace = path.resolve(workspacePath);
  const expandedPath = candidatePath.startsWith("~")
    ? path.join(process.env.HOME || "", candidatePath.slice(1))
    : candidatePath;
  const resolvedCandidate = path.resolve(normalizedWorkspace, expandedPath);
  const relative = path.relative(normalizedWorkspace, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
