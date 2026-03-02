# Conversation Persistence — Gaps & Solutions

Current state: every message from Telegram and Discord flows through `addMessage()`, gets archived to a local JSONL file, backed up to GitHub every 6 hours, and summarised nightly. That's a solid foundation. But there are a few gaps worth closing.

---

## 1. Channel identity not stored in archives

**The problem**
Archives record a numeric `chatId` (last 9 digits of the Discord channel ID) but not the channel name. So `#belfast-trip` and `#stock-research` are indistinguishable in the raw archive without cross-referencing channel IDs manually.

**Solution**
Add an optional `source` field to the `ArchiveEntry` type:

```typescript
interface ArchiveEntry {
  ts: number;
  chatId: number;
  role: "user" | "assistant";
  content: string;
  source?: "telegram" | "discord";
  channelName?: string; // e.g. "belfast-trip"
}
```

In `discord.ts`, pass the channel name into `addMessage()` (or a new `archiveMessage()` call directly) so it gets stored alongside the message.

**Files to change**
- `src/conversation-archive.ts` — extend `ArchiveEntry`, update `archiveMessage()` signature
- `src/conversation.ts` — pass source metadata through `addMessage()`
- `src/discord.ts` — pass `message.channel.name` when calling `addMessage()`
- `src/telegram.ts` — pass `source: "telegram"` when calling `addMessage()`

**Impact**: Low risk, backwards compatible (field is optional). Existing JSONL files are unaffected. Future searches can filter by channel.

---

## 2. 6-hour backup window — potential message loss

**The problem**
Archives sync to GitHub every 6 hours. If the bot crashes and local files are lost or corrupted in between syncs, up to 6 hours of messages are unrecoverable.

**Solution**
Reduce the backup interval from 6 hours to 30 minutes for the JSONL archive specifically (it's append-only and small, so upload cost is minimal). The rolling `conversations.json` can stay at 6 hours since it's less critical.

```typescript
// conversation-archive.ts
const ARCHIVE_UPLOAD_INTERVAL = 30 * 60 * 1000; // 30 min instead of 6h
```

Additionally, trigger an immediate archive upload on graceful shutdown:

```typescript
// index.ts shutdown handler
process.on("SIGTERM", async () => {
  await uploadArchives();
  stopScheduler();
  stopDiscord();
  // ...
});
```

**Files to change**
- `src/conversation-archive.ts` — change interval constant
- `src/index.ts` — call `uploadArchives()` in shutdown handler

**Impact**: Negligible — JSONL files are small (a few KB per day). GitHub API calls are cheap. Worst-case loss window drops from 6 hours to 30 minutes.

---

## 3. No per-channel weekly summaries

**The problem**
The nightly summariser runs once across all conversations, producing a single daily summary. There's no channel-specific memory — what was discussed in `#belfast-trip` last Tuesday isn't easily recalled without searching raw logs.

**Solution**
Add a weekly channel summary schedule for each Discord channel that has had activity. Every Sunday at 23:50, generate a summary per channel and save it to the memory repo at `conversations/channels/CHANNEL-NAME/YYYY-WXX.md`.

Prompt template:
```
Summarise the key topics, decisions, and information shared in the #CHANNEL-NAME Discord channel this week.
Focus on: decisions made, plans agreed, useful info shared, open questions.
Keep it concise — a reference summary, not a transcript.
```

**Files to change / create**
- `src/conversation-channel-summary.ts` — new file, reads archive filtered by channel chatId, generates and uploads summary
- `src/index.ts` — start the channel summariser alongside the existing daily summariser
- `~/.chris-assistant/schedules.json` — add Sunday 23:50 cron per active channel (or hardcode the known channels)

**Impact**: Adds a useful reference layer on top of raw archives. Makes `#belfast-trip` plans recall instant — just ask "what did we plan for Belfast" and I can pull the weekly summary.

---

## 4. No full delete / privacy clear

**The problem**
The `/clear` command wipes the rolling conversation window but leaves the JSONL archive intact. There's no way to fully remove a conversation from the record without manually editing archive files.

**Solution**
Add a `--full` flag to the clear command (or a separate `purge` command) that:
1. Clears the rolling window (existing behaviour)
2. Removes or redacts entries for the given chatId from today's local JSONL
3. Optionally pushes a redacted version to GitHub

This doesn't need to be retroactive (old archives stay as-is) but gives you control over the current day's record if needed.

**Files to change**
- `src/tools/clear.ts` (or wherever clear is handled) — add full-clear option
- `src/conversation-archive.ts` — add `redactFromArchive(chatId, date)` function

**Impact**: Low priority unless privacy is a concern, but good to have the mechanism available.

---

## 5. Summariser misses if bot is down at 23:55

**The problem**
The nightly summariser fires at exactly 23:55. If the bot is offline at that moment (restart, crash, update), that day's summary never gets generated.

**Solution**
On startup, check if yesterday's summary exists in the memory repo. If it doesn't, generate it immediately as a catch-up.

```typescript
// conversation-summary.ts
export async function generateMissedSummaries(): Promise<void> {
  const yesterday = formatDate(new Date(Date.now() - 86400000));
  const exists = await readMemoryFile(`conversations/summaries/${yesterday}.md`);
  if (!exists) {
    console.log("[summary] Generating missed summary for %s", yesterday);
    await generateSummary(yesterday);
  }
}
```

Call this from `index.ts` during startup.

**Files to change**
- `src/conversation-summary.ts` — add `generateMissedSummaries()`
- `src/index.ts` — call on startup

**Impact**: One extra GitHub read on every startup. Ensures no days are silently skipped.

---

## Priority order

| # | Gap | Effort | Value |
|---|-----|--------|-------|
| 1 | Weekly channel summaries | Medium | High — makes channel history actually useful |
| 2 | Missed summary catch-up | Low | High — prevents silent data loss |
| 3 | Reduce backup window to 30min | Low | Medium — reduces worst-case loss |
| 4 | Channel identity in archives | Medium | Medium — improves searchability |
| 5 | Full delete / purge | Low | Low — nice to have |

---

*Last updated: 2026-03-01*
