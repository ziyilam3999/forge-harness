# Plan: dashboard auto-open hardening (bundled #281/#282/#283)

## ELI5

PR #280's env-gated browser auto-open shipped with three small holes the ship-review flagged:
- **#281** — the "already opened" marker is written immediately after `spawn()` returns, not after the child actually launched. If `xdg-open` is missing, the marker still lands and permanently disables auto-open.
- **#282** — the auto-open helper bypasses the module's `DashboardIo` test seam, so its behavior is effectively untestable without filesystem side effects.
- **#283** — the `stat(markerPath)` catch is a bare `catch {}` that treats any stat failure as "marker absent", so EPERM/EIO would re-open a tab on every render.

All three live in `maybeAutoOpenBrowser()` in `server/lib/dashboard-renderer.ts`. Bundling as one PR because they're one function.

## Context

- Opened by ship-review on PR #280 as enhancement issues #281, #282, #283.
- None are blocking. The env-gate (`FORGE_DASHBOARD_AUTO_OPEN=1`) means production impact is scoped to users who opted in; the failure modes are "auto-open quietly stops working" or "auto-open re-fires on every render when the underlying marker file is unreadable" — both self-recoverable by deleting `.forge/.dashboard-opened`.
- The new CI gate shipped in PR #285 (`.github/workflows/s8-kanban-dashboard-acceptance.yml`) will run the S8 acceptance wrapper on this PR automatically because `server/lib/dashboard-renderer.ts` is in its path filter. Meta-validation: this PR proves the CI gate works.

## Goal

Invariants when this ships:
1. The marker file is written only after the child process has confirmed-spawned (emitted its `"spawn"` event). If spawn fails (`"error"` event), no marker lands and the next render re-attempts.
2. The auto-open code path is unit-testable — there is an injectable I/O seam covering `stat`, `openExternal`, and `writeFile` for the marker.
3. The `stat` catch inside `maybeAutoOpenBrowser` distinguishes ENOENT (marker absent → open it) from other errors (EPERM/EIO/etc → log + skip, do NOT re-open every render).

## Binary AC

1. **Marker-on-spawn fix (#281) — behavior:** exercised via the new unit test, when `openExternal` rejects, `writeFile` is never called. Check: new test `maybeAutoOpenBrowser — marker not written when openExternal rejects` passes.
2. **DashboardIo seam (#282) — interface:** `maybeAutoOpenBrowser` is exported and accepts an `AutoOpenIo` parameter with signature including `stat`, `openExternal`, and `writeFile`. Check: `grep -E "export (async )?function maybeAutoOpenBrowser" server/lib/dashboard-renderer.ts` returns exactly one match; `grep -E "export interface AutoOpenIo" server/lib/dashboard-renderer.ts` returns exactly one match.
3. **Stat-catch narrowing (#283) — behavior:** when `stat` throws a non-ENOENT error, the outer catch logs it AND the function does NOT call `openExternal` or `writeFile`. Check: new test `maybeAutoOpenBrowser — non-ENOENT stat error rethrows` passes.
4. **No regression:** `npm test` exits 0 (744 → 746+ tests, all green).
5. **No regression:** `bash scripts/s8-kanban-dashboard-acceptance.sh` exits 0 with 15/15 PASS.
6. **Live CI proof:** the new `acceptance` workflow (from PR #285) runs on this PR and reports pass.
7. **No regression:** existing renderer tests pass unchanged — the bundled fix MUST NOT modify the `DashboardIo` interface or break the current atomic-write seam. (Separate interface `AutoOpenIo` keeps the seams decoupled.)

## Out of scope

- Changing the env-gate contract (`FORGE_DASHBOARD_AUTO_OPEN=1` stays the opt-in).
- Expanding auto-open to non-first renders or cross-session behavior.
- Adding a CLI flag to re-open without deleting the marker.
- Closing enhancement issues #286/#287/#288/#289 from PR #285's ship-review (those are CI workflow concerns, separate area).

## Ordering constraints

None — single-file implementation change plus two new unit tests, committed together.

## Verification procedure

1. `npm run build` — exits 0.
2. `npm test` — exits 0.
3. `bash scripts/s8-kanban-dashboard-acceptance.sh` — exits 0 with 15/15 PASS.
4. `grep -E "export (async )?function maybeAutoOpenBrowser" server/lib/dashboard-renderer.ts` — exactly one match.
5. `grep -E "export interface AutoOpenIo" server/lib/dashboard-renderer.ts` — exactly one match.
6. After merge: `gh pr checks <pr>` shows `acceptance` check with `pass` conclusion.

## Critical files

- `server/lib/dashboard-renderer.ts` — `maybeAutoOpenBrowser` is promoted to `export`, a new `AutoOpenIo` interface + `DEFAULT_AUTO_OPEN_IO` are introduced, and the three fixes land inside the helper.
- `server/lib/dashboard-renderer.test.ts` — two new tests targeting the new seam.

## Checkpoint

- [ ] Plan written + pushed
- [ ] Implementation done (all 3 fixes in one diff)
- [ ] Two new unit tests passing
- [ ] Full test suite + smoke + acceptance wrapper green locally
- [ ] Ship via /ship — PR opened, CI runs
- [ ] New `acceptance` check (PR #285's gate) passes on this PR — meta-validation
- [ ] Merge + close issues #281, #282, #283

Last updated: 2026-04-19T13:50:00+08:00 — plan draft.
