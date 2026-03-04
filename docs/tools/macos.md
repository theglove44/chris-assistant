---
title: macOS Tools
description: Calendar (EventKit) and Mail (AppleScript) integration for macOS
---

# macOS Tools

Two macOS-only tools: `macos_calendar` (fast native EventKit) and `macos_mail` (AppleScript). Both are platform-gated — they only register on `darwin`.

## Calendar (`macos_calendar`)

Uses a compiled Swift EventKit binary (`~/.chris-assistant/ChrisCalendar.app`) for sub-second calendar operations. Default calendar: **Family**.

### Actions

| Action | Required Params | Optional Params | Description |
|--------|----------------|-----------------|-------------|
| `list_calendars` | — | — | List all calendar names |
| `get_events` | `start_date` | `end_date`, `calendar` | View events (end defaults to next day) |
| `add_event` | `title`, `start_date` | `end_date`, `location`, `notes`, `all_day`, `calendar` | Create event (end defaults to +1hr) |
| `delete_event` | `uid` or `title`+`start_date` | `calendar` | Delete by UID (preferred) or title+date (first match) |

Date format: `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`.

### Architecture

```
Bot (Node.js)
  │  execFileAsync("open", ["--stdout", tmpFile, ..., ChrisCalendar.app, "--args", ...])
  │  polls tmpFile for JSON output (250ms intervals, up to 5s)
  ▼
ChrisCalendar.app (Swift binary in .app bundle)
  │  EventKit framework — indexed queries, sub-second
  ▼
macOS Calendar database
```

The Swift binary is wrapped in a `.app` bundle for TCC (Transparency, Consent, Control) permissions. Launched via `open` so macOS treats it as its own app for permission grants. Output captured via temp file since `open` doesn't pipe stdout.

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
open ~/.chris-assistant/ChrisCalendar.app --args list-calendars
# Approve the permission dialog again
```

This only happens when the Swift source (`src/swift/chris-calendar.swift`) is modified and rebuilt — normal bot usage never triggers it.

### Performance

| Operation | AppleScript (old) | EventKit (current) |
|-----------|-------------------|-------------------|
| List calendars | ~1s | ~300ms |
| Get events | ~65s | ~340ms |
| Add event | ~5s | ~290ms |
| Delete event | ~90s+ (timeout) | ~290ms |

### Swift Source

`src/swift/chris-calendar.swift` — ~325 lines. Commands: `list-calendars`, `get-events`, `add-event`, `delete-event`. Outputs JSON `{ok, data, error}` to stdout.

Build script: `scripts/build-calendar-helper.sh`. Compiles with `-O` optimization, creates app bundle with `LSUIElement` Info.plist (no dock icon, allows TCC dialogs), ad-hoc codesigns.

## Mail (`macos_mail`)

Uses AppleScript via `osascript` to interact with Mail.app. Default account: **iCloud**. Slower than Calendar (~5-10s per operation) but no native framework alternative exists.

### Actions

| Action | Required Params | Optional Params | Description |
|--------|----------------|-----------------|-------------|
| `summary` | — | — | Total and unread message counts |
| `inbox` | — | `count`, `unread_only` | Recent messages (default 5, max 20) |
| `search` | `query` | `count` | Search by subject or sender (default 10, max 20) |

### Implementation

AppleScript is written to temp files and executed via `/usr/bin/osascript` (multi-line scripts don't work reliably with `-e` flag). 120s timeout to handle Mail.app's slow scripting bridge. Output truncated at 50KB.

## Files

| File | Purpose |
|------|---------|
| `src/tools/macos.ts` | Tool registration + execution logic |
| `src/swift/chris-calendar.swift` | Swift EventKit CLI source |
| `scripts/build-calendar-helper.sh` | Build + install script |
| `~/.chris-assistant/ChrisCalendar.app` | Installed app bundle (not in repo) |
