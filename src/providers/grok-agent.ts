import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "child_process";
import { createInterface } from "readline";
import * as os from "os";
import { config } from "../config.js";
import { resolveGrokBinary } from "../grok.js";
import { getGrokSessionId, setGrokSessionId } from "../grok-sessions.js";
import { getWorkspaceRoot } from "../tools/files.js";
import type { ImageAttachment, Provider } from "./types.js";
import { resolveReasoningEffort } from "./model-routing.js";
import { buildAgentEnvironment } from "./agent-environment.js";

const DEFAULT_MODEL = "grok-4.5";
const MAX_AGENT_TURNS = 32;
const MAX_STDERR_CHARS = 4_096;

type SpawnGrok = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

interface GrokModelSpec {
  model: string;
  effort?: string;
}

interface ParsedGrokLine {
  delta?: string;
  messageText?: string;
  sessionId?: string;
}

interface RunGrokOptions {
  binaryPath: string;
  cwd: string;
  prompt: string;
  model: string;
  effort?: string;
  sessionId?: string | null;
  maxTurns: number;
  signal: AbortSignal;
  onText?: (accumulated: string) => void;
}

interface RunGrokResult {
  text: string;
  sessionId: string | null;
}

const activeControllers = new Map<number, AbortController>();

export function parseGrokAgentModel(model: string): GrokModelSpec {
  const raw = model.replace(/^grok-agent-?/i, "") || DEFAULT_MODEL;
  return { model: raw };
}

export function parseGrokStreamLine(line: string): ParsedGrokLine {
  let parsed: any;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {};
  }

  const event = parsed.type === "stream_event" ? parsed.event : parsed;
  const delta = event?.type === "content_block_delta" && event.delta?.type === "text_delta"
    ? event.delta.text
    : undefined;
  const message = parsed.type === "assistant" ? parsed.message : event?.type === "message" ? event.message : undefined;
  const messageText = Array.isArray(message?.content)
    ? message.content
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("")
    : undefined;
  const resultText = parsed.type === "result" && typeof parsed.result === "string" ? parsed.result : undefined;
  const sessionId = [parsed.session_id, parsed.sessionId, parsed.message?.session_id, event?.session_id]
    .find((value) => typeof value === "string");

  return { delta, messageText: messageText || resultText, sessionId };
}

export function redactGrokDiagnostic(value: string): string {
  const redacted = value
    .replaceAll(os.homedir(), "~")
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/(authorization|bearer|token|secret|cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
    .slice(0, MAX_STDERR_CHARS);
  if (/not logged in|authentication|login required/i.test(redacted)) return "authentication required";
  if (/model.+(?:not available|not found)|couldn.t set model/i.test(redacted)) return "requested model unavailable";
  if (/sandbox.+(?:failed|could not|refus)/i.test(redacted)) return "sandbox could not be applied";
  if (/permission denied|operation not permitted/i.test(redacted)) return "permission denied";
  return "diagnostic output redacted";
}

export function buildGrokArgs(options: Omit<RunGrokOptions, "binaryPath" | "cwd" | "signal" | "onText">): string[] {
  const args = [
    "--prompt-file", "/dev/stdin",
    "--output-format", "streaming-messages-json",
    "--include-partial-messages",
    "--model", options.model,
    "--max-turns", String(options.maxTurns),
    "--permission-mode", "dontAsk",
    "--sandbox", "workspace",
    "--no-memory",
    "--no-subagents",
    "--disable-web-search",
    "--no-wait-for-background",
    "--no-auto-update",
    "--verbatim",
  ];
  if (options.effort) args.push("--reasoning-effort", options.effort);
  if (options.sessionId) args.push("--resume", options.sessionId);
  return args;
}

export async function runGrokHeadless(
  options: RunGrokOptions,
  spawnGrok: SpawnGrok = spawn,
): Promise<RunGrokResult> {
  const child = spawnGrok(options.binaryPath, buildGrokArgs(options), {
    cwd: options.cwd,
    env: buildAgentEnvironment(),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(options.prompt);
  let text = "";
  let sessionId: string | null = options.sessionId ?? null;
  let stderr = "";
  let killTimer: NodeJS.Timeout | null = null;

  const abort = () => {
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    killTimer.unref();
  };
  options.signal.addEventListener("abort", abort, { once: true });

  const stdout = createInterface({ input: child.stdout });
  stdout.on("line", (line) => {
    const parsed = parseGrokStreamLine(line);
    if (parsed.sessionId) sessionId = parsed.sessionId;
    if (parsed.delta) text += parsed.delta;
    if (parsed.messageText && parsed.messageText !== text) text = parsed.messageText;
    if ((parsed.delta || parsed.messageText) && text) options.onText?.(text);
  });
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS);
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  options.signal.removeEventListener("abort", abort);
  stdout.close();
  if (killTimer) clearTimeout(killTimer);
  if (options.signal.aborted) throw new Error("Grok request cancelled");
  if (exitCode !== 0) {
    throw new Error(`Grok exited with code ${exitCode}: ${redactGrokDiagnostic(stderr || "no diagnostic output")}`);
  }
  return { text, sessionId };
}

export function abortGrokQuery(chatId?: number): boolean {
  if (chatId !== undefined) {
    const controller = activeControllers.get(chatId);
    if (!controller) return false;
    controller.abort();
    activeControllers.delete(chatId);
    return true;
  }
  if (activeControllers.size === 0) return false;
  for (const controller of activeControllers.values()) controller.abort();
  activeControllers.clear();
  return true;
}

export function createGrokAgentProvider(model: string): Provider {
  return {
    name: "grok-agent",
    async chat(chatId, userMessage, onChunk, images?: ImageAttachment[], _allowedTools?: string[], maxTurns?: number) {
      const binaryPath = resolveGrokBinary();
      if (!binaryPath) return "Grok CLI is unavailable. Run `chris doctor` for setup details.";

      let spec: GrokModelSpec;
      try {
        spec = parseGrokAgentModel(model);
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid Grok model configuration.";
      }

      const controller = new AbortController();
      activeControllers.get(chatId)?.abort();
      activeControllers.set(chatId, controller);
      const imageNote = images?.length
        ? `[${images.length} image(s) were attached, but Grok agent mode is text-only here.]\n\n`
        : "";
      const sessionId = chatId === 0 ? null : getGrokSessionId(chatId);
      const boundedTurns = Math.max(1, Math.min(maxTurns ?? config.maxToolTurns, MAX_AGENT_TURNS));

      try {
        const result = await runGrokHeadless({
          binaryPath,
          cwd: getWorkspaceRoot(),
          prompt: `${imageNote}${userMessage}`,
          model: spec.model,
          effort: resolveReasoningEffort(model, config.reasoningEffort)?.effective ?? undefined,
          sessionId,
          maxTurns: boundedTurns,
          signal: controller.signal,
          onText: onChunk,
        });
        if (chatId !== 0 && result.sessionId) setGrokSessionId(chatId, result.sessionId);
        return result.text || "Grok completed without returning text.";
      } catch (error) {
        if (controller.signal.aborted) return "Stopped.";
        console.error("[grok-agent] %s", redactGrokDiagnostic(error instanceof Error ? error.message : String(error)));
        return "Sorry, Grok hit an error processing that. Run `chris doctor` if it persists.";
      } finally {
        if (activeControllers.get(chatId) === controller) activeControllers.delete(chatId);
      }
    },
  };
}
