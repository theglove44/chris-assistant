/**
 * 4-phase consolidation prompt for DreamTask.
 * Based on Claude Code's consolidationPrompt.ts pattern:
 * Orient -> Gather -> Consolidate -> Prune
 */

export const DREAM_CONSOLIDATION_PROMPT = `IMPORTANT: This is a memory consolidation task. Do NOT use any tools. Do NOT call Bash, Read, Edit, Write, or any other tool. Your ENTIRE response must be a single JSON object inside a markdown code block. No tool calls. No file operations. Just return the JSON.

You are performing a memory consolidation for an AI assistant called Claw. You are "dreaming" — reviewing recent conversations and updating memory files to keep them accurate and useful.

All the information you need is provided below in this message. Do not attempt to read files or run commands.

## Your 4-phase process

### Phase 1: ORIENT
Review the current memory state provided below:
- Current SUMMARY.md content
- Current learnings.md content
- Current USER.md content
- Note what topics are covered, what feels stale, what's missing

### Phase 2: GATHER
Review the recent conversation transcripts and journal entries provided below. Look for:
- New facts about Chris (preferences, projects, people, decisions)
- Corrections to existing knowledge (things that have changed)
- Patterns in how Chris works (what tools he uses, what times he's active, what frustrates him)
- Important decisions or commitments made
- Things the assistant got wrong or hallucinated (learnings)
- New projects, completed projects, or project status changes

### Phase 3: CONSOLIDATE
Update the memory files:
- Merge new facts into the appropriate sections
- Update stale information (don't just append — integrate)
- Remove information that's clearly outdated or superseded
- Add new learnings from mistakes or successes
- Keep the tone natural and integrated, not a raw data dump

### Phase 4: PRUNE
Keep things manageable:
- SUMMARY.md should stay under 25,000 characters
- Remove duplicates and redundant entries
- Merge similar items
- Archive old project details that are no longer active
- Keep the most actionable and recent information prominent

## Output format

Your ENTIRE response must be ONLY a JSON code block. Nothing else before or after it. No explanation, no commentary.

\`\`\`json
{
  "summary": "... full updated SUMMARY.md content ...",
  "learnings": "... full updated learnings.md content, or null if no changes ...",
  "user": "... full updated USER.md content, or null if no changes ...",
  "changes": ["brief description of each change made"]
}
\`\`\`

REMEMBER: Return ONLY the JSON code block. Do not use any tools. All information you need is below.

## Current memory state and recent transcripts follow below:

`;
