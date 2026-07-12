import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { LOCAL_MEMORY_DIR } from "./recall.js";

export interface DecisionAlternative {
  name: string;
  rejected_because: string;
}

export interface DecisionRevisitCondition {
  condition: string;
  review_on?: string;
  status?: "pending" | "met" | "dismissed";
}

export interface DecisionRecord {
  type: "decision";
  date: string;
  chose: string;
  alternatives: DecisionAlternative[];
  reasoning_trace: string[];
  revisit_conditions: DecisionRevisitCondition[];
}

export type DecisionInput = Omit<DecisionRecord, "type">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function validateDecision(input: DecisionInput): string | null {
  if (!isIsoCalendarDate(input.date)) return "decision.date must be a valid YYYY-MM-DD date";
  if (!input.chose.trim()) return "decision.chose must not be empty";
  if (input.alternatives.length === 0) return "decision.alternatives must include at least one rejected option";
  if (input.alternatives.some((item) => !item.name.trim() || !item.rejected_because.trim())) {
    return "each decision alternative needs name and rejected_because";
  }
  if (input.reasoning_trace.length === 0 || input.reasoning_trace.some((reason) => !reason.trim())) {
    return "decision.reasoning_trace must include at least one reason";
  }
  if (input.revisit_conditions.some((item) => !item.condition.trim())) {
    return "each revisit condition needs a condition";
  }
  if (input.revisit_conditions.some((item) => item.review_on && !isIsoCalendarDate(item.review_on))) {
    return "revisit condition review_on must be a valid YYYY-MM-DD date";
  }
  return null;
}

export function asDecisionRecord(input: DecisionInput): DecisionRecord {
  return { type: "decision", ...input };
}

export function formatDecisionFrontmatter(input: DecisionInput): string {
  return stringifyYaml(asDecisionRecord(input)).trimEnd();
}

function decisionSlug(chose: string): string {
  return chose
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "decision";
}

export function decisionRecordPath(input: DecisionInput): string {
  return `decisions/${input.date}-${decisionSlug(input.chose)}.md`;
}

export function formatDecisionDocument(input: DecisionInput): string {
  return `---\n${formatDecisionFrontmatter(input)}\n---\n\n${formatDecisionMemory(input)}\n`;
}

export function formatDecisionMemory(input: DecisionInput): string {
  const alternatives = input.alternatives
    .map((item) => `- **${item.name}** — rejected because ${item.rejected_because}`)
    .join("\n");
  const reasoning = input.reasoning_trace.map((item) => `- ${item}`).join("\n");
  const revisit = input.revisit_conditions.length > 0
    ? input.revisit_conditions.map((item) => {
      const review = item.review_on ? `; review on ${item.review_on}` : "";
      return `- ${item.condition}${review}; status: ${item.status ?? "pending"}`;
    }).join("\n")
    : "- No revisit conditions recorded.";

  return `## Decision: ${input.chose}\n\n- **Date:** ${input.date}\n- **Chose:** ${input.chose}\n\n### Alternatives\n${alternatives}\n\n### Reasoning trace\n${reasoning}\n\n### Revisit conditions\n${revisit}`;
}

function parseDecision(content: string): DecisionRecord | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try {
    const parsed = parseYaml(match[1]) as DecisionRecord;
    if (parsed?.type !== "decision") return null;
    const error = validateDecision(parsed);
    return error ? null : parsed;
  } catch {
    return null;
  }
}

function isDue(condition: DecisionRevisitCondition, asOf: string): boolean {
  if (condition.status === "dismissed") return false;
  return condition.status === "met" || (!!condition.review_on && condition.review_on <= asOf);
}

export async function decisionsDueForRevisit(
  asOf = new Date().toISOString().slice(0, 10),
  memoryDir = LOCAL_MEMORY_DIR,
): Promise<DecisionRecord[]> {
  const entries = await readdir(memoryDir, { recursive: true }).catch(() => [] as string[]);
  const files = entries.filter((entry) => entry.endsWith(".md"));
  const parsed = await Promise.all(files.map(async (entry) => {
    const content = await readFile(join(memoryDir, entry), "utf-8").catch(() => "");
    return parseDecision(content);
  }));

  return parsed
    .filter((record): record is DecisionRecord => record !== null)
    .filter((record) => record.revisit_conditions.some((condition) => isDue(condition, asOf)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function formatDecisionsDue(records: DecisionRecord[], asOf: string): string {
  if (records.length === 0) return `No decisions due for revisit as of ${asOf}.`;
  return [
    `Decisions due for revisit as of ${asOf}:`,
    ...records.map((record) => {
      const due = record.revisit_conditions
        .filter((condition) => isDue(condition, asOf))
        .map((condition) => condition.condition)
        .join("; ");
      return `- ${record.date}: ${record.chose} — ${due}`;
    }),
  ].join("\n");
}
