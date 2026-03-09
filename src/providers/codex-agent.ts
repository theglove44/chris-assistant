import { Codex, type ThreadItem } from "@openai/codex-sdk";
import * as os from "os";
import * as path from "path";
import { resolveCodexBinary } from "../codex.js";
import { getThreadId, setThreadId } from "../codex-sessions.js";
import { getWorkspaceRoot } from "../tools/files.js";
import { getCodexSystemPrompt, invalidatePromptCache } from "./shared.js";
import type { ImageAttachment, Provider } from "./types.js";

const activeControllers = new Map<number, AbortController>();

let codexInstance: Codex | null = null;

function getCodex(): Codex {
  if (codexInstance) return codexInstance;

  codexInstance = new Codex({
    codexPathOverride: resolveCodexBinary() ?? undefined,
  });

  return codexInstance;
}

function underlyingModel(model: string): string {
  return model.replace(/^codex-agent-?/, "") || "o4-mini";
}

function buildThreadOptions(model: string) {
  return {
    model: underlyingModel(model),
    approvalPolicy: "on-request" as const,
    sandboxMode: "workspace-write" as const,
    networkAccessEnabled: true,
    skipGitRepoCheck: true,
    workingDirectory: getWorkspaceRoot(),
    additionalDirectories: [path.join(os.homedir(), ".chris-assistant")],
  };
}

function maybeExtractAgentText(item: ThreadItem): string | null {
  return item.type === "agent_message" && item.text ? item.text : null;
}

export function abortCodexQuery(chatId?: number): boolean {
  if (chatId !== undefined) {
    const controller = activeControllers.get(chatId);
    if (!controller) return false;
    controller.abort();
    activeControllers.delete(chatId);
    return true;
  }

  if (activeControllers.size === 0) return false;
  for (const controller of activeControllers.values()) {
    controller.abort();
  }
  activeControllers.clear();
  return true;
}

export function createCodexAgentProvider(model: string): Provider {
  return {
    name: "codex-agent",
    async chat(chatId, userMessage, onChunk, images?: ImageAttachment[]) {
      const codex = getCodex();
      const existingThreadId = chatId !== 0 ? getThreadId(chatId) : null;
      const options = buildThreadOptions(model);
      const thread = existingThreadId
        ? codex.resumeThread(existingThreadId, options)
        : codex.startThread(options);

      const abortController = new AbortController();
      activeControllers.set(chatId, abortController);

      const imageNote = images && images.length > 0
        ? `[${images.length} image(s) were attached, but this Codex agent mode is running text-only here. The user's caption follows.]\n\n`
        : "";
      const systemContext = existingThreadId ? "" : `<system>\n${await getCodexSystemPrompt()}\n</system>\n\n`;
      const prompt = `${systemContext}${imageNote}${userMessage}`;

      let latestText = "";

      try {
        const { events } = await thread.runStreamed(prompt, { signal: abortController.signal });

        for await (const event of events) {
          if (event.type !== "item.updated" && event.type !== "item.completed") continue;
          const text = maybeExtractAgentText(event.item);
          if (!text) continue;
          latestText = text;
          onChunk?.(text);
        }

        if (chatId !== 0 && thread.id) {
          setThreadId(chatId, thread.id);
        }
      } catch (err: any) {
        if (abortController.signal.aborted) {
          latestText = latestText || "Stopped.";
        } else {
          console.error("[codex-agent] Error:", err.message);
          latestText = latestText || "Sorry, I hit an error processing that. Try again in a moment.";
        }
      } finally {
        activeControllers.delete(chatId);
      }

      invalidatePromptCache();
      return latestText;
    },
  };
}
