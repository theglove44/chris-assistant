import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { appendIssueLog } from "../paths.js";
import type {
  AppServerSessionMeta,
  AppServerTurnResult,
  AppServerUpdate,
  DynamicToolHandler,
  Issue,
  SymphonyConfig,
} from "../types.js";

function buildZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const properties = (schema.properties as Record<string, unknown>) ?? {};
  return Object.fromEntries(Object.keys(properties).map((key) => [key, z.any()]));
}

const MCP_SERVER_NAME = "symphony-tools";

const BLOCKED_BASH_PATTERNS = [
  /\bpm2\b/i,
  /\bkill\b.*chris-assistant/i,
  /\bsystemctl\b.*(restart|stop|disable)/i,
  /\breboot\b/,
  /\bshutdown\b/,
  /\brm\s+-rf\s+[/~]/,
];

async function safetyHook(input: any): Promise<any> {
  if (input.hook_event_name !== "PreToolUse") return { continue: true };
  if (input.tool_name !== "Bash") return { continue: true };
  const command = input.tool_input?.command;
  if (typeof command !== "string") return { continue: true };
  for (const pattern of BLOCKED_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Blocked: command matches dangerous pattern (${pattern.source}). Symphony agents cannot restart or destroy host processes.`,
        },
      };
    }
  }
  return { continue: true };
}

export class ClaudeCodeSession {
  private readonly sessionId: string;
  private abortController: AbortController | null = null;
  private stopped = false;

  constructor(
    private readonly config: SymphonyConfig,
    private readonly workspacePath: string,
    private readonly issue: Issue,
    private readonly dynamicTools: DynamicToolHandler,
    private readonly onUpdate?: (update: AppServerUpdate) => void,
  ) {
    this.sessionId = `claude-${issue.identifier}-${Date.now()}`;
  }

  async start(): Promise<AppServerSessionMeta> {
    return { threadId: this.sessionId };
  }

  async runTurn(prompt: string): Promise<AppServerTurnResult> {
    const turnId = `${this.sessionId}-turn-${Date.now()}`;
    this.abortController = new AbortController();
    this.stopped = false;

    const toolList = this.dynamicTools.listTools();
    const mcpTools = toolList.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: buildZodShape(tool.inputSchema as Record<string, unknown>),
      handler: async (args: Record<string, unknown>) => {
        try {
          const result = await this.dynamicTools.execute(tool.name, args);
          const text = typeof result === "string" ? result : JSON.stringify(result);
          return { content: [{ type: "text" as const, text }] };
        } catch (err: any) {
          appendIssueLog(this.issue.identifier, `[claude-tool-error] ${tool.name}: ${err.message}`);
          return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
        }
      },
    }));

    const toolServer = mcpTools.length > 0
      ? createSdkMcpServer({ name: MCP_SERVER_NAME, tools: mcpTools })
      : null;

    const cc = this.config.claudeCode;
    let lastAgentMessage: string | null = null;

    try {
      const conversation = query({
        prompt,
        options: {
          model: cc.model,
          cwd: this.workspacePath,
          tools: { type: "preset", preset: "claude_code" },
          allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
          ...(toolServer ? { mcpServers: { [MCP_SERVER_NAME]: toolServer } } : {}),
          ...(cc.maxTurnsPerQuery !== null ? { maxTurns: cc.maxTurnsPerQuery } : {}),
          ...(cc.systemPromptAppend
            ? {
                systemPrompt: {
                  type: "preset" as const,
                  preset: "claude_code" as const,
                  append: cc.systemPromptAppend,
                },
              }
            : {}),
          abortController: this.abortController,
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } as any);

      for await (const message of conversation) {
        if (this.stopped) break;

        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "text" && block.text) {
              lastAgentMessage = block.text;
              this.onUpdate?.({
                type: "item/agentMessage/delta",
                threadId: this.sessionId,
                turnId,
                text: block.text,
              });
            }
          }
        }

        if (message.type === "result") {
          const result = message as any;
          if (result.subtype === "success" && result.result) {
            lastAgentMessage = result.result as string;
          }
          appendIssueLog(
            this.issue.identifier,
            `[claude-turn] subtype=${result.subtype} turns=${result.num_turns ?? "?"}`,
          );
          this.onUpdate?.({
            type: "turn.completed",
            threadId: this.sessionId,
            turnId,
            text: lastAgentMessage ?? undefined,
          });
        }
      }
    } catch (err: any) {
      if (this.stopped || err.name === "AbortError") {
        throw err;
      }
      appendIssueLog(this.issue.identifier, `[claude-session-error] ${err.message}`);
      throw err;
    }

    return { turnId, lastAgentMessage };
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
  }

  forceKill(): void {
    this.stop();
  }
}
