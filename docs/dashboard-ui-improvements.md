# Dashboard UI Improvements

A plan for improving the mission control dashboard using proper UI component patterns.
Reference: [component.gallery](https://component.gallery/components/) — 95 design systems, 2,676 examples.

**Core principle:** Using correct component names and patterns when building UI produces dramatically better results than ad-hoc styling. This document maps the current dashboard's weaknesses to specific, named component patterns.

---

## Priority 1 — High Impact

### Skeleton Loaders

**What:** Replace all `"Loading..."` text with skeleton elements that mimic the shape of the content about to appear.

**Where it applies:**
- Status tab — stat grid shows "Loading..." while fetching
- Schedules tab — table area shows "Loading..." while fetching
- Memory tab — file list and editor area
- Conversations tab — archive date list and message view

**What to build:**
- Stat grid skeleton: 8 grey rounded rectangles in the same grid layout as the real stats
- Table skeleton: 4-5 rows of grey bars, roughly matching column widths
- File list skeleton: 6-8 narrow pill-shaped bars
- Message skeleton: alternating left-bordered bars with a short meta line above

**Why:** The jump from skeleton → real content feels intentional. The jump from "Loading..." → real content feels like the page broke and then fixed itself.

---

### Toast Notifications

**What:** A toast is a small notification that appears in a fixed position (usually bottom-right), delivers a message, and auto-dismisses after a few seconds. Unlike inline status text, it doesn't shift layout.

**Where it applies:**
- Memory tab — currently `statusEl.textContent = "Saved!"` next to the save button
- Schedule modal — currently `statusEl.textContent = "Saved!"` / `"Deleting..."`
- Any future save/delete/error actions

**What to build:**
- A `showToast(message, type)` function — `type` is `success | error | info`
- Fixed container: `position: fixed; bottom: 20px; right: 20px; z-index: 200`
- Each toast: rounded card, coloured left border by type, auto-removes after 3s
- Slide-in animation from the right

**Variants needed:**
- `success` — green border, used for "Saved!", "Deleted!"
- `error` — red border, used for API errors
- `info` — accent border, used for neutral feedback

---

### Empty State

**What:** A designed "nothing here yet" state with an icon, heading, and short description. Makes empty UI feel intentional, not broken.

**Where it applies:**
- Schedules tab — `"No scheduled tasks"`
- Conversations tab — `"No archives"`
- Memory editor before a file is selected
- Health checks — `"No health checks yet"`

**What to build per instance:**

| Location | Icon | Heading | Description |
|---|---|---|---|
| Schedules | `⏱` | No scheduled tasks | Tasks you create will appear here |
| Conversations | `💬` | No conversation archives | Archives are created automatically each day |
| Memory (before selection) | `🗂` | Select a file | Choose a memory file from the list to view or edit it |
| Health checks | `✓` | All clear | Health checks will appear here once the bot runs |

**Structure:**
```html
<div class="empty-state">
  <div class="empty-state-icon">⏱</div>
  <div class="empty-state-heading">No scheduled tasks</div>
  <div class="empty-state-description">Tasks you create will appear here</div>
</div>
```

---

## Priority 2 — Medium Impact

### Tooltip

**What:** A tooltip is a small floating label that appears on hover, showing additional information about the element underneath. Distinct from a popover (which is click-triggered and can contain interactive content).

**Where it applies:**
- Schedule table — prompt column is truncated to 80 chars. Full prompt on hover.
- Schedule table — cron expression column has a `title` attribute hack for the human-readable description. Replace with a proper tooltip.
- Health checks — the detail text for failed checks is currently rendered inline, cluttering the layout.

**What to build:**
- CSS-only tooltip using `::before` / `::after` pseudo-elements on `[data-tooltip]`
- Or a lightweight JS approach: single floating `<div class="tooltip">` repositioned on `mouseover`
- No dependencies needed — keep it vanilla

**Key rule:** Tooltips are hover-only and contain plain text. If the content needs to be interactive or contain rich content, use a popover instead.

---

### Alert

**What:** An alert is a banner component that communicates a status or message, typically appearing inline within a section. Used for warnings, errors, and informational notices that need more prominence than a health dot.

**Where it applies:**
- Health checks — a failed provider (Telegram, Anthropic, GitHub) currently shows only a small red dot. This can be missed.

**What to build:**
- Inline alert banner above the health checks list when one or more checks are failing
- Variants: `error` (red), `warning` (yellow), `info` (accent)
- Structure: icon + message + optional detail
- Dismissible if needed, but for health status — keep it persistent while the issue exists

**Example:**
```
⚠  Anthropic provider is unreachable — check your API key or network connection
```

---

### Progress Indicator

**What:** A thin horizontal bar at the top of the page that fills while API calls are in flight. Zero layout disruption. Communicates activity without blocking the UI.

**Where it applies:**
- Tab switches that trigger API calls (Status, Schedules, Memory, Conversations)
- Any manual refresh

**What to build:**
- Fixed `<div>` at `top: 0; left: 0; height: 3px; width: 0%; background: var(--accent)`
- On API call start: animate width to ~70%, slow down (indeterminate feel)
- On API call complete: snap to 100%, then fade out
- `startProgress()` / `finishProgress()` utility functions wrapping `fetch`

---

### Segmented Control

**What:** A segmented control is a set of mutually exclusive options presented as connected buttons — like a tab group but for a single setting. Common in iOS settings and modern web UIs.

**Where it applies:**
- Logs tab — currently two separate checkboxes: `Auto-scroll` and `Live tail`
- `Live / Snapshot` is a natural binary segmented control

**What to build:**
- Replace the `Live tail` checkbox with a `Live | Snapshot` segmented control
- Keep `Auto-scroll` as a checkbox (it's genuinely independent)
- Styled as two adjacent buttons with shared border, active state uses `--accent`

---

## Priority 3 — Polish

### Drawer

**What:** A drawer is a panel that slides in from the edge of the screen (usually right side), overlaying the main content. Used for settings, inspectors, and edit forms. Compared to a modal, a drawer feels less interruptive and gives more room for form-heavy content.

**Where it applies:**
- Schedule editor — currently a centred modal. The form is tall (name, type, times, enabled toggle, prompt, tools, Discord channel) and would breathe better as a full-height right drawer.

**What to build:**
- Replace `.modal-overlay` / `.modal-card` with a right-side drawer
- `position: fixed; top: 0; right: 0; height: 100vh; width: 480px`
- Slide in via `transform: translateX(100%)` → `translateX(0)` transition
- Overlay backdrop on the left (same as current modal backdrop)
- The API and form logic stay identical — only the presentation changes

---

### Badge Consistency

**What:** Unify badge styling across the entire dashboard.

**Current badge instances:**
- Provider badge in header — `var(--bg3)` background, plain text
- Enabled/disabled badges on schedules — green/red pill
- Tool count in schedule table — plain text

**What to standardise:**
- Single `.badge` class with variants: `.badge-success`, `.badge-error`, `.badge-neutral`, `.badge-accent`
- Consistent sizing, border-radius, and padding everywhere
- Add a tool count badge to each schedule row (e.g. `3 tools` or `all`)

---

## Implementation Order

| # | Component | Effort | Impact |
|---|---|---|---|
| 1 | Toast notifications | Low | High |
| 2 | Empty states | Low | High |
| 3 | Skeleton loaders | Medium | High |
| 4 | Tooltip | Low | Medium |
| 5 | Progress indicator | Low | Medium |
| 6 | Alert (health) | Low | Medium |
| 7 | Segmented control (logs) | Low | Medium |
| 8 | Badge consistency | Low | Low |
| 9 | Drawer (schedule editor) | Medium | Low |

**Suggested starting point:** Toast + Empty states in a single pass — both are low effort, high visibility, and touch every section of the dashboard.

---

## Reference

- Component vocabulary: [component.gallery/components](https://component.gallery/components/) — 60 components across 95 design systems
- Source insight: [@itsandrewgao](https://x.com/itsandrewgao/status/2027579200635605058) — using correct component names when prompting AI produces dramatically better UI results
