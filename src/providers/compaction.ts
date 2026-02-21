/**
 * Context compaction — summarizes older conversation turns when approaching
 * the model's context window limit, allowing the tool loop to continue
 * indefinitely instead of hitting a hard turn ceiling.
 */

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getModelLimits } from "./context-limits.js";

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

/** Check whether compaction is needed for the given model and messages. */
export function needsCompaction(model: string, messages: ChatCompletionMessageParam[]): boolean {
  const { compactionThreshold } = getModelLimits(model);
  return estimateTokens(messages) > compactionThreshold;
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
  const serialized = middle
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
