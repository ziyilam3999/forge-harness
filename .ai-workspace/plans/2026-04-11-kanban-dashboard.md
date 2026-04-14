# Kanban Dashboard for forge_coordinate

## ELI5

Imagine you have a bunch of tasks on sticky notes. Right now, you have to stare at a scrolling terminal to know which task the robot is working on. Instead, we'll make a web page that looks like a whiteboard with columns (Backlog, Ready, In Progress, Retry, Done, Blocked) — and the sticky notes move between columns as work happens. The page refreshes itself every 5 seconds so you can just glance at your browser tab to see what's going on, and it warns you if the robot seems stuck.

## Summary

A **display-only Kanban dashboard** rendered as a single self-contained HTML file (`.forge/dashboard.html`). forge primitives rewrite it on every stage transition via the existing `ProgressReporter`. The browser auto-refreshes every 5 seconds via `<meta http-equiv="refresh">`. No server, no dependencies, no user actions — pure read-only monitoring.

## Architecture

### Data Flow

```
Coordinator.assessPhase()          -->  writes .forge/coordinate-brief.json (new)

ProgressReporter.begin/complete()  -->  writes .forge/activity.json
                                   -->  calls renderDashboard()
                                   -->  writes .forge/dashboard.html (atomic: tmp + rename)

RunRecord.write()                  -->  clears .forge/activity.json
                                   -->  calls renderDashboard()

Browser                            -->  <meta refresh=5> re-reads dashboard.html
                                   -->  JS staleness detection (green/amber/red banner)
```

### Error Handling Policy

Dashboard rendering and `activity.json` writes are **non-fatal side effects**. Failures are logged to stderr and swallowed — matching the existing error policy used by `writeRunRecord` (which wraps in try/catch and continues) and `AuditLog` (whose failure policy is "warn and continue, never crash the tool").

VERIFIED: `writeRunRecord` error swallowing found at `server/lib/run-record.ts:97-102` — `"catch (err) { console.error("forge: failed to write run record (continuing):", ..."`
VERIFIED: `AuditLog` failure policy found at `server/lib/audit.ts:5` — `"Failure policy: warn and continue, never crash the tool."`

### New Concept: Activity Signal

**`.forge/activity.json`** — ephemeral file written during execution, cleared on completion:

```json
{
  "tool": "forge_generate",
  "storyId": "US-03",
  "startedAt": "2026-04-11T10:30:00Z",
  "lastUpdate": "2026-04-11T10:32:15Z",
  "stage": "Running critic round 2",
  "progress": { "current": 3, "total": 5 },
  "label": "Generating US-03: Add user authentication"
}
```

When no tool is running: `{ "tool": null }` or file absent.

#### Crash Recovery

If the process crashes between writing `activity.json` and clearing it (via `writeRunRecord`), the file will show a phantom "in-progress" state. The hang detection JS (120s red banner) alerts the operator visually. On the next successful `forge_coordinate` invocation, `activity.json` is overwritten with current state, so the stale file self-heals on next run. No manual cleanup is required.

**Known limitation:** The dashboard cannot distinguish between a hung process and a crashed process. Operators should check process status externally if the red banner persists.

#### Concurrent Execution

If two forge tools run simultaneously (e.g., `forge_evaluate` from one session while `forge_coordinate` from another), they race on `activity.json`. Since the dashboard is display-only and `activity.json` is advisory (not authoritative), the worst case is a momentary display of the wrong tool — corrected on the next write. This is acceptable for a monitoring-only feature.

### Kanban Columns (6 columns)

| Column | StoryStatus Source | Design Accent | Card Content |
|---|---|---|---|
| **Backlog** | `pending` | grey | Story ID, blocked-by deps |
| **Ready** | `ready` (minus active story) | neutral | Story ID, title |
| **In Progress** | Story matching `activity.json` | amber (pulsing dot) | Tool, stage, elapsed time, iteration N/M, staleness indicator |
| **Retry** | `ready-for-retry` | amber | Retry count badge, last failure evidence |
| **Done** | `done` | green | Eval verdict, cost |
| **Blocked** | `failed` + `dep-failed` | red | Failure reason, upstream chain |

VERIFIED: All 6 `StoryStatus` values mapped — found at `server/types/coordinate-result.ts:5-11`: `"done" | "ready" | "ready-for-retry" | "failed" | "pending" | "dep-failed"`. The "In Progress" column is correctly a derived concept (story matching `activity.json`) since `StoryStatus` has no "in-progress" value.

### Dashboard Layout

```
+-------------------------------------------------------------+
| Phase: PH-03        Progress: 4/9 done        $2.15/$10     |
| Status: in-progress     Elapsed: 12m / 30m max              |
| [Live * last update 3s ago]                                  |
+----------+----------+----------+----------+------+----------+
| Backlog  |  Ready   |In Progr. |  Retry   | Done | Blocked  |
|          |          |          |          |      |          |
| +------+ | +------+ | +------+ |          |+----+|          |
| |US-05 | | |US-04 | | |US-03 | |          ||US- ||          |
| |wait  | | |ready | | |gen.. | |          ||01  ||          |
| |on 04 | | |      | | |round | |          |+----+|          |
| +------+ | +------+ | |2/5   | |          ||US- ||          |
| +------+ |          | |1m32s | |          ||02  ||          |
| |US-06 | |          | |*live | |          |+----+|          |
| +------+ |          | +------+ |          |      |          |
+----------+----------+----------+----------+------+----------+
| Activity Feed                                               |
| 10:32:15  Running critic round 2  (agentRole: critic)       |
| 10:31:42  Running critic round 1  (decision: revise)        |
| 10:30:00  Generating code         (agentRole: generator)    |
| 10:29:55  Evaluation complete     (decision: PASS)          |
+-------------------------------------------------------------+
```

### Sections

1. **Header Bar** — Phase ID, phase status, budget gauge, time gauge, progress counter, staleness banner
2. **Kanban Board** — 6 columns with story cards, "In Progress" card is visually distinct (larger, pulsing indicator)
3. **Activity Feed** — Chronological feed from `.forge/audit/` JSONL + current activity.json, most recent at top. Shows last 20 entries. Full iteration history is available in the `.forge/audit/` JSONL files for operators who need deeper inspection.

### Audit Feed Reading Strategy

The activity feed reads **all** `.forge/audit/*.jsonl` files and **all lines** from each file (reusing the existing `readAuditEntries()` function from `server/lib/run-reader.ts`), merge-sorts all entries by their `timestamp` field, and takes the last 20. This ensures the feed shows interleaved entries across tools (e.g., generate critic rounds followed by evaluate verdicts). On first run (no audit directory), the feed section renders empty with no error.

The tool name is **extracted from the filename** (format: `{toolName}-{timestamp}.jsonl`), not from the `AuditEntry` itself. The renderer passes the filename-derived tool name alongside each parsed entry.

**Feed entry display format:** Each entry renders as: `timestamp | stage | (decision: {decision})`. The tool name (from filename) is shown as a hex-dot accent. Since `AuditEntry` does not contain `storyId` or `score` fields, those are not shown in the feed. The active story's ID is already visible in the "In Progress" card; operators who need per-entry story correlation can inspect the JSONL files directly.

VERIFIED: `readAuditEntries()` reads all lines from all files at `server/lib/run-reader.ts:160-213` — iterates `lines = content.split("\n")` and parses each line.
VERIFIED: `AuditEntry` interface at `server/lib/audit.ts:11-17` has fields: `timestamp`, `stage`, `agentRole`, `decision`, `reasoning`. No `tool`, `storyId`, or `score` field.
VERIFIED: AuditLog filenames include tool name and timestamps — found at `server/lib/audit.ts:49`: `"${this.toolName}-${safeTimestamp}.jsonl"`

### Hang Detection (JS-based)

```javascript
// Pure classification function — defined once in dashboard-renderer.ts
// (exported for unit testing) and also serialized into the HTML <script>
// block via string template so it runs in the browser.
function classifyStaleness(elapsedMs) {
  if (elapsedMs > 120_000) return "red";
  if (elapsedMs > 60_000) return "amber";
  return "green";
}

const lastUpdate = new Date("{{LAST_UPDATE_ISO}}").getTime();
const elapsed = Date.now() - lastUpdate;
const level = classifyStaleness(elapsed);
if (level === "red") showBanner("No update for 2+ min -- may be hung", "red");
else if (level === "amber") showBanner("Last update: over 1 min ago", "amber");
else showBanner("Live -- last update " + Math.round(elapsed/1000) + "s ago", "green");
```

### Refresh Strategy

- **Interval: 5 seconds** via `<meta http-equiv="refresh" content="5">`
- **Rationale:** Quickest meaningful data change is ~15s (LLM call completing). 5s polling catches every update within one cycle. Faster polling adds flicker without new information.
- **Atomic writes:** Write to `.forge/dashboard.tmp.html`, then rename to `.forge/dashboard.html` to prevent partial reads.

#### Windows Atomic Rename

On Windows/NTFS, `fs.rename()` works for atomic renames within the same directory. If the browser holds a file handle during the rename (narrow 5s window), the rename may fail with `EPERM`. Since dashboard rendering is non-fatal (see Error Handling Policy above), a failed rename is logged and swallowed — the next state transition retries. The stale dashboard continues to display until the next successful write, which is acceptable for a monitoring-only feature.

## Integration Points (Minimal)

### Data Flow: How `renderDashboard()` Gets Its Input

`renderDashboard()` reads `PhaseTransitionBrief` from `.forge/coordinate-brief.json` on disk each time it is called. **This file does not exist today** — the coordinator must be updated to write it (see Hook 0 below). `Activity` data is read from `.forge/activity.json`. This makes `renderDashboard()` fully stateless — it reads two files and produces HTML.

When called from `ProgressReporter` (which has no access to coordinate-specific types), `renderDashboard()` handles its own I/O: it reads both files, and if either is missing or unparseable, it renders a degraded dashboard (empty cards, no activity) rather than crashing.

### Hook 0: Coordinator writes `.forge/coordinate-brief.json` (NEW)

After `assessPhase()` computes the `PhaseTransitionBrief`, write it to `.forge/coordinate-brief.json`:

```typescript
// In server/lib/coordinator.ts, after assessPhase() returns:
await writeFile(
  join(projectPath, ".forge", "coordinate-brief.json"),
  JSON.stringify(brief, null, 2),
  "utf-8"
);
```

Wrapped in try/catch (non-fatal, matching existing error policy). This is the only new write in the coordinator — all other hooks are in `ProgressReporter` and `writeRunRecord`.

VERIFIED: `assessPhase()` returns `PhaseTransitionBrief` — coordinator constructs a `CoordinateResult` containing `brief: PhaseTransitionBrief` at `server/types/coordinate-result.ts:104-108`.
UNVERIFIED: Exact location of `assessPhase()` call in coordinator — will be identified during implementation. The coordinator file exists at `server/lib/coordinator.ts`.

### Hook 1: ProgressReporter (`server/lib/progress.ts`)

**Constructor change required:** `ProgressReporter` currently takes `(toolName: string, stages: string[])`. Add an optional third parameter: `projectPath?: string` and an optional fourth: `storyId?: string`. When `projectPath` is provided, `begin()` and `complete()` will also:
1. Write/update `.forge/activity.json` (using `projectPath` to locate `.forge/`)
2. Call `renderDashboard()` (which reads `.forge/coordinate-brief.json` from disk independently)

Both calls wrapped in try/catch — failures logged, never thrown (matching existing `AuditLog` and `writeRunRecord` error policy).

**Blast radius of constructor change:** All existing call sites pass only `(toolName, stages)` today. The new parameters are optional, so existing call sites are unaffected. Only `forge_coordinate`'s call site needs updating to pass `projectPath` and `storyId`. Other tools (forge_generate, forge_evaluate, forge_plan) can opt in later for richer activity signals.

VERIFIED: `ProgressReporter` constructor at `server/lib/progress.ts:25` takes `(toolName: string, stages: string[])` — no `projectPath` or file I/O.
VERIFIED: `ProgressReporter` has `begin(stageName)` and `complete(stageName)` at `server/lib/progress.ts:32,46`

### Hook 2: writeRunRecord (`server/lib/run-record.ts`)

After writing the RunRecord:
1. Clear `.forge/activity.json` (set `{ "tool": null }`)
2. Call `renderDashboard()` one final time

Both calls wrapped in try/catch — failures logged, never thrown. `writeRunRecord` already receives `projectPath` as its first argument, so no signature change needed.

VERIFIED: `writeRunRecord(projectPath, record)` at `server/lib/run-record.ts:85` — already has `projectPath`.

### Design Note: Why Hooks, Not an Observer

The plan hooks directly into `ProgressReporter` and `writeRunRecord` rather than introducing an observer/event-emitter pattern. This is intentional: the dashboard is the only consumer and both hook sites are already side-effect-heavy (stderr logging, file writes). Adding an event system for a single consumer would be premature abstraction. If a second consumer emerges, refactor to an observer at that point.

### Directory Bootstrap

Both `writeActivity()` and `renderDashboard()` call `fs.mkdir('.forge', { recursive: true })` before writing. This is idempotent and ensures the dashboard works on first-ever run when `.forge/` may not yet exist.

### New Files

| File | Purpose |
|---|---|
| `server/lib/activity.ts` | Read/write `.forge/activity.json` |
| `server/lib/dashboard-renderer.ts` | Reads `.forge/coordinate-brief.json` + `.forge/activity.json` from disk -> HTML string. Exports `classifyStaleness()` for testability (also serialized into HTML `<script>` block). |

### No New Dependencies

- No npm packages
- No local server
- No WebSocket
- Single self-contained HTML (inline CSS + JS)
- Works with `file://` protocol

## Design System Compliance

Per hive-mind-persist `design-system.md`:

- **Colors:** `--green: #16a34a` (done), `--amber: #b8860b` (retry/progress), `--red: #c03030` (blocked), `--grey: #8c8c82` (pending)
- **Cards:** 10px border-radius, warm shadows `rgba(60,55,45,...)`
- **Typography:** `--font-ui` for labels, `--font-mono` for story IDs
- **Hex status dots:** 14px per story
- **Max width:** 1200px
- **No emoji** in UI

VERIFIED: All color values match `design-system.md` lines 78-87.
VERIFIED: "Hex shapes over circles" rule at `design-system.md` line 692.

## Pattern Compliance

| Pattern | How We Comply |
|---|---|
| **P3** (File over memory) | Dashboard is a file, no in-memory state |
| **P18** (Three-view tracking) | Header (bird's-eye) + Cards (detail) + Feed (narrative) |
| **P22** (JSONL audit trail) | Reads existing `.forge/audit/` for activity feed |
| **P24** (Three-file tracking) | JSON (brief) + JSONL (audit) + HTML (human-readable) |
| **Intelligent Clipboard** | Read-only view, never mutates state, $0 cost |
| **F30** (no in-memory drift) | Stateless — regenerated from files on every call |
| **F49** (single enforcement point) | Status rules enforced in coordinator only, dashboard just renders |

## UI Design

**Reference mockup:** `.ai-workspace/plans/dashboard-reference.html` (open in browser to preview)

VERIFIED: File exists at `.ai-workspace/plans/dashboard-reference.html`

**Aesthetic direction:** Industrial control-room — warm cream palette, hex motifs, data-dense. Follows hive-mind-persist `design-system.md` exactly.

### Visual Hierarchy (top to bottom)

1. **Top Bar** (56px) — Branding (Hive Mind / Forge Coordinate), phase tag (`PH-03`), phase status pill, liveness banner (right-aligned). Green gradient top accent bar.

2. **Stats Row** (4-column grid) — Four stat cards:
   - Stories: `4 / 9 done` with green progress bar
   - Budget: `$2.15 / $10.00` with fill bar (green/amber/red by warning level). When `budgetUsd` is null (no budget set), show "no limit" instead of a fill bar.
   - Time: `12m / 30m max` with fill bar. When `maxTimeMs` is null (no time limit set), show "no limit" instead of a fill bar.
   - Recommendation: text summary from `PhaseTransitionBrief.recommendation`

VERIFIED: `BudgetInfo.budgetUsd` is `number | null` at `server/types/coordinate-result.ts:37`
VERIFIED: `TimeBudgetInfo.maxTimeMs` is `number | null` at `server/types/coordinate-result.ts:45`

3. **Replanning Notes** (conditional, 0-N) — Amber/red alert bars. Shown only when `replanningNotes.length > 0`. Severity tag (BLOCKING = red, SHOULD-ADDRESS = amber, INFORMATIONAL = grey) + description text.

VERIFIED: `ReplanningSeverity` type at `server/types/coordinate-result.ts:58`: `"blocking" | "should-address" | "informational"`

4. **Kanban Board** (6-column equal-width grid) — Each column has:
   - Header: uppercase title + count badge
   - Column accent bar (3px top): grey/neutral/amber/amber/green/red
   - Card stack with 8px gap
   - Empty state: centered 32px grey hex

5. **Activity Feed** (max-height 180px, scrollable) — 4-column grid per row: time | stage | decision | agent role. Each row has CSS class `feed-entry`. Tool name shown as hex-dot accent (extracted from audit filename). Most recent at top.

6. **Footer** — Logo SVG at 0.3 opacity.

### Card Variants

| Variant | Border | Background | Content |
|---|---|---|---|
| Default | 1px `--border-light` | `--off-white` | Story ID (green mono), title, meta tags |
| Active (In Progress) | 1.5px `--amber` | `--amber-bg` | Pulsing amber hex, tool name, stage, elapsed timer (JS live-updating), iteration progress bar |
| Done | 1px `--border-light` | `--off-white` | Story ID, PASS tag (green), cost |
| Failed | 1px `--border-light` | `--off-white` | Story ID, FAIL tag (red), evidence snippet (left-bordered, 2-line clamp) |
| Dep-Failed (Blocked) | 1px `--border-light` | `--off-white` | Story ID, "Blocked by {upstream story ID}" label (red), upstream chain if multi-level |
| Retry | 1px `--border-light` | `--off-white` | Story ID, retry badge (`1/3 retries`, amber mono), FAIL tag, evidence |

### Animations

- **Page load:** Staggered fade-up (`fadeUp 0.35s`) with 50ms delays between sections
- **Liveness indicator:** Green pulsing **hex** (2s ease-in-out infinite) using `clip-path: polygon(...)` — per design-system.md rule: "Hex shapes over circles -- always use hex clip-path for status indicators, never circles"
- **Active card hex:** Amber hex pulsing at 2s (scale 1 -> 0.85, opacity 1 -> 0.5)
- **Active timer:** JS `setInterval(1000)` updates elapsed time every second between meta-refreshes
- **Progress bars:** CSS `transition: width 0.6s ease` for smooth bar fills on refresh

### JS Runtime Behavior

Two values baked in at render time as JS string literals:
- `LAST_UPDATE` — ISO timestamp of last dashboard write (for staleness)
- `ACTIVITY_STARTED` — ISO timestamp from `activity.json.startedAt` (for active timer)

On page load, JS:
1. Computes staleness = `Date.now() - LAST_UPDATE` and sets liveness banner class/text (via `classifyStaleness()` pure function)
2. Computes active elapsed = `Date.now() - ACTIVITY_STARTED` and updates timer
3. Runs both on 1-second interval for live counters between 5s meta-refreshes

### Template Placeholder Convention

The TypeScript renderer will use simple string interpolation (no template engine). Placeholders in the reference HTML are sample data — the renderer constructs HTML strings directly from `PhaseTransitionBrief` + `Activity` data.

Key rendering rules:
- Column card order: topological sort order (from coordinator)
- Empty columns: show hex empty state, count = 0
- Replanning notes: render one bar per note, sorted by severity (blocking first)
- Activity feed: last 20 entries from all `.forge/audit/` JSONL files (via `readAuditEntries()`), reverse chronological
- All monetary values: 2 decimal places (`$X.XX`)
- All timestamps: `HH:MM:SS` format in local time
- Story IDs: green monospace (`--font-mono`, `--green`, 600 weight)
- Null budgets/time limits: show "no limit" text instead of progress bar
- Activity feed rows: each row has CSS class `feed-entry` for testability

## Test Cases & AC

### AC-01: Dashboard file is generated
- **Given:** `.forge/runs/` contains at least 1 RunRecord
- **When:** `forge_coordinate` is called
- **Then:** `.forge/dashboard.html` exists and is valid HTML (contains `<html>`, `<body>`, `</html>`)
- **Pass/Fail:** File exists AND `grep -c '<html>' .forge/dashboard.html` returns 1

### AC-02: All 6 columns render
- **Given:** Stories exist in all 6 statuses (pending, ready, in-progress via activity.json, ready-for-retry, done, failed)
- **When:** Dashboard is rendered
- **Then:** HTML contains 6 column elements with IDs: `col-backlog`, `col-ready`, `col-in-progress`, `col-retry`, `col-done`, `col-blocked`
- **Pass/Fail:** Each column ID appears exactly once: `grep -c 'id="col-backlog"' dashboard.html` returns 1 (repeat for all 6)

### AC-03: Story cards appear in correct columns
- **Given:** Story US-01 has status `done`, Story US-02 has status `ready`
- **When:** Dashboard is rendered
- **Then:** US-01 card is inside `col-done` div, US-02 card is inside `col-ready` div
- **Pass/Fail:** Unit test calls `renderDashboard()` with known input, parses returned HTML string with a regex that extracts the content between each column's opening `<div id="col-{name}"` and its closing `</div>` at the same nesting level, then asserts US-01 appears in the `col-done` content and US-02 appears in the `col-ready` content.

### AC-04: In-Progress card shows live data from activity.json
- **Given:** `activity.json` contains `{ "tool": "forge_generate", "storyId": "US-03", "stage": "critic round 2" }`
- **When:** Dashboard is rendered
- **Then:** `col-in-progress` contains a card for US-03 showing "forge_generate" and "critic round 2"
- **Pass/Fail:** Card text contains both "forge_generate" and "critic round 2"

### AC-05: Staleness banner works
- **Given:** The `classifyStaleness(elapsedMs)` pure function is exported from `dashboard-renderer.ts`
- **When:** Called with three elapsed values: 30000, 90000, 150000
- **Then:** Returns `"green"`, `"amber"`, `"red"` respectively
- **Pass/Fail:** Unit test imports `classifyStaleness` from `dashboard-renderer.ts` (exported as a named function for testability), calls it with the three values, asserts return values match. No JSDOM needed — pure number-to-string function.

### AC-06: Auto-refresh meta tag present
- **Given:** Any rendered dashboard
- **When:** HTML is inspected
- **Then:** Contains `<meta http-equiv="refresh" content="5">`
- **Pass/Fail:** `grep -c 'meta http-equiv="refresh" content="5"' dashboard.html` returns 1

### AC-07: Header shows budget and progress
- **Given:** PhaseTransitionBrief with `completedCount: 4, totalCount: 9, budget.usedUsd: 2.15, budget.budgetUsd: 10`
- **When:** Dashboard is rendered
- **Then:** Header contains "4/9" and "$2.15" and "$10"
- **Pass/Fail:** All three strings present in header element

### AC-08: Activity feed shows recent events
- **Given:** `.forge/audit/` contains JSONL files with 15 total entries across multiple files
- **When:** Dashboard is rendered
- **Then:** Activity feed section contains exactly 15 entries (under the 20-entry cap). The entries are in reverse chronological order.
- **Pass/Fail:** Unit test renders dashboard, counts elements with class `feed-entry` (expects 15), asserts first entry ISO timestamp > last entry ISO timestamp via Date object comparison.

### AC-09: Atomic write uses tmp-then-rename
- **Design constraint:** `dashboard-renderer.ts` must write to `.forge/dashboard.tmp.html` then call `fs.rename()` to `.forge/dashboard.html`.
- **Pass/Fail:** Unit test mocks `fs.writeFile` and `fs.rename`, calls `renderDashboard()`, asserts `fs.writeFile` was called with path ending `.tmp.html` and `fs.rename` was called with args `('.forge/dashboard.tmp.html', '.forge/dashboard.html')`.

### AC-10: Graceful fallback when activity.json absent
- **Given:** No `.forge/activity.json` file exists
- **When:** Dashboard is rendered
- **Then:** "In Progress" column is empty (no crash, no error)
- **Pass/Fail:** Dashboard renders without error AND col-in-progress has zero cards

### AC-11: No external dependencies in HTML
- **Given:** Any rendered dashboard HTML
- **When:** HTML is inspected
- **Then:** No `<link>` to external CSS, no `<script src="...">`, no CDN references
- **Pass/Fail:** `grep -c 'cdn\|googleapis\|unpkg\|cloudflare' dashboard.html` returns 0

### AC-12: Render failure does not crash the tool
- **Given:** `renderDashboard()` is called with a `PhaseTransitionBrief` that has `stories: []` (empty array)
- **When:** The renderer executes
- **Then:** No error is thrown. Dashboard HTML is produced with all columns empty (count = 0 for each).
- **Pass/Fail:** Unit test calls `renderDashboard()` with empty stories array, asserts no exception thrown AND output contains all 6 column IDs.

### AC-13: Null budget renders gracefully
- **Given:** PhaseTransitionBrief with `budget.budgetUsd: null` (no budget set)
- **When:** Dashboard is rendered
- **Then:** Budget stat card shows used amount and "no limit" text instead of a fill bar
- **Pass/Fail:** Unit test renders dashboard with null budgetUsd, asserts output contains "no limit" and does not contain "NaN" or "null"

### AC-14: Null time limit renders gracefully
- **Given:** PhaseTransitionBrief with `timeBudget.maxTimeMs: null` (no time limit set)
- **When:** Dashboard is rendered
- **Then:** Time stat card shows elapsed time and "no limit" text instead of a fill bar
- **Pass/Fail:** Unit test renders dashboard with null maxTimeMs, asserts output contains "no limit" and does not contain "NaN" or "null"

### AC-15: Coordinator writes coordinate-brief.json
- **Given:** `forge_coordinate` is called and `assessPhase()` returns a `PhaseTransitionBrief`
- **When:** The coordinator completes
- **Then:** `.forge/coordinate-brief.json` exists and contains valid JSON with `status`, `stories`, `completedCount`, `totalCount` fields
- **Pass/Fail:** Unit test calls the coordinator's brief-writing logic with a known `PhaseTransitionBrief`, reads the written file, asserts all four fields are present and match input values.

### AC-16: Activity feed displays actual AuditEntry fields
- **Given:** `.forge/audit/` contains a JSONL file `forge_generate-2026-04-11T10-30-00-000Z.jsonl` with an entry `{ "timestamp": "...", "stage": "critic round 2", "agentRole": "critic", "decision": "revise", "reasoning": "..." }`
- **When:** Dashboard is rendered
- **Then:** Activity feed shows the entry with "critic round 2" (stage) and "revise" (decision). The tool name "forge_generate" is extracted from the filename and shown as a hex-dot accent.
- **Pass/Fail:** Unit test renders dashboard with known audit file, asserts feed contains "critic round 2" and "revise". Does NOT assert presence of "storyId" or "score" (fields that do not exist in `AuditEntry`).

## TC-CHECK (Mechanical Self-Check)

All ACs use grep on static HTML files or unit tests calling `renderDashboard()` — not runtime subprocess tests. The project uses ESM (`"type": "module"` in package.json).

- TC-CHECK: AC-01 — ESM:n/a (grep), target:ok, ext:ok, precond:ok, async:n/a, cleanup:n/a, paths:n/a
- TC-CHECK: AC-02 — ESM:n/a (grep), target:ok, ext:ok, precond:ok, async:n/a, cleanup:n/a, paths:n/a
- TC-CHECK: AC-03 — ESM:ok (unit test imports), target:ok (regex extraction of column content, checks card membership), ext:ok, precond:ok (known input), async:ok (renderDashboard is async, will await), cleanup:n/a, paths:n/a
- TC-CHECK: AC-04 — ESM:ok, target:ok, ext:ok, precond:ok, async:n/a, cleanup:n/a, paths:n/a
- TC-CHECK: AC-05 — ESM:ok (imports classifyStaleness from dashboard-renderer.ts), target:ok (tests pure function with 3 numeric inputs), ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:n/a
- TC-CHECK: AC-06 — ESM:n/a (grep), target:ok, ext:ok, precond:ok, async:n/a, cleanup:n/a, paths:n/a
- TC-CHECK: AC-07 — ESM:ok, target:ok, ext:ok, precond:ok, async:n/a, cleanup:n/a, paths:n/a
- TC-CHECK: AC-08 — ESM:ok, target:ok (counts feed-entry elements and checks ordering via Date objects), ext:ok, precond:ok (15 entries across multiple JSONL files), async:ok, cleanup:ok (test creates temp JSONL, cleans up), paths:ok (import.meta.url)
- TC-CHECK: AC-09 — ESM:ok (unit test imports), target:ok (mocks fs.writeFile and fs.rename, asserts call args), ext:ok, precond:ok, async:ok, cleanup:n/a, paths:n/a
- TC-CHECK: AC-10 — ESM:ok, target:ok, ext:ok, precond:ok (no activity.json), async:ok, cleanup:n/a, paths:n/a
- TC-CHECK: AC-11 — ESM:n/a (grep), target:ok, ext:ok, precond:ok, async:n/a, cleanup:n/a, paths:n/a
- TC-CHECK: AC-12 — ESM:ok, target:ok (tests empty stories don't crash), ext:ok, precond:ok, async:ok, cleanup:n/a, paths:n/a
- TC-CHECK: AC-13 — ESM:ok, target:ok (tests null budget renders text), ext:ok, precond:ok, async:ok, cleanup:n/a, paths:n/a
- TC-CHECK: AC-14 — ESM:ok, target:ok (tests null maxTimeMs renders text), ext:ok, precond:ok, async:ok, cleanup:n/a, paths:n/a
- TC-CHECK: AC-15 — ESM:ok, target:ok (tests file write with known brief), ext:ok, precond:ok, async:ok, cleanup:ok (temp dir), paths:ok
- TC-CHECK: AC-16 — ESM:ok, target:ok (tests feed renders AuditEntry fields from known file), ext:ok, precond:ok (known JSONL file), async:ok, cleanup:ok (temp dir), paths:ok

## Checkpoint

- [ ] Save plan file
- [ ] Design UI with frontend-design skill
- [ ] Run /double-critique
- [ ] Review and finalize plan
- [ ] Write `.forge/coordinate-brief.json` from coordinator (Hook 0)
- [ ] Implement `server/lib/activity.ts`
- [ ] Implement `server/lib/dashboard-renderer.ts`
- [ ] Extend ProgressReporter constructor with optional `projectPath` and `storyId`
- [ ] Hook into ProgressReporter begin/complete
- [ ] Hook into writeRunRecord
- [ ] Write unit tests for dashboard-renderer
- [ ] Write unit tests for activity signal
- [ ] Dogfood: run forge_coordinate and verify dashboard renders
- [ ] Stateless review

Last updated: 2026-04-11T12:00:00Z

---

## Corrector Notes (Final Pass)

### Critic 2 Finding 1 (CRITICAL: `coordinate-brief.json` not written) — VALID, FIXED

The critic is correct: `coordinate-brief.json` does not exist anywhere in the codebase. Zero search hits for `coordinate-brief.json` or `coordinateBrief` in `server/`. The corrector1 version acknowledged this in the notes ("aspirational statement") but left the main body claiming "the coordinator already writes this file." Fixed by:
- Adding "Hook 0" as an explicit new integration point with code snippet
- Changing the Data Flow section to say "This file does not exist today" instead of the false claim
- Adding the coordinator write to the Data Flow diagram
- Adding AC-15 to verify the file is written
- Adding a checkpoint step for this work

```
SIDE-EFFECT-CHECK: Added Hook 0 for coordinate-brief.json
  format: ok
  naming: ok
  shape:  "New integration point added; data flow diagram updated; AC-15 and checkpoint step added"
  refs:   "Data Flow section, Integration Points, AC-15, Checkpoint all updated consistently"
```

### Critic 2 Finding 2 (MAJOR: "Last line from each file" discards entries) — VALID, FIXED

The critic is correct: `readAuditEntries()` at `server/lib/run-reader.ts:160-213` reads ALL lines from ALL files (`content.split("\n")` + parse each line). The corrector1 "last line from each file" strategy would discard the majority of audit data. A single forge_generate run with 5 critic rounds produces 10+ entries in one file. Fixed by:
- Changing strategy to read all lines from all files (reusing `readAuditEntries()`)
- Removing the "last line only" performance note (reading all lines from small JSONL files is negligible)
- Referencing the existing function by name

```
SIDE-EFFECT-CHECK: Audit feed strategy changed to all-lines-all-files
  format: ok
  naming: ok
  shape:  "Uses existing readAuditEntries() instead of custom last-line logic"
  refs:   "Audit Feed Reading Strategy section updated; rendering rules bullet updated"
```

### Critic 2 Finding 3 (MAJOR: `AuditEntry` lacks tool/storyId/score) — VALID, FIXED

The critic is correct: `AuditEntry` has only `timestamp`, `stage`, `agentRole`, `decision`, `reasoning`. No `tool`, `storyId`, or `score` fields. The original mockup showed `tool | story ID | action (score)` which cannot be built from the actual data. Fixed by:
- Redesigning the feed display format to show actual `AuditEntry` fields: `timestamp | stage | (decision: {decision})`
- Tool name extracted from filename (format: `{toolName}-{timestamp}.jsonl`)
- Updated the ASCII mockup to reflect actual fields
- Added AC-16 to verify the feed renders actual `AuditEntry` fields
- Explicitly noted that storyId and score are NOT available in the feed

```
SIDE-EFFECT-CHECK: Activity feed redesigned around actual AuditEntry schema
  format: ok
  naming: ok
  shape:  "Feed columns changed from time|tool|storyId|action to time|stage|decision|agentRole; mockup updated; AC-16 added"
  refs:   "Dashboard Layout mockup, Activity Feed section, Audit Feed Reading Strategy, Visual Hierarchy #5, AC-16 all consistent"
```

### Critic 2 Finding 4 (MAJOR: ProgressReporter has no projectPath) — VALID, FIXED

The critic is correct: `ProgressReporter` constructor takes only `(toolName: string, stages: string[])` with no `projectPath` or `storyId`. Without `projectPath`, it cannot write `.forge/activity.json`. Fixed by:
- Specifying the constructor change: add optional `projectPath?: string` and `storyId?: string`
- Analyzing blast radius: existing call sites pass only 2 args, new params are optional, zero breakage
- Only `forge_coordinate`'s call site needs updating
- Added to checkpoint as its own step

```
SIDE-EFFECT-CHECK: ProgressReporter constructor extension specified
  format: ok
  naming: ok
  shape:  "New optional params added; blast radius analyzed; checkpoint step added"
  refs:   "Hook 1 section updated; Checkpoint updated"
```

### Critic 2 Finding 5 (MINOR: classifyStaleness dual existence) — VALID, FIXED

The critic is correct: the function must exist both as a TypeScript export (for testing) and as inline JS in the HTML (for browser execution). Added a clarifying comment in the Hang Detection JS section explaining the dual-existence pattern (defined in TS, serialized into HTML via string template). Also updated the New Files table description.

```
SIDE-EFFECT-CHECK: classifyStaleness dual existence clarified
  format: ok
  naming: ok
  shape:  ok
  refs:   "Hang Detection JS section, New Files table both updated"
```

### Critic 2 Finding 6 (MINOR: `feed-entry` class undocumented) — VALID, FIXED

The critic is correct: AC-08 asserts on class `feed-entry` but no spec section defined it. Added `feed-entry` as a required CSS class in both the Visual Hierarchy section (#5, Activity Feed) and the Key rendering rules list.

```
SIDE-EFFECT-CHECK: feed-entry class name specified
  format: ok
  naming: ok
  shape:  ok
  refs:   "Visual Hierarchy #5, Key rendering rules, AC-08 all consistent"
```

### Critic 2 Finding 7 (MINOR: No AC for null maxTimeMs) — VALID, FIXED

The critic is correct: `maxTimeMs: number | null` is symmetric with `budgetUsd: number | null`, but only budget had a test (AC-13). Added AC-14 mirroring AC-13 for the time case. Added TC-CHECK entry.

```
SIDE-EFFECT-CHECK: AC-14 added for null maxTimeMs
  format: ok
  naming: ok
  shape:  ok
  refs:   "AC-14, TC-CHECK for AC-14 both added"
```

### Self-Review Checklist (Final Pass)

1. **Conflicts:** All sections now agree on data flow. The Data Flow diagram shows coordinator writing `coordinate-brief.json`, Hook 0 specifies how, AC-15 verifies it. No contradictions between any sections.

2. **Edge cases:** (a) `readAuditEntries()` with zero audit files returns empty array — feed renders empty, no crash (covered by existing function's graceful degradation). (b) `coordinate-brief.json` missing on first ProgressReporter call — renderDashboard() renders degraded dashboard (specified in Data Flow section). (c) ProgressReporter called without projectPath (existing call sites) — no file I/O attempted, existing behavior preserved.

3. **Interactions:** Finding 2 (all-lines strategy) + Finding 3 (AuditEntry schema) interact: both affect the feed display. The feed now reads all lines (Finding 2) and displays actual AuditEntry fields (Finding 3) — these are coherent. Finding 4 (ProgressReporter constructor) + Finding 1 (coordinate-brief.json) interact: the ProgressReporter needs projectPath to call renderDashboard(), which reads coordinate-brief.json. If coordinate-brief.json doesn't exist yet (first call before coordinator writes it), renderDashboard() renders degraded — this is specified.

4. **New additions:**
   - Hook 0 (coordinator writes brief): traced — assessPhase() returns PhaseTransitionBrief, Hook 0 writes it, renderDashboard() reads it. AC-15 verifies.
   - AC-14 (null maxTimeMs): mirrors AC-13 structure exactly. No new edge cases.
   - AC-15 (coordinator writes file): tests the new Hook 0. Straightforward file-write verification.
   - AC-16 (feed displays AuditEntry fields): tests the redesigned feed against actual schema. Uses known JSONL file.
   - ProgressReporter `projectPath`/`storyId` params: optional, default undefined, existing call sites unaffected.

5. **Evidence-gated verification:**
   - VERIFIED: `coordinate-brief.json` does NOT exist in codebase — searched `server/` for `coordinate-brief.json` and `coordinateBrief`, zero hits.
   - VERIFIED: `readAuditEntries()` reads all lines at `server/lib/run-reader.ts:196-209` — `"const lines = content.split("\n").filter(...)` then `for (const line of lines) { JSON.parse(line) }`
   - VERIFIED: `AuditEntry` interface at `server/lib/audit.ts:11-17` — fields are `timestamp`, `stage`, `agentRole`, `decision`, `reasoning` only.
   - VERIFIED: `ProgressReporter` constructor at `server/lib/progress.ts:25` — `constructor(toolName: string, stages: string[])`, no `projectPath`.
   - VERIFIED: `writeRunRecord` signature at `server/lib/run-record.ts:85` — `writeRunRecord(projectPath: string, record: RunRecord)`, already has projectPath.
   - VERIFIED: `CoordinateResult` contains `brief: PhaseTransitionBrief` at `server/types/coordinate-result.ts:104-108`.

## Critique Log

### Round 1 (Critic-1)
- **CRITICAL:** 1
- **MAJOR:** 4
- **MINOR:** 5

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | AC-03 column order wrong — `col-retry` before `col-done` makes indexOf assertion fail | Yes | Replaced with regex-based column content extraction |
| 2 | MAJOR | Audit feed reads only most recent file — misses interleaved tool entries shown in mockup | Yes | Changed to multi-file merge-sort, last 20 entries |
| 3 | MINOR | dep-failed cards have no rendering spec in Card Variants | Yes | Split into separate "Failed" and "Dep-Failed" rows |
| 4 | MAJOR | No spec for how renderDashboard() obtains PhaseTransitionBrief | Yes | Added coordinate-brief.json disk read path |
| 5 | MINOR | AC-05 claims no JSDOM but tests DOM code | Yes | Extracted classifyStaleness as pure function |
| 6 | MINOR | Crash vs hung indistinguishable | Yes | Added "Known limitation" note |
| 7 | CRITICAL | HH:MM:SS string comparison breaks at midnight | Yes | Changed to Date object comparison |
| 8 | MINOR | 10-entry feed limit too small for retries | Yes | Increased to 20, noted full history in audit |
| 9 | MINOR | .forge/ directory might not exist | Yes | Added fs.mkdir({ recursive: true }) bootstrap |
| 10 | MAJOR | AC-09 is code inspection, not automated test | Yes | Replaced with unit test mocking fs.writeFile/fs.rename |

### Round 2 (Critic-2)
- **CRITICAL:** 1
- **MAJOR:** 3
- **MINOR:** 3

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | CRITICAL | coordinate-brief.json never written — plan assumes nonexistent file | Yes | Added Hook 0 + AC-15 + checkpoint step |
| 2 | MAJOR | "Last line from each file" discards most audit entries | Yes | Changed to read all lines from all files |
| 3 | MAJOR | AuditEntry schema lacks tool/storyId/score fields needed by feed | Yes | Redesigned feed to use actual AuditEntry fields (stage/decision/agentRole) |
| 4 | MAJOR | ProgressReporter has no projectPath/storyId — can't write activity.json | Yes | Added optional params, enumerated call sites, added checkpoint step |
| 5 | MINOR | classifyStaleness dual existence unspecified | Yes | Clarified: defined once in TS, serialized into HTML |
| 6 | MINOR | feed-entry class name used in AC but not in spec | Yes | Added to Visual Hierarchy and rendering rules |
| 7 | MINOR | Missing AC for null maxTimeMs | Yes | Added AC-14 mirroring AC-13 |

### Summary
- Total findings: 17 across both rounds
- Applied: 17 (100%)
- Rejected: 0 (0%)
- Key changes: Fixed phantom data source (coordinate-brief.json), redesigned activity feed to match actual AuditEntry schema, added error handling policy, specified ProgressReporter constructor changes with blast radius analysis, increased ACs from 11 to 16, increased checkpoint steps from 12 to 14
