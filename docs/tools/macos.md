---
title: macOS Tools
description: Calendar (EventKit) and Mail (AppleScript) integration for macOS
---

# macOS Tools

Three macOS-only tools: `macos_calendar` (fast native EventKit), `macos_mail` (AppleScript), and `macos_reminders` (fast native EventKit). All are platform-gated — they only register on `darwin`.

## Calendar (`macos_calendar`)

Uses a compiled Swift EventKit binary (`~/.chris-assistant/ChrisCalendar.app`) for sub-second calendar operations. Default calendar: **Family**.

### Actions

| Action | Required Params | Optional Params | Description |
|--------|----------------|-----------------|-------------|
| `list_calendars` | — | — | List all calendar names |
| `get_events` | `start_date` | `end_date`, `calendar` | View events (end defaults to next day) |
| `add_event` | `title`, `start_date` | `end_date`, `location`, `notes`, `all_day`, `calendar` | Create event (end defaults to +1hr) |
| `update_event` | `uid` | `title`, `start_date`, `end_date`, `location`, `notes`, `all_day`, `clear_location`, `clear_notes`, `calendar` | Update event fields selectively (only provided fields change) |
| `delete_event` | `uid` or `title`+`start_date` | `calendar` | Delete by UID (preferred) or title+date (first match) |
| `search_events` | `query` | `calendar`, `start_date`, `end_date`, `max_results` | Case-insensitive text search across title, location, and notes |

Date format: `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`.

### Update Event

Update modifies only the fields you provide — everything else stays unchanged. The event is looked up by UID (get UIDs from `get_events` or `search_events`).

- Change time: provide `start_date` and/or `end_date`
- Change title: provide `title`
- Change location: provide `location` (or `clear_location: true` to remove it)
- Change notes: provide `notes` (or `clear_notes: true` to remove them)
- Toggle all-day: `all_day: true` or `all_day: false`

Returns the full updated event as confirmation.

### Search Events

Searches title, location, and notes fields (case-insensitive). Default range: 30 days ago to 90 days ahead. Returns up to `max_results` matches (default 20).

If `calendar` is specified, searches only that calendar. Otherwise searches all calendars.

### Date Range Note

If `end_date` equals `start_date` (or is omitted), the wrapper auto-bumps end to the next day. A zero-width EventKit predicate only returns multi-day spanning events — it misses events that start on that day.

### Architecture

```
Bot (Node.js)
  │  execFileAsync("open", ["-n", "-W", "--stdout", tmpFile, ..., ChrisCalendar.app, "--args", ...])
  │  -W means open blocks until app exits — output file is ready immediately
  ▼
ChrisCalendar.app (Swift binary in .app bundle)
  │  EventKit framework — indexed queries, sub-second
  ▼
macOS Calendar database
```

The Swift binary is wrapped in a `.app` bundle for TCC (Transparency, Consent, Control) permissions. Launched via `open -n -W` so macOS treats it as its own app for permission grants. Output captured via temp file since `open` doesn't pipe stdout.

**Important flags:**
- `-n` — launch a new instance each time (without this, `open` rejects sequential calls while the app is still running, silently dropping args)
- `-W` — wait for the app to exit before returning (eliminates polling, output file is ready immediately)

### Setup

```bash
npm run setup:calendar-helper   # Compile Swift, create app bundle, codesign
```

First run requires granting Calendar permission:
```bash
open ~/.chris-assistant/ChrisCalendar.app --args list-calendars
# Approve the permission dialog
```

### TCC Permission & Rebuilds

Each recompile changes the code signature, invalidating the TCC grant. After rebuilding:
```bash
tccutil reset Calendar com.chris-assistant.calendar-helper
/usr/bin/open -n -W ~/.chris-assistant/ChrisCalendar.app --args list-calendars
# Approve the permission dialog
```

This only happens when the Swift source (`src/swift/chris-calendar.swift`) is modified and rebuilt — normal bot usage never triggers it.

**TCC troubleshooting — if the permission dialog doesn't appear:**

1. **Check Info.plist uses `LSUIElement`, NOT `LSBackgroundOnly`**. `LSBackgroundOnly` tells macOS the app never interacts with users, silently suppressing all TCC dialogs. The app will exit with "access denied" and no popup appears.
2. **The Swift `requestAccess()` must use `RunLoop`**, not `DispatchSemaphore`. A semaphore blocks the main thread, preventing macOS from presenting the TCC dialog. Use `RunLoop.current.run(until:)` in a polling loop.
3. **Use `/usr/bin/open -n -W`** when triggering the dialog — `-n` launches a new instance and `-W` waits for it to complete, giving macOS time to present the dialog.
4. **Check for stale binaries** — run `ls ~/.chris-assistant/ChrisCalendar.app/Contents/MacOS/` and ensure only `ChrisCalendar` exists (not an old `chris-calendar`).
5. **Try a full reset** — `tccutil reset Calendar` (no bundle ID) resets ALL calendar permissions if the per-bundle reset doesn't work.

### Performance

| Operation | AppleScript (old) | EventKit (current) |
|-----------|-------------------|-------------------|
| List calendars | ~1s | ~300ms |
| Get events | ~65s | ~340ms |
| Add event | ~5s | ~290ms |
| Delete event | ~90s+ (timeout) | ~290ms |

### Swift Source

`src/swift/chris-calendar.swift` — ~430 lines. Commands: `list-calendars`, `get-events`, `add-event`, `update-event`, `delete-event`, `search-events`. Outputs JSON `{ok, data, error}` to stdout.

Build script: `scripts/setup-calendar-helper.sh` / `npm run setup:calendar-helper`. Compiles with `xcrun swiftc`, creates app bundle with `LSUIElement` Info.plist (no dock icon, allows TCC dialogs), ad-hoc codesigns. Cleans up stale binaries from previous builds.

## Mail (`macos_mail`)

Uses AppleScript via `osascript` to interact with Mail.app. Default account: **iCloud**. Slower than Calendar (~5-10s per operation) but no native framework alternative exists.

### Actions

| Action | Required Params | Optional Params | Description |
|--------|----------------|-----------------|-------------|
| `summary` | — | — | Total and unread message counts |
| `inbox` | — | `count`, `unread_only`, `mailbox` | Recent messages (default 5, max 20) |
| `search` | `query` | `count`, `mailbox` | Search by subject or sender (default 10, max 20) |
| `read` | `message_id` | — | Get full message content (subject, from, to, cc, date, body) |
| `reply` | `message_id`, `body` | `reply_all` | Reply to a message (confirm content with user first) |
| `delete` | `message_id` | — | Move message to Trash |
| `move` | `message_id`, `mailbox` | — | Move message to a specific mailbox |
| `mark` | `message_id`, `mark_as` | — | Mark as `read`, `unread`, `flagged`, or `unflagged` |
| `list_mailboxes` | — | — | Show available mailbox names |

Message IDs are returned in inbox/search results as `id:...` fields. Use these for `read`, `reply`, `delete`, `move`, and `mark` actions.

### Implementation

AppleScript is written to temp files and executed via `/usr/bin/osascript` (multi-line scripts don't work reliably with `-e` flag). 120s timeout to handle Mail.app's slow scripting bridge. Output truncated at 50KB.

## Reminders (`macos_reminders`)

Uses a compiled Swift EventKit binary (`~/.chris-assistant/ChrisReminders.app`) for fast reminder operations. Default list: **Reminders**. Same `.app` bundle architecture as Calendar for TCC permissions.

### Actions

| Action | Required Params | Optional Params | Description |
|--------|----------------|-----------------|-------------|
| `list_lists` | — | — | List all reminder list names |
| `get_reminders` | — | `list`, `include_completed`, `count` | View reminders (default: incomplete only, max 50) |
| `create_reminder` | `title` | `list`, `due_date`, `due_time`, `priority`, `notes` | Create a new reminder |
| `update_reminder` | `title` | `list`, `new_title`, `due_date`, `due_time`, `priority`, `notes`, `clear_due_date` | Update an existing reminder (found by title) |
| `complete_reminder` | `title` | `list` | Mark a reminder as done |
| `search_reminders` | `query` | `list`, `include_completed`, `count` | Search across reminder names and notes |

Priority levels: `none` (default), `low`, `medium`, `high`.

### Setup

```bash
npm run setup:reminders-helper   # Compile Swift, create app bundle, codesign
```

First run requires granting Reminders permission. TCC rebuild behavior is the same as Calendar — see the Calendar TCC section above.

### Swift Source

`src/swift/chris-reminders.swift`. Commands: `list-lists`, `get-reminders`, `create-reminder`, `update-reminder`, `complete-reminder`, `search-reminders`. Outputs JSON `{ok, data, error}` to stdout.

## Files

| File | Purpose |
|------|---------|
| `src/tools/macos.ts` | Tool registration + execution logic (Node.js wrapper) |
| `src/swift/chris-calendar.swift` | Swift EventKit CLI source (~430 lines) |
| `src/swift/chris-reminders.swift` | Swift EventKit CLI source for Reminders |
| `scripts/setup-calendar-helper.sh` | Build + install script (`npm run setup:calendar-helper`) |
| `~/.chris-assistant/ChrisCalendar.app` | Installed Calendar app bundle (not in repo) |
| `~/.chris-assistant/ChrisReminders.app` | Installed Reminders app bundle (not in repo) |
