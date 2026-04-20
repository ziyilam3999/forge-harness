# v0.34.0 — Dashboard runtime bugs (9 fixes + 2 close-and-cite)

## Context

First bundle of the v0.34.x polish sweep. Eleven dashboard bugs surfaced by /ship stateless reviewers across PRs #269, #280, #299, #351, each tagged `enhancement` + `ship-review` — deferred at the time because the PR scope didn't cover them. Now collected into one bundle so we stop rediscovering them on every dashboard touch.

**All 11 claims re-verified DIRECTLY against current master (`ba0f15a` — the Explore subagent's earlier report incorrectly said #282 was open; direct re-read of `server/lib/dashboard-renderer.ts` found `maybeAutoOpenBrowser` already accepting `io: AutoOpenIo = DEFAULT_AUTO_OPEN_IO` and using `io.stat / io.openExternal / io.writeFile`. #282 is already fixed. Bundle reshaped accordingly.):

| # | Surface | File:Line | Severity |
|---|---------|-----------|----------|
| #271 | concurrent-render race | `server/lib/dashboard-renderer.ts:605-616` (`writeDashboardHtml`) + `server/lib/progress.ts:152` | stderr noise, momentary stale file |
| #272 | complete/fail uses stale `currentIndex` | `server/lib/progress.ts:95-99, 109-113` | fragile, unreachable today |
| #273 | AC-18 test trivially passes | `server/lib/dashboard-renderer.test.ts:513-514` | test does not prove isolation |
| #274 | dynamic import in hot path | `server/lib/dashboard-renderer.ts:530` (import) + `:31` (static block) | minor perf + style drift |
| #275 | `activityStartedAt` never reset | `server/lib/progress.ts:81-83` | latent |
| #276 | `renderBoard` guard accepts `{tool: ""}` | `server/lib/dashboard-renderer.ts:273` (while `readActivity:507` filters correctly) | cosmetic empty pill |
| ~~#282~~ | ~~`maybeAutoOpenBrowser` bypasses DashboardIo seam~~ | **already fixed on master** — function signature is `maybeAutoOpenBrowser(projectPath, io: AutoOpenIo = DEFAULT_AUTO_OPEN_IO)` and uses `io.stat/openExternal/writeFile` | close-and-cite only |
| #283 | stat catch too wide | `server/lib/dashboard-renderer.ts:686-702` (narrowing already in place — this is the **same already-landed fix** — verify and close as dup) | already fixed — close-and-cite only |
| #300 | non-object throw guard | `server/lib/dashboard-renderer.ts:690` | purely defensive style (AC-12) |
| #352 | amber-idle banner misleading when tool null | `server/lib/dashboard-renderer.ts:453-474` (`updateBanner` IIFE, intercept at `:461`) | user-visible copy |
| #353 | `isToolRunning` duplicated | `server/lib/dashboard-renderer.ts:426` + `:273` | refactor / drift prevention |

**Three issues warrant special handling:**

- **#282**: ALREADY FIXED on master. `maybeAutoOpenBrowser` accepts `io: AutoOpenIo = DEFAULT_AUTO_OPEN_IO` and routes stat/openExternal/writeFile through it. Close #282 in PR body via `Closes #282` with citation of the current signature.
- **#283**: ALREADY FIXED on master. ENOENT-narrowing patch at `:686-702` with inline comment `"spirit of #283 (#291 widening)"`. Executor verifies the patch still exists, then closes #283 via `Closes #283` in PR body.
- **#276**: asymmetric — `readActivity` at `:507` correctly rejects `{tool: null|undefined}` but NOT `{tool: ""}`. `renderBoard` guard at `:273` has the same gap. Both sites must tighten to `activity.tool != null && activity.tool !== ""` (or equivalent via the extracted `isToolRunning` helper from #353).

**Why now**: user prioritized forge-harness polish sweep over monday resuming US-02. These are real user-visible defects (stderr noise, empty pills, misleading banner copy) and latent-bug prevention. Shipping them first reduces dashboard defect exposure before any further feature work.

## Goal

Outcomes that must hold when done (invariants, not steps):

1. **No concurrent-write race** on `dashboard.tmp.html`. Either per-call unique tmp filenames, or a serialized per-project render queue. Implementation choice left to executor.
2. **Stage-close is self-describing**. `complete(stageName)` / `fail(stageName)` derive the `[N/total]` label from `stageName`, not from the most-recent `begin`. If `stageName` is not in `this.stages`, the close is a no-op (or throws — executor's call, as long as it's documented and tested).
3. **`activityStartedAt` reset discipline**. The reporter has a defined lifecycle event (terminal stage, explicit `reset()`, or equivalent) that clears `activityStartedAt`, so reusing a reporter does not carry forward a stale start timestamp.
4. **Empty-string-tool hygiene**. `{tool: ""}` in activity.json never renders an activity card, banner, or pill. Both `readActivity` and any downstream guards reject empty strings consistently.
5. **`isToolRunning` is a single function**. Both `toolRunning` at `:426` and the `activity && activity.tool` guard at `:273` call the same helper. (Was Goal 6; Goal 5's DashboardIo seam is **already landed** on master — close #282 in PR body without code change.)
6. **Idle-banner intercept catches amber too**. When `TOOL_RUNNING === false`, the banner reads "Idle — no tool running" regardless of whether the level is amber or red.
7. **Dead dynamic import removed**. `readAuditFeed` imports `readdir` via the static top-of-file `node:fs/promises` import block, not a dynamic `await import()`.
8. **Defensive typeof guard on err cast**. The stat-catch at `:690` only reads `.code` when `err` is a non-null object.
9. **AC-18 test proves isolation, not sync-return**. The test injects mocks, lets the fire-and-forget promise resolve, and asserts no unhandled rejection / that the mocked writeActivity + renderDashboard were invoked.

Plus two close-and-cite outcomes:
10. **#282 closed as already-fixed** with a PR-body citation of the current `maybeAutoOpenBrowser` signature.
11. **#283 closed as already-fixed** with a PR-body citation of the ENOENT narrowing currently at `:686-702`.

## Binary AC

All AC run from repo root. Paths are POSIX-relative. Each AC's command prints a one-token verdict (`PASS` / `FAIL`) or exits 0 iff the condition holds.

1. **AC-1 — No concurrent-render race on tmp filename.** Either unique tmp suffixes or a serialized queue is in place. Verifiable structurally: either (a) the shared-literal tmp filename is no longer used (replaced with a unique-suffix path builder — so the literal `"dashboard.tmp.html"` has zero occurrences) OR (b) a specifically-named render-queue/mutex identifier is present in the file:
   ```bash
   # Either the shared literal is gone, or a specifically-named queue/mutex identifier exists.
   # The OR branch uses word-boundaries + specific queue-name tokens (no broad "serial|lock|block" false-positives
   # against existing words like "serialized", "blocked", "inline-block"):
   test "$(grep -cE '"dashboard\.tmp\.html"' server/lib/dashboard-renderer.ts)" -eq 0 \
     || grep -qwE '(renderQueue|renderMutex|renderLock|serialRender|inFlightRender|renderInFlight|writeQueue|pendingRenders|renderPromise|renderChain)' server/lib/dashboard-renderer.ts
   ```
   (Passes if the shared literal is eliminated OR if a specifically-named queue/mutex/in-flight identifier exists. Executor picks approach. If executor adopts a name not in the list above but of equivalent meaning — e.g. `pendingRender`, `serialRenderQueue` — executor MUST extend the regex via plan amendment; do not invent a new identifier without updating AC-1.)

2. **AC-2 — ProgressReporter.complete/fail derives stageNum from stageName.** The methods no longer reference `this.currentIndex` for the fireDashboardHooks call; instead they compute from `stageName`:
   ```bash
   awk '/^  complete\(/,/^  \}$/' server/lib/progress.ts > tmp/v034-0-complete.txt
   awk '/^  fail\(/,/^  \}$/' server/lib/progress.ts > tmp/v034-0-fail.txt
   ! grep -qE 'this\.currentIndex' tmp/v034-0-complete.txt
   ! grep -qE 'this\.currentIndex' tmp/v034-0-fail.txt
   ```
   (Both file bodies must not mention `this.currentIndex` inside the complete/fail function.)

3. **AC-3 — activityStartedAt has a reset path.** The progress.ts source contains at least one assignment that clears or reassigns `activityStartedAt` to `null` or to a new value that is not gated on the `=== null` check:
   ```bash
   # Look for an explicit reset: either an assignment to null, or a method named reset*/clear*
   grep -qE 'activityStartedAt\s*=\s*null' server/lib/progress.ts \
     || grep -qE '(reset|clear|finalize|end)\s*\(' server/lib/progress.ts
   ```

4. **AC-4 — Empty-string tool rejected.** `readActivity` rejects `{tool: ""}` (test must exist and pass):
   ```bash
   npx vitest run server/lib/dashboard-renderer.test.ts --reporter=json --outputFile=tmp/v034-0-dash.json > /dev/null 2>&1 || true
   node -e "const r=require('./tmp/v034-0-dash.json'); if (r.numFailedTests === 0 && r.numPassedTests > 0) process.exit(0); process.exit(1);"
   ```
   (Combined with AC-9's test-count delta, this confirms a new test was added that exercises the empty-string case. Executor picks assertion shape.)

5. **AC-5 — `isToolRunning` helper exists and is called from 2+ sites.** A function named `isToolRunning` is defined in dashboard-renderer.ts and referenced at ≥ 2 call sites. Total `isToolRunning\(` matches must be ≥ 3 (1 definition + 2+ call sites — the definition text `function isToolRunning(` or `const isToolRunning = (` also matches the regex):
   ```bash
   grep -cE '(function isToolRunning|const isToolRunning)' server/lib/dashboard-renderer.ts | awk '$1 >= 1 { exit 0 } { exit 1 }'
   grep -cE 'isToolRunning\(' server/lib/dashboard-renderer.ts | awk '$1 >= 3 { exit 0 } { exit 1 }'
   ```

6. **AC-6 — Idle intercept widens past the narrow master-state pattern.** The `updateBanner` IIFE no longer contains the exact master-state intercept line `!TOOL_RUNNING && level === "red"`. Verifiable structurally by searching the full file for the exact narrow pattern:
   ```bash
   # Fails iff the exact master-state narrow intercept is still present.
   # After fix, executor must change the condition — new forms: `!TOOL_RUNNING && level !== "green"`,
   # `!TOOL_RUNNING && isToolRunning(...)`, or any other widening that isn't the master's exact line.
   ! grep -qE '!\s*TOOL_RUNNING\s*&&\s*level\s*===\s*"red"' server/lib/dashboard-renderer.ts
   ```

7. **AC-7 — Dynamic import eliminated.** `readAuditFeed` no longer contains `await import(`, AND `readdir` is in the static import block from `node:fs/promises`:
   ```bash
   awk '/function readAuditFeed|const readAuditFeed/,/^}$/' server/lib/dashboard-renderer.ts > tmp/v034-0-audit.txt
   ! grep -qE 'await import\(' tmp/v034-0-audit.txt
   # Anchored to the import-line shape: readdir inside the {...} import list from node:fs/promises:
   grep -qE 'import\s*\{[^}]*\breaddir\b[^}]*\}\s*from\s*"node:fs/promises"' server/lib/dashboard-renderer.ts
   ```

8. **AC-8 — New tests added for the fixes.** Test-count delta against master baseline is at least 3 (covers at minimum: #271 race, #273 replacement isolation, #276 empty-string, #272 stage-close-stageName, #275 reset — executor picks which behaviors get dedicated tests, minimum 3 new):
   ```bash
   BEFORE_DASH=$(MSYS_NO_PATHCONV=1 git show origin/master:server/lib/dashboard-renderer.test.ts 2>/dev/null | grep -cE "^\s*(it|test)\s*\(")
   AFTER_DASH=$(grep -cE "^\s*(it|test)\s*\(" server/lib/dashboard-renderer.test.ts)
   BEFORE_PROG=$(MSYS_NO_PATHCONV=1 git show origin/master:server/lib/progress.test.ts 2>/dev/null | grep -cE "^\s*(it|test)\s*\(")
   AFTER_PROG=$(grep -cE "^\s*(it|test)\s*\(" server/lib/progress.test.ts)
   DELTA=$(( (AFTER_DASH - BEFORE_DASH) + (AFTER_PROG - BEFORE_PROG) ))
   [ "$DELTA" -ge 3 ]
   ```
   (Combined new tests across both test files ≥ 3. AC-18 replacement counts as one of them — the original test is either deleted or rewritten.)

9. **AC-9 — Full test suite still green.** Test count meets or exceeds current master baseline of 780:
   ```bash
   mkdir -p tmp && MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/v034-0-full.json > /dev/null 2>&1 || true
   node -e "const r=require('./tmp/v034-0-full.json'); if (r.numFailedTests === 0 && r.numPassedTests >= 780) process.exit(0); console.error('tests: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed'); process.exit(1);"
   ```

10. **AC-10 — Lint green (catch no-unused-vars + other drift).** Including this AC per #370 plan-template rule — this PR touches TS files so lint runs in the wrapper:
    ```bash
    npm run lint > /dev/null 2>&1
    ```

11. **AC-11 — Changes confined to the fix surface (no drive-by edits).** Allowlist glob:
    ```bash
    git diff --name-only master...HEAD | grep -vE '^(server/lib/dashboard-renderer\.ts|server/lib/dashboard-renderer\.test\.ts|server/lib/progress\.ts|server/lib/progress\.test\.ts|\.ai-workspace/plans/2026-04-20-v0-34-0-dashboard-runtime-bugs\.md|scripts/v034-0-acceptance\.sh)$' | wc -l | awk '$1 == 0 { exit 0 } { exit 1 }'
    ```

12. **AC-12 — Defensive typeof guard on stat-catch err cast (#300).** The cast at the auto-open stat-catch site is guarded so a non-object throw (`throw "string"`, `throw null`) does not trigger a property read on a primitive. Structurally: a `typeof err` check appears in the `maybeAutoOpenBrowser` function body:
    ```bash
    awk '/function maybeAutoOpenBrowser/,/^}$/' server/lib/dashboard-renderer.ts > tmp/v034-0-maob-body.txt
    grep -qE '(typeof err\s*===\s*"object"|err && typeof err)' tmp/v034-0-maob-body.txt
    ```

13. **AC-13 — Acceptance wrapper exists and passes end-to-end.**
    ```bash
    test -x scripts/v034-0-acceptance.sh && bash scripts/v034-0-acceptance.sh | tail -1 | grep -q 'ALL V0.34.0 ACCEPTANCE CHECKS PASSED'
    ```

## Out of scope

1. **#282 / #283** — both already fixed on master. PR body cites the current DashboardIo-seam signature at `maybeAutoOpenBrowser` for #282 and the ENOENT-narrowing at `:686-702` for #283. Close both via PR-body `Closes #282` + `Closes #283`. Do NOT re-apply any code for these two issues.
2. **Dashboard tests polish (v0.34.1)** — #293, 294, 295, 301, 302, 303, 355 are the follow-on bundle. This PR adds *new* tests for the fixes but does not refactor existing tests, rename fixtures, factor beforeEach, etc.
3. **Dashboard renderer rewrite** — do NOT restructure the file, extract unrelated helpers, or reorder existing exports. The 9 fixes should read as surgical.
4. **Further guard-logic asymmetries beyond #276** — if you find a third empty-string case elsewhere, file as a follow-up issue, do not fix in this PR.
5. **Package version bump + CHANGELOG** — `/ship` Stage 7 handles these.
6. **Any non-dashboard, non-progress file** — see AC-11 allowlist.
7. **Other v0.34.x bundles** — setup-config (v0.34.2), wrapper hygiene (v0.34.3), anthropic (v0.34.4), evaluate (v0.34.5), CI (v0.34.6). Strictly scoped to this PR.

## Verification procedure

Reviewer runs `bash scripts/v034-0-acceptance.sh` from repo root. The script runs AC-1 through AC-13 in order and exits 0 iff all pass. Print-on-pass: `ALL V0.34.0 ACCEPTANCE CHECKS PASSED`.

Reviewer then manually verifies the two already-fixed claims: (a) `maybeAutoOpenBrowser` signature accepts `io: AutoOpenIo = DEFAULT_AUTO_OPEN_IO` and routes through `io.*` — #282 close-and-cite; (b) `server/lib/dashboard-renderer.ts:686-702` ENOENT narrowing is present — #283 close-and-cite. These manual steps are NOT in the acceptance wrapper (they're historical-state verifications, not diff assertions).

**PR body requirement:** the PR body MUST include `Closes #282`, `Closes #283`, and `Fixes #271`, `#272`, `#273`, `#274`, `#275`, `#276`, `#300`, `#352`, `#353` — so all 11 issues auto-close on merge. This is /ship Stage 3's responsibility but noted here so the executor flags if the /ship run misses any close line.

## Critical files

- `server/lib/dashboard-renderer.ts` — 6 of the 9 fixes land here. Touched sites: `:273` (renderBoard guard — #276), `:426` (toolRunning derivation → isToolRunning call — #353), `:461-474` (updateBanner intercept widening — #352), `:502-508` (readActivity empty-string guard — #276), `:530` (dynamic import elimination — #274), `:605-616` (writeDashboardHtml race fix — #271), `:690` (typeof guard on err cast — #300).
- `server/lib/progress.ts` — 3 fixes: `:95-99, 109-113` (complete/fail stageName-derived label), `:81-83` (activityStartedAt reset), `:152` (fire-and-forget caller coordination with renderer queue if AC-1 goes queue-route).
- `server/lib/dashboard-renderer.test.ts` — new tests for #271, #273, #276, and any other behaviors the executor wants to anchor. Existing AC-18 test at `:513-514` must be replaced.
- `server/lib/progress.test.ts` — new tests for #272 and #275 if the executor anchors them here.
- `scripts/v034-0-acceptance.sh` — new acceptance wrapper. Must be executable, `set -euo pipefail`, `export MSYS_NO_PATHCONV=1` for Windows MSYS safety. Print `ALL V0.34.0 ACCEPTANCE CHECKS PASSED` on success.
- `.ai-workspace/plans/2026-04-20-v0-34-0-dashboard-runtime-bugs.md` — this file (allowlisted in AC-11).

## Checkpoint

- [x] All 10 issue bodies read and verified against master (`1262d0f`)
- [x] Plan drafted with 13 binary AC
- [ ] `/coherent-plan` review
- [ ] `/delegate --via subagent` to executor
- [ ] Executor returns "branch ready + wrapper green"
- [ ] `/ship` — PR + stateless review + merge + tag v0.34.0 + release

Last updated: 2026-04-20T12:20:00+00:00 — post-/coherent-plan + direct-verification pass. 2 issues (#282, #283) confirmed already-fixed on master via direct Read (Explore subagent's verification was incorrect for #282; caught during /delegate baseline check). Dropped AC-5 (was DashboardIo seam — already landed), tightened AC-7→AC-6 intercept regex, renumbered AC-8..AC-14 → AC-7..AC-13. Bundle now: 9 active fixes + 2 close-and-cite.
