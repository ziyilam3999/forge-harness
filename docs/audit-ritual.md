# Forge audit ritual: dashboard events

The audit ritual says: **"Take a Playwright snapshot at every dashboard event."** This page defines exactly which forge primitives ARE dashboard events (i.e. produce a fresh dashboard render) and which are not. End-user `macbook-monday` hit this ambiguity during US-11 (snapshotted after `forge_status` and saw no diff vs. the prior frame); this doc closes the gap.

## Which calls are events

| Primitive             | Dashboard event? | Why                                                                                   |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `forge_generate`      | ✓                | Writes a run record → triggers `renderDashboard` at `writeRunRecord` exit             |
| `forge_evaluate`      | ✓                | Writes a run record → triggers `renderDashboard` at `writeRunRecord` exit             |
| `forge_coordinate`    | ✓                | Writes a run record → triggers `renderDashboard` at `writeRunRecord` exit             |
| `forge_reconcile`     | ✓                | Writes a run record → triggers `renderDashboard` at `writeRunRecord` exit             |
| `forge_plan`          | ✓                | Writes a run record (via `writeRunRecordIfNeeded`) → triggers `renderDashboard`       |
| `forge_declare_story` | ✓                | v0.40.2 wired the wake (`notifyForgeStateWrite()`); render fires on next loop tick    |
| `forge_status`        | ✗                | Read-only: no run record, no `renderDashboard` call, no state-write notification      |
| `forge_lint_refresh`  | ✗                | Read-only: no run record, no `renderDashboard` call, no state-write notification      |

## Source-of-truth references

All line numbers are against master `165a656`.

- **The canonical "primitive finished" hook** lives at `server/lib/run-record.ts:345`. After every `writeRunRecord()`, the function clears the in-flight activity signal and calls `renderDashboard(projectPath)`. Every primitive that calls `writeRunRecord` therefore produces a dashboard event for free.
- **The mid-tool progress hook** at `server/lib/progress.ts:205` fires extra renders during long-running primitives (so the operator sees stage progress). These are intra-call updates, not separate events — count one event per top-level primitive call.
- **The standalone render loop** at `server/lib/dashboard-render-loop.ts:200` re-renders every ~30s while the MCP server is alive (independent of any primitive call). The same file at `:343` fires a one-shot render when the dormant→active disk watcher first sees `.forge/` state appear.
- **The `forge_declare_story` wake** at `server/tools/declare-story.ts:86` calls `notifyForgeStateWrite()`. This is the v0.40.2 fix — declarations live in an in-memory store, so the loop's disk-state probe wouldn't see them otherwise; the explicit wake forces the next loop tick to render.

## Audit-ritual implication

When you take a Playwright snapshot at every dashboard event, you take it after each ✓ call (which produces a new dashboard render, so the snapshot reflects the post-call frame), but NOT after ✗ calls (no new render fires, so a snapshot would just re-capture the previous frame and pollute the audit timeline with duplicates). Concretely: `forge_status` is the example that confused `macbook-monday` during US-11 — they snapshotted after a `forge_status` call expecting a frame transition, saw the same dashboard as before, and assumed the harness was broken. It wasn't: `forge_status` is read-only by design.

## Reciprocal: which calls are NOT events and why

`forge_status` and `forge_lint_refresh` are pure read paths. They neither write a run record nor call `notifyForgeStateWrite()`, so the dashboard render loop has no reason to refresh. If you want a fresh frame after one of these calls, wait for the next ~30s loop tick (`server/lib/dashboard-render-loop.ts:200`) — but most audit rituals just skip the snapshot, since the frame won't have changed.
