import { readMemoryFile } from "./github.js";
import { readLocalJournal } from "./journal.js";
import { datestamp } from "../conversation-archive.js";

/** Files that are ALWAYS loaded into the system prompt */
const IDENTITY_FILES = [
  "identity/SOUL.md",
  "identity/RULES.md",
  "identity/VOICE.md",
];

/** Knowledge files loaded into context for every conversation */
const KNOWLEDGE_FILES = [
  "knowledge/about-chris.md",
  "knowledge/preferences.md",
  "knowledge/projects.md",
  "knowledge/people.md",
];

/** Memory files loaded for deeper context */
const MEMORY_FILES = [
  "memory/decisions.md",
  "memory/learnings.md",
];

/** Path to the weekly-consolidated curated summary (loaded separately) */
const CURATED_SUMMARY_PATH = "memory/SUMMARY.md";

interface LoadedMemory {
  identity: string;
  knowledge: string;
  memory: string;
  recentSummaries: string;
  recentJournal: string;
  curatedSummary: string;
  skillIndex: string;
}

/** Generate the last 7 days of summary file paths. */
function recentSummaryPaths(): { date: string; path: string }[] {
  const paths: { date: string; path: string }[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const date = `${yyyy}-${mm}-${dd}`;
    paths.push({ date, path: `conversations/summaries/${date}.md` });
  }
  return paths;
}

export async function loadMemory(): Promise<LoadedMemory> {
  const summaryPaths = recentSummaryPaths();

  // Load all files in parallel
  const [identityResults, knowledgeResults, memoryResults, summaryResults, curatedSummaryContent, skillIndexRaw] = await Promise.all([
    Promise.all(IDENTITY_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
    Promise.all(KNOWLEDGE_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
    Promise.all(MEMORY_FILES.map((f) => readMemoryFile(f).then((c) => ({ path: f, content: c })))),
    Promise.all(summaryPaths.map((s) => readMemoryFile(s.path).then((c) => ({ date: s.date, content: c })))),
    readMemoryFile(CURATED_SUMMARY_PATH),
    readMemoryFile("skills/_index.json"),
  ]);

  const formatSection = (files: { path: string; content: string | null }[]) =>
    files
      .filter((f) => f.content)
      .map((f) => `## ${f.path}\n${f.content}`)
      .join("\n\n");

  const summaries = summaryResults
    .filter((s) => s.content)
    .map((s) => `### ${s.date}\n${s.content}`)
    .join("\n\n");

  // Load today's and yesterday's journal from local filesystem (always local-first)
  const today = datestamp();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = datestamp(yesterdayDate.getTime());

  const todayJournal = readLocalJournal(today);
  const yesterdayJournal = readLocalJournal(yesterday);

  const journalParts: string[] = [];
  if (yesterdayJournal) {
    journalParts.push(`### ${yesterday}\n${yesterdayJournal}`);
  }
  if (todayJournal) {
    journalParts.push(`### ${today} (today)\n${todayJournal}`);
  }

  // Parse skill index — graceful degradation if file missing or malformed
  // Cap at 20 skills to prevent unbounded prompt growth
  const MAX_DISCOVERY_SKILLS = 20;
  let skillIndex = "";
  if (skillIndexRaw) {
    try {
      const entries = JSON.parse(skillIndexRaw) as Array<{
        id: string;
        name: string;
        description: string;
        enabled: boolean;
        triggers: string[];
      }>;
      // Only show enabled skills that have triggers (per spec, triggers drive discovery)
      const discoverable = entries.filter((e) => e.enabled && Array.isArray(e.triggers) && e.triggers.length > 0);
      const capped = discoverable.slice(0, MAX_DISCOVERY_SKILLS);
      const lines: string[] = [];
      for (const e of capped) {
        try {
          const triggers = e.triggers.map((t) => `"${t}"`).join(", ");
          lines.push(`- **${e.id}** — ${e.description}\n  Triggers: ${triggers}`);
        } catch {
          // Skip malformed entry — don't let one bad entry break the whole block
        }
      }
      if (lines.length > 0) {
        skillIndex = lines.join("\n");
        if (discoverable.length > MAX_DISCOVERY_SKILLS) {
          skillIndex += `\n\n_(${discoverable.length - MAX_DISCOVERY_SKILLS} more skills available — use manage_skills list to see all)_`;
        }
      }
    } catch {
      // Malformed JSON — skip skill index silently
    }
  }

  return {
    identity: formatSection(identityResults),
    knowledge: formatSection(knowledgeResults),
    memory: formatSection(memoryResults),
    recentSummaries: summaries,
    recentJournal: journalParts.join("\n\n"),
    curatedSummary: curatedSummaryContent ?? "",
    skillIndex,
  };
}

/**
 * Build the full system prompt from loaded memory.
 */
export function buildSystemPrompt(memory: LoadedMemory): string {
  const parts: string[] = [];

  if (memory.identity) {
    parts.push(`# Identity\n\n${memory.identity}`);
  }

  if (memory.curatedSummary) {
    parts.push(`# Curated Memory\n\nThis is your consolidated understanding of Chris — actively maintained and updated weekly from your knowledge files, daily journals, and conversation summaries.\n\n${memory.curatedSummary}`);
  }

  if (memory.knowledge) {
    parts.push(`# Knowledge About Chris\n\n${memory.knowledge}`);
  }

  if (memory.memory) {
    parts.push(`# Memories & Learnings\n\n${memory.memory}`);
  }

  if (memory.recentSummaries) {
    parts.push(`# Recent Conversation History\n\nThese are AI-generated summaries of your recent conversations with Chris. Use them to maintain continuity and recall past discussions.\n\n${memory.recentSummaries}`);
  }

  if (memory.recentJournal) {
    parts.push(`# Your Recent Journal\n\nThese are notes you wrote during recent conversations. They represent your own observations and interpretations.\n\n${memory.recentJournal}`);
  }

  if (memory.skillIndex) {
    parts.push(`# Available Skills\n\nYou have reusable skills. Use the run_skill tool to execute them. Use manage_skills to create, edit, or delete skills.\n\n${memory.skillIndex}`);
  }

  return parts.join("\n\n---\n\n");
}
