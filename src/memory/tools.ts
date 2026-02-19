import { writeMemoryFile, appendToMemoryFile } from "./github.js";

/** The memory categories the assistant can write to */
const MEMORY_FILES: Record<string, string> = {
  "about-chris": "knowledge/about-chris.md",
  preferences: "knowledge/preferences.md",
  projects: "knowledge/projects.md",
  people: "knowledge/people.md",
  decisions: "memory/decisions.md",
  learnings: "memory/learnings.md",
};

// ---------------------------------------------------------------------------
// Prompt injection defense
// ---------------------------------------------------------------------------

const CONTENT_MAX_CHARS = 2000;
const REPLACE_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

/** Tracks the last time a `replace` action was accepted for each category. */
const lastReplaceTime = new Map<string, number>();

type ValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Validates memory tool arguments for prompt injection attempts and abuse patterns.
 * Returns { valid: true } if safe, or { valid: false; reason } if the write should
 * be blocked.
 */
function validateMemoryContent(args: {
  category: string;
  action: "add" | "replace";
  content: string;
}): ValidationResult {
  const { category, action, content } = args;
  const preview = content.slice(0, 100).replace(/\n/g, " ");

  // 1. Content size limit
  if (content.length > CONTENT_MAX_CHARS) {
    const reason = `Content exceeds ${CONTENT_MAX_CHARS} character limit (got ${content.length})`;
    console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
    return { valid: false, reason };
  }

  // 2. Replace action throttle (add actions are never throttled)
  if (action === "replace") {
    const last = lastReplaceTime.get(category);
    if (last !== undefined) {
      const elapsed = Date.now() - last;
      if (elapsed < REPLACE_THROTTLE_MS) {
        const remainingSecs = Math.ceil((REPLACE_THROTTLE_MS - elapsed) / 1000);
        const reason = `Replace action throttled for category "${category}" — try again in ${remainingSecs}s`;
        console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
        return { valid: false, reason };
      }
    }
  }

  // 3. Dangerous content patterns

  // 3a. Prompt injection language (multi-word phrases to avoid false positives on common English)
  const injectionPhrases = [
    /ignore\s+(all\s+)?previous/i,
    /disregard\s+(all\s+)?(previous|above|prior|instructions)/i,
    /override\s+(all\s+)?(previous|above|prior|instructions|rules)/i,
    /new\s+instructions/i,
    /system\s+prompt/i,
    /you\s+are\s+now/i,
    /forget\s+(all\s+)?(previous|above|prior|instructions)/i,
  ];
  for (const pattern of injectionPhrases) {
    if (pattern.test(content)) {
      const reason = `Content contains a suspected prompt injection phrase (matched: ${pattern.source})`;
      console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
      return { valid: false, reason };
    }
  }

  // 3b. Executable shell code blocks (```bash or ```sh containing dangerous commands)
  const shellBlockPattern = /```(?:bash|sh)\b[\s\S]*?```/gi;
  const dangerousCommands = /\b(?:rm|curl|wget|eval|exec)\b/;
  let match: RegExpExecArray | null;
  while ((match = shellBlockPattern.exec(content)) !== null) {
    if (dangerousCommands.test(match[0])) {
      const reason =
        "Content contains a shell code block with dangerous commands (rm/curl/wget/eval/exec)";
      console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
      return { valid: false, reason };
    }
  }

  // 3c. Path traversal sequences
  if (/\.\.\//.test(content)) {
    const reason = "Content contains a path traversal sequence (../)";
    console.log(`[memory-guard] REJECTED — ${reason} | preview: "${preview}"`);
    return { valid: false, reason };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

/**
 * Raw execution function for the update_memory tool.
 * Shared by both Claude (MCP) and OpenAI-compatible (function calling) providers
 * via the tool registry in src/tools/.
 */
export async function executeMemoryTool(args: {
  category: string;
  action: "add" | "replace";
  content: string;
}): Promise<string> {
  const validation = validateMemoryContent(args);
  if (!validation.valid) {
    return `Memory update rejected: ${validation.reason}`;
  }

  const { category, action, content } = args;
  const filePath = MEMORY_FILES[category];
  if (!filePath) return `Unknown category: ${category}`;

  const timestamp = new Date().toISOString().split("T")[0];
  const entry = `<!-- Updated: ${timestamp} -->\n${content}`;

  try {
    if (action === "replace") {
      await writeMemoryFile(filePath, entry, `memory: replace ${category}`);
      lastReplaceTime.set(category, Date.now());
    } else {
      await appendToMemoryFile(filePath, entry, `memory: add to ${category}`);
    }
    return `Memory updated (${category}/${action})`;
  } catch (error: any) {
    return `Failed to update memory: ${error.message}`;
  }
}
