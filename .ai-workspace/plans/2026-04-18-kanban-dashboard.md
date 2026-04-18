# Kanban Dashboard for forge_coordinate (outcome-shaped)

## ELI5

We want a "whiteboard" web page that shows what the forge robot is doing right now. Story sticky notes sit in columns (Backlog / Ready / In Progress / Retry / Done / Blocked). The page reloads itself every few seconds, and the banner turns amber then red if the robot goes quiet. No server, no dependencies — just a local HTML file the robot rewrites whenever state changes, openable with `file://`.

The executor picks *how* to build it. This plan says only *what must be true when it's done*.

## Context

forge_coordinate v0.20.0 shipped as the 4th and final forge primitive (`project_forge_coordinate_roadmap.md`), but operators can currently only see state by tailing stderr or reading JSON in `.forge/runs/`. The Kanban dashboard is the remaining roadmap item (S8) — it lights up the existing state so a human can glance at it instead of reading tool output.

A prescriptive design was drafted on 2026-04-11 (`.ai-workspace/plans/2026-04-11-kanban-dashboard.md`) and passed two rounds of `/double-critique` with 17 findings applied at 100%. That doc remains the **design appendix** — its VERIFIED schema decisions, column layout, design-system colors, and the four Critic-2 "nailed it" findings (phantom `coordinate-brief.json`, AuditEntry schema, `readAuditEntries` all-lines-all-files, ProgressReporter `projectPath` gap) are all still valid as of today's drift check and must not be regressed.

This rewrite converts that doc to an outcome-shaped brief suitable for `/delegate`: the executor is free to pick file names, integration-point shapes, and test patterns, as long as the invariants hold and the binary AC pass.

## Goal (invariants that must hold when done)

1. **Operator can see current story state via one local file.** Opening `.forge/dashboard.html` in any modern browser renders a Kanban view with 6 columns reflecting `StoryStatus` + a derived "In Progress" column. No server, no npm dependency, no WebSocket, `file://` protocol works.
2. **Dashboard updates within ~5s of any state transition** driven by forge_coordinate or any primitive using `ProgressReporter`. Staleness > 60s is amber, > 120s is red, visible in a banner.
3. **Dashboard I/O never crashes the parent tool.** Any failure to read, render, or write dashboard / activity / coordinate-brief files is logged to stderr and swallowed — matching the existing `writeRunRecord` and `AuditLog` error policy.
4. **Schema fidelity:** the dashboard renders only fields that actually exist on `AuditEntry`, `PhaseTransitionBrief`, `BudgetInfo`, `TimeBudgetInfo`, and `StoryStatusEntry`. Null `budgetUsd` and null `maxTimeMs` render a "no limit" text, not `NaN` or `null`. Stories in all 6 `StoryStatus` values route to the correct column.
5. **Dashboard is stateless.** Every render is a pure function of `(coordinate-brief-on-disk, activity-on-disk, audit-JSONL-on-disk)` — no in-memory accumulation, no delta logic. On crash, the next successful run self-heals the files.

## Binary AC

All AC are checkable from *outside* the diff — grep on the output file, unit test of an exported pure function, or existence of a JSON file with required shape. None require reading the implementation.

- **AC-01** — After `forge_coordinate` runs against a fixture project with ≥1 `RunRecord`, `.forge/dashboard.html` exists AND `grep -c '<html>' .forge/dashboard.html` returns `1`.
- **AC-02** — Dashboard HTML contains exactly one element per column ID. `for id in col-backlog col-ready col-in-progress col-retry col-done col-blocked; do grep -c "id=\"$id\"" .forge/dashboard.html; done` returns `1` six times.
- **AC-03** — Unit test: rendering with `stories: [{storyId: "US-01", status: "done"}, {storyId: "US-02", status: "ready"}]` produces HTML where `US-01` text appears inside the `col-done` content block and `US-02` appears inside the `col-ready` content block. "Inside" is defined by regex-extracting text between the column's opening `<div id="col-X"` and its matching close at the same nesting level.
- **AC-04** — When `.forge/activity.json` contains `{"tool":"forge_generate","storyId":"US-03","stage":"critic round 2","startedAt":"..."}`, the rendered dashboard's `col-in-progress` content contains both the strings `forge_generate` and `critic round 2`.
- **AC-05** — A pure function `classifyStaleness(elapsedMs: number): "green" | "amber" | "red"` is exported from the dashboard renderer module. Called with `30000`, `90000`, `150000` it returns `"green"`, `"amber"`, `"red"` respectively. No JSDOM / browser environment needed in the test.
- **AC-06** — `grep -c 'meta http-equiv="refresh" content="5"' .forge/dashboard.html` returns `1`.
- **AC-07** — With a `PhaseTransitionBrief` whose `completedCount=4, totalCount=9, budget.usedUsd=2.15, budget.budgetUsd=10`, the dashboard's header section contains all three substrings: `4/9`, `$2.15`, `$10`.
- **AC-08** — With `.forge/audit/` containing 15 total `AuditEntry` lines spread across multiple JSONL files, the dashboard contains exactly 15 elements matching CSS class `feed-entry`. The first entry's ISO timestamp is strictly greater than the last entry's (reverse chronological), asserted via `Date` object comparison.
- **AC-09** — Unit test mocks `fs.writeFile` and `fs.rename`: a render call produces one `writeFile` call whose path ends with `.tmp.html` followed by one `rename` call to the final `.html` path. (Enforces atomic write.)
- **AC-10** — When `.forge/activity.json` is absent at render time, the dashboard renders without throwing AND `col-in-progress` contains zero cards. Unit test asserts both.
- **AC-11** — `grep -cE 'cdn|googleapis|unpkg|cloudflare' .forge/dashboard.html` returns `0`. No `<link rel="stylesheet" href="http...">` and no `<script src="http...">` present.
- **AC-12** — Render with `stories: []` produces valid HTML (contains all 6 column IDs, each with count `0`) and throws no exception.
- **AC-13** — Render with `budget.budgetUsd: null` produces HTML containing the substring `no limit` and containing neither `NaN` nor the literal string `null` inside the budget stat card.
- **AC-14** — Render with `timeBudget.maxTimeMs: null` produces HTML containing `no limit` in the time stat card and containing neither `NaN` nor `null`.
- **AC-15** — After `forge_coordinate` completes one invocation against a fixture, `.forge/coordinate-brief.json` exists, parses as JSON, and has non-null values for at least these fields: `status`, `stories`, `completedCount`, `totalCount`. (Closes the Critic-2 Finding-1 gap: the file must actually be written.)
- **AC-16** — Activity feed rendering references `stage`, `decision`, and `agentRole` (fields that exist on `AuditEntry`). The rendered HTML contains these values for a known fixture entry. The rendering does NOT attempt to read `AuditEntry.storyId`, `AuditEntry.tool`, or `AuditEntry.score` (fields that do not exist on the interface) — asserted by: either (a) TypeScript build succeeds with `strict` on, or (b) grep over the renderer source shows no references to those missing field names.
- **AC-17** — Build + tests pass: `npm run build` exits 0; `npm test` exits 0; `vitest run server/smoke/mcp-surface.test.ts` exits 0 (per `feedback_local_vs_ci_smoke_tests.md`). No new failures vs master's current state (delta-based).
- **AC-18** — A dashboard-render failure in isolation does not surface as a tool-level error. Unit test: inject a failure in the dashboard writer (e.g. `fs.writeFile` throws), call a primitive's `ProgressReporter.complete()` path, assert the primitive's public function still resolves successfully. Mirrors existing `writeRunRecord` and `AuditLog` failure policy.

## Out of scope

The executor must NOT touch any of the following:

1. **No new npm dependencies.** HTML must be self-contained (inline CSS + JS).
2. **No local server, no WebSocket, no SSE.** Polling via `<meta refresh>` only.
3. **No user interaction** in the dashboard. Read-only display. No forms, no buttons that submit.
4. **No change to `AuditEntry`, `StoryStatus`, `PhaseTransitionBrief`, `BudgetInfo`, or `TimeBudgetInfo` schemas.** The dashboard consumes them; extending them is a separate concern.
5. **No race-resolution for concurrent forge invocations.** Momentary display of wrong tool name is acceptable per the design appendix.
6. **No hung-vs-crashed distinction.** Red banner covers both; operator inspects externally.
7. **No backfill of `projectPath` to existing `ProgressReporter` call sites** beyond what's required to make the in-progress column populate (coordinator must pass it; others may opt in later).
8. **No browser-compat polyfills** for browsers older than ES2020.
9. **No `/ship`, no PR, no release from the executor.** Stop at "branch exists locally with changes + acceptance wrapper green." Planner closes the loop per the standard review protocol.
10. **No edit to `.ai-workspace/plans/2026-04-11-kanban-dashboard.md`.** That doc is the design appendix; it must remain intact as the critique record.

## Ordering constraints

- **AC-15 (coordinate-brief.json written by coordinator) must land in the same PR as any AC that reads it.** Otherwise first-run renders have nothing to read and fail AC-01/AC-02. Rationale: the design appendix's Critic-2 Finding 1 identified that this file did not exist today; writer + reader ship together.
- All other AC are independent and may be implemented in any order.

## Critical files (paths + one-line role, NOT edit shape)

| Path | Role |
|---|---|
| `.forge/dashboard.html` | NEW output artefact. Single self-contained HTML, rewritten on every state transition. |
| `.forge/activity.json` | NEW ephemeral in-flight signal. Contains `{tool, storyId, stage, startedAt, lastUpdate}` while a primitive is running; cleared on `writeRunRecord`. |
| `.forge/coordinate-brief.json` | NEW persisted snapshot of `PhaseTransitionBrief`. Written by coordinator after `assessPhase()`. |
| `server/lib/coordinator.ts` | Existing. Must gain the coordinate-brief write after `assessPhase()`. Location of `assessPhase()` call is executor's call. |
| `server/lib/progress.ts` | Existing. `ProgressReporter` constructor at line 25 (`(toolName, stages)`). Must gain an optional mechanism for passing `projectPath` and `storyId` so `begin()`/`complete()` can update activity + trigger render. Blast radius: all existing call sites pass only 2 args; extension must be optional. |
| `server/lib/run-record.ts` | Existing. `writeRunRecord(projectPath, record)` at line 108. Must clear activity.json + trigger one final render on completion. |
| `server/lib/audit.ts` | Existing. `AuditEntry` interface at lines 11-17 — fields `timestamp / stage / agentRole / decision / reasoning` only. Read-only reference for AC-16. |
| `server/lib/run-reader.ts` | Existing. `readAuditEntries(projectPath, toolName?)` at line 160 reads ALL lines from ALL JSONL files. Reuse this; do not write a "last line" variant (design appendix Critic-2 Finding 2). |
| `server/types/coordinate-result.ts` | Existing. `StoryStatus` (6 values, lines 5-11), `PhaseTransitionBrief` (line 92), `BudgetInfo.budgetUsd: number \| null` (line 37), `TimeBudgetInfo.maxTimeMs: number \| null` (line 45), `ReplanningSeverity` (line 58). Read-only reference. |
| `.ai-workspace/plans/dashboard-reference.html` | Existing. Visual mockup in the design-system cream/hex aesthetic. Reference target for look-and-feel. |
| `.ai-workspace/plans/2026-04-11-kanban-dashboard.md` | Existing. **Design appendix** — keeps the two critique rounds' findings durable. Read for schema decisions and design-system compliance; do not edit. |
| (new) dashboard renderer module | NEW. Executor picks path and file name. Must export `classifyStaleness` as a named pure function. Reads the two JSON files from disk on each call (stateless). Writes atomically via `.tmp.html` + rename. |
| (new) activity signal writer | NEW. Executor picks path and file name. Writes `activity.json` with atomic write semantics; handles directory bootstrap. |

## Verification procedure (reviewer's script)

Reviewer is a stateless subagent with zero implementation context, the AC list above, and the PR diff. Reviewer runs:

1. `npm ci && npm run build` — must exit 0.
2. `npm test` — must pass all tests. No new failures vs master.
3. `vitest run server/smoke/mcp-surface.test.ts` — must exit 0.
4. Check out PR branch; cd to a fixture project with seeded `.forge/runs/*.json`; run `forge_coordinate` once via its MCP tool.
5. Assert `.forge/dashboard.html` exists → AC-01.
6. Run the 6-column grep loop from AC-02.
7. Run the meta-refresh grep from AC-06.
8. Run the no-external-deps grep from AC-11.
9. Assert `.forge/coordinate-brief.json` parses with the 4 required fields → AC-15.
10. Run the new unit tests for classifyStaleness (AC-05), empty-stories render (AC-12), null-budget render (AC-13), null-maxTimeMs render (AC-14), AuditEntry-field rendering (AC-16), atomic-write mock (AC-09), activity.json-absent render (AC-10), dashboard-failure-isolation (AC-18).
11. Verify AC-03, AC-04, AC-07, AC-08 via the unit tests' assertions.
12. Report PASS or list failing AC numbers with evidence. Do not auto-fix.

## Checkpoint

- [x] Drift check against 2026-04-11 design appendix — all VERIFIED anchors still hold (2026-04-18)
- [x] Outcome-shaped plan drafted
- [ ] Plan approved by user
- [ ] `/delegate --via subagent` invoked with this plan
- [ ] Executor acks within SLA
- [ ] Executor's branch green against the acceptance wrapper (all 18 AC)
- [ ] Stateless reviewer PASS
- [ ] Planner updates this plan's Checkpoint + Goal to match shipped reality
- [ ] Memory `project_forge_coordinate_roadmap.md` updated to remove "S8 pending" (roadmap retires)

Last updated: 2026-04-18T02:00+08:00 — outcome-shaped rewrite complete; pending user approval before `/delegate`.
