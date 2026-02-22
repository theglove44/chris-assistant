/**
 * Context compaction — summarizes older conversation turns when approaching
 * the model's context window limit, allowing the tool loop to continue
 * indefinitely instead of hitting a hard turn ceiling.
 */

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getModelLimits } from "./context-limits.js";

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token estimate: ~3.5 characters per token. Conservative to trigger early. */
export function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ("text" in part) chars += part.text.length;
      }
    }
    // Count tool call arguments
    if ("tool_calls" in msg && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if ("function" in tc && tc.function) {
          chars += (tc.function.name.length + tc.function.arguments.length);
        }
      }
    }
  }
  return Math.ceil(chars / 3.5);
}

/** Estimate tokens for Codex Responses API input items. */
function estimateCodexTokens(input: any[]): number {
  let chars = 0;
  for (const item of input) {
    if (item.content && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.text) chars += part.text.length;
      }
    }
    if (item.arguments) chars += item.arguments.length;
    if (item.output) chars += item.output.length;
    if (item.name) chars += item.name.length;
  }
  return Math.ceil(chars / 3.5);
}

// ---------------------------------------------------------------------------
// Compaction checks (overloaded for both formats)
// ---------------------------------------------------------------------------

/** Check whether compaction is needed for Chat Completions messages. */
export function needsCompaction(model: string, messages: ChatCompletionMessageParam[]): boolean;
/** Check whether compaction is needed for Codex Responses API input. */
export function needsCompaction(model: string, input: any[]): boolean;
export function needsCompaction(model: string, data: any[]): boolean {
  const { compactionThreshold } = getModelLimits(model);
  // Detect format: Chat Completions messages have `role` at top level without `type`
  if (data.length > 0 && "role" in data[0] && !("type" in data[0]) && data[0].role === "system") {
    return estimateTokens(data) > compactionThreshold;
  }
  return estimateCodexTokens(data) > compactionThreshold;
}

const COMPACTION_PROMPT = `You are a context compaction assistant. Summarize the conversation history below into a structured checkpoint. Be thorough — preserve all important details, findings, file paths, command outputs, error messages, and decisions. This summary replaces the original messages, so nothing important should be lost.

Format your response exactly as:

## Goal
[What the user originally asked for]

## Progress
[Bullet list of what has been accomplished so far]

## Key Findings
[Important details, file contents, command outputs, error messages discovered]

## Current State
[Where things stand right now — what was the last action taken]

## Open Issues
[Any unresolved problems, errors, or next steps identified]`;

// ---------------------------------------------------------------------------
// Chat Completions compaction (used by MiniMax)
// ---------------------------------------------------------------------------

/**
 * Compact the messages array by summarizing older turns into a checkpoint.
 * Keeps: system prompt (index 0) + original user message (index 1) at front,
 * and the last `keepRecentTurns` assistant/tool exchanges at the end.
 * Everything in between is summarized.
 */
export async function compactMessages(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  providerName: string,
  keepRecentTurns = 4,
): Promise<ChatCompletionMessageParam[]> {
  // Need at least: system + user + some middle + recent turns to compact
  if (messages.length < keepRecentTurns + 4) {
    return messages; // Not enough messages to compact
  }

  const prefix = messages.slice(0, 2); // system + original user message
  const middle = messages.slice(2, -keepRecentTurns);
  const recent = messages.slice(-keepRecentTurns);

  if (middle.length < 2) {
    return messages; // Nothing meaningful to compact
  }

  const estimated = estimateTokens(messages);
  console.log(
    `[${providerName}] Context at ~${Math.round(estimated / 1000)}k tokens, compacting ${middle.length} messages...`,
  );

  // Serialize middle messages into readable text
  const serialized = serializeMessages(middle);

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: COMPACTION_PROMPT },
        { role: "user", content: serialized },
      ],
      stream: false,
    });

    const summary = response.choices[0]?.message?.content || "[compaction failed]";
    console.log(`[${providerName}] Compaction complete, reduced ${middle.length} messages to checkpoint`);

    return [
      ...prefix,
      {
        role: "user" as const,
        content: `[CONTEXT CHECKPOINT — this summarizes our earlier conversation]\n\n${summary}`,
      },
      ...recent,
    ];
  } catch (error: any) {
    console.error(`[${providerName}] Compaction failed:`, error.message);
    return messages; // Continue with original messages if compaction fails
  }
}

function serializeMessages(messages: ChatCompletionMessageParam[]): string {
  return messages
    .map((msg) => {
      const role = msg.role.toUpperCase();
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((p) => ("text" in p ? p.text : "[non-text content]"))
          .join("\n");
      }
      if ("tool_calls" in msg && msg.tool_calls) {
        const calls = msg.tool_calls
          .filter((tc): tc is typeof tc & { function: { name: string; arguments: string } } =>
            "function" in tc && !!tc.function)
          .map((tc) => `  → ${tc.function.name}(${tc.function.arguments.slice(0, 200)})`)
          .join("\n");
        content += "\n" + calls;
      }
      // Truncate very long messages (e.g. large file contents)
      if (content.length > 5000) {
        content = content.slice(0, 5000) + "\n[...truncated...]";
      }
      return `[${role}]: ${content}`;
    })
    .join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Codex Responses API compaction (used by OpenAI provider)
// ---------------------------------------------------------------------------

const CODEX_COMPACTION_URL = "https://chatgpt.com/backend-api/codex/responses";

/**
 * Compact the Codex Responses API input array by summarizing older items.
 * Keeps: original user message (index 0) at front,
 * and the last `keepRecentItems` at the end.
 */
export async function compactCodexInput(
  model: string,
  systemPrompt: string,
  input: any[],
  accessToken: string,
  accountId: string | undefined,
  keepRecentItems = 6,
): Promise<any[]> {
  if (input.length < keepRecentItems + 3) {
    return input;
  }

  const prefix = input.slice(0, 1); // original user message
  const middle = input.slice(1, -keepRecentItems);
  const recent = input.slice(-keepRecentItems);

  if (middle.length < 2) {
    return input;
  }

  const estimated = estimateCodexTokens(input);
  console.log(
    `[openai] Context at ~${Math.round(estimated / 1000)}k tokens, compacting ${middle.length} items...`,
  );

  // Serialize middle items into readable text
  const serialized = serializeCodexItems(middle);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "OpenAI-Beta": "responses=experimental",
    };
    if (accountId) {
      headers["chatgpt-account-id"] = accountId;
    }

    const res = await fetch(CODEX_COMPACTION_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        instructions: COMPACTION_PROMPT,
        input: [{ role: "user", content: [{ type: "input_text", text: serialized }] }],
        stream: true,
        store: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Compaction request failed (${res.status}): ${errText}`);
    }

    // Parse SSE stream to collect the full response text
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body from compaction");

    const decoder = new TextDecoder();
    let sseBuffer = "";
    let summary = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const event = JSON.parse(jsonStr);
          if (event.type === "response.output_text.delta") {
            summary += event.delta || "";
          }
        } catch {}
      }
    }

    if (!summary) summary = "[compaction failed]";

    console.log(`[openai] Compaction complete, reduced ${middle.length} items to checkpoint`);

    return [
      ...prefix,
      {
        role: "user",
        content: [{
          type: "input_text",
          text: `[CONTEXT CHECKPOINT — this summarizes our earlier conversation]\n\n${summary}`,
        }],
      },
      ...recent,
    ];
  } catch (error: any) {
    console.error("[openai] Compaction failed:", error.message);
    return input;
  }
}

function serializeCodexItems(items: any[]): string {
  return items
    .map((item) => {
      if (item.role === "user" && item.content) {
        const text = item.content
          .map((p: any) => p.text || "[non-text content]")
          .join("\n");
        return `[USER]: ${truncate(text)}`;
      }
      if (item.type === "message" && item.role === "assistant") {
        const text = item.content
          ?.map((p: any) => p.text || "")
          .join("\n") || "";
        return `[ASSISTANT]: ${truncate(text)}`;
      }
      if (item.type === "function_call") {
        return `[TOOL CALL]: ${item.name}(${(item.arguments || "").slice(0, 200)})`;
      }
      if (item.type === "function_call_output") {
        return `[TOOL RESULT]: ${truncate(item.output || "")}`;
      }
      return `[UNKNOWN]: ${JSON.stringify(item).slice(0, 200)}`;
    })
    .join("\n\n---\n\n");
}

function truncate(text: string, max = 5000): string {
  return text.length > max ? text.slice(0, max) + "\n[...truncated...]" : text;
}
