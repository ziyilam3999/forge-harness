# v0.34.1 — dashboard tests + polish (4 fixes + 3 close-and-cite)

## Context

Second bundle of the v0.34.x polish sweep. Seven dashboard test/doc issues filed from earlier /ship reviews. Direct-verification against current master (post-v0.33.2, SHA `1b09203`) showed **3 of 7 are already fixed** — the PR #290/#299 follow-ups landed but the issues weren't closed:

| # | Claim | Master state | Bucket |
|---|-------|--------------|--------|
| #293 | `PROJECT_ROOT` fixture misleadingly named `/tmp/forge-auto-open-...` | `FIXTURE_PROJECT_ROOT` at L684, comment at L682 "Renamed from the previous `/tmp/forge-auto-open-nonexistent-xyz`" | **close-and-cite** |
| #294 | Two describes duplicate beforeEach/afterEach plumbing | `useAutoOpenEnvGate()` helper at L690 factors it; called at L703 + L748 | **close-and-cite** |
| #295 | env-gate test buried in stat-narrowing describe | Comment at L787 "lives in its own describe per #295"; already moved | **close-and-cite** |
| #301 | `useAutoOpenEnvGate` JSDoc missing "registers hooks on enclosing describe" | Only has a non-JSDoc comment | **real fix** |
| #302 | `const eperm` only referenced once — inline it | Still present at test L752, referenced only at L754 | **real fix** (trivial) |
| #303 | `maybeAutoOpenBrowser` docstring doesn't note env var re-read per invocation | Docstring at L709-717; no mention of per-invocation toggle | **real fix** (trivial) |
| #355 | Idle-banner tests assert substring-in-HTML, not runtime-branch selection | `updateBanner` IIFE at L472; extract `chooseBannerCopy` helper following `classifyStaleness` pattern at L72 | **real fix** (small refactor) |

**Why now**: bundle follows v0.33.2 dashboard runtime fixes. Strictly test/doc scope — no behavior changes beyond #355's refactor (which is a pure extract-helper move matching `classifyStaleness`'s existing `.toString()` serialization pattern).

## Goal

Outcomes that must hold when done:

1. **`useAutoOpenEnvGate` has a JSDoc docstring** explaining it registers `beforeEach`/`afterEach` against the enclosing describe at call-time (side-effect-ish, must be called from inside a describe).
2. **The `eperm` constant is inlined** at its single use-site — no stray named constant that reads like it's shared.
3. **`maybeAutoOpenBrowser` docstring notes the per-invocation env-var check** — explicitly states that toggling `FORGE_DASHBOARD_AUTO_OPEN` mid-process will take effect on the next invocation.
4. **`chooseBannerCopy` helper exists as a pure top-level function** (mirroring `classifyStaleness`) and is serialized into the `updateBanner` IIFE via `.toString()`. Unit tests exercise the helper directly (runtime-branch coverage for the idle banner).
5. **#293, #294, #295 closed via PR body** with `Closes #<n>` citations of the existing master state.

## Binary AC

1. **AC-1 — `useAutoOpenEnvGate` has a JSDoc docstring that documents the hook registration.** Extract the 30 lines preceding the function declaration; assert the block contains JSDoc syntax (`/**` or `*/`) AND mentions register/install/hook semantics:
   ```bash
   grep -B 30 '^function useAutoOpenEnvGate' server/lib/dashboard-renderer.test.ts | tail -30 > tmp/v034-1-envgate-jsdoc.txt
   # Must contain a JSDoc close marker to prove a JSDoc block exists just before the function:
   grep -qE '^\s*\*/' tmp/v034-1-envgate-jsdoc.txt
   # And the JSDoc body mentions register/install/hook semantics (case-insensitive):
   grep -qiE '(register|install|hook)' tmp/v034-1-envgate-jsdoc.txt
   ```
   (Narrow enough to catch fix-not-applied, broad enough to let the executor write natural prose — uppercase or lowercase.)

2. **AC-2 — `const eperm = Object.assign(...)` is not present.** The constant is either inlined at its use-site or removed:
   ```bash
   ! grep -qE 'const\s+eperm\s*=' server/lib/dashboard-renderer.test.ts
   ```

3. **AC-3 — `maybeAutoOpenBrowser` docstring notes per-invocation env check.** Extract the 30 lines preceding the function signature; assert a phrase about per-invocation / per-call / per-render / re-read / toggle-mid-process:
   ```bash
   grep -B 30 '^export async function maybeAutoOpenBrowser' server/lib/dashboard-renderer.ts | tail -30 > tmp/v034-1-maob-jsdoc.txt
   grep -qiE '(per[- ]invocation|per[- ]call|per[- ]render|re[- ]read|each call|each invocation|toggled? mid)' tmp/v034-1-maob-jsdoc.txt
   ```

4. **AC-4 — `chooseBannerCopy` helper exists at top level and is serialized into the IIFE.** Structurally:
   ```bash
   # Top-level function declaration (export or non-export acceptable, but not inside another function):
   grep -qE '^(export )?function chooseBannerCopy\(' server/lib/dashboard-renderer.ts
   # Serialized into the dashboard HTML via .toString() (matching classifyStaleness pattern):
   grep -qE 'chooseBannerCopy\.toString\(\)' server/lib/dashboard-renderer.ts
   # Called from within the updateBanner IIFE body (exact substring — no need for awk extraction):
   grep -qE 'chooseBannerCopy\(' server/lib/dashboard-renderer.ts
   ```

5. **AC-5 — Unit test exercises `chooseBannerCopy`.** The test file must contain at least one invocation of the helper (not just a reference — an actual call site with parens):
   ```bash
   grep -qE 'chooseBannerCopy\(' server/lib/dashboard-renderer.test.ts
   ```
   (A call-with-parens implies the helper is being invoked inside a test body. An identifier reference in a comment / import would not match `\(`.)

6. **AC-6 — Test count delta ≥ 1.** At least one new test across dashboard-renderer.test.ts + progress.test.ts (covers the new chooseBannerCopy tests; executor may also add one for #303 if they want):
   ```bash
   BEFORE_DASH=$(MSYS_NO_PATHCONV=1 git show origin/master:server/lib/dashboard-renderer.test.ts 2>/dev/null | grep -cE "^\s*(it|test)\s*\(")
   AFTER_DASH=$(grep -cE "^\s*(it|test)\s*\(" server/lib/dashboard-renderer.test.ts)
   DELTA=$((AFTER_DASH - BEFORE_DASH))
   [ "$DELTA" -ge 1 ]
   ```

7. **AC-7 — Full test suite still green.** Suite ≥ 785 baseline (post-v0.33.2):
   ```bash
   mkdir -p tmp && MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/v034-1-full.json > /dev/null 2>&1 || true
   node -e "const r=require('./tmp/v034-1-full.json'); if (r.numFailedTests === 0 && r.numPassedTests >= 785) process.exit(0); console.error('tests: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed'); process.exit(1);"
   ```

8. **AC-8 — Lint green.**
   ```bash
   npm run lint > /dev/null 2>&1
   ```

9. **AC-9 — Changes confined to allowlist.**
   ```bash
   git diff --name-only master...HEAD | grep -vE '^(server/lib/dashboard-renderer\.ts|server/lib/dashboard-renderer\.test\.ts|\.ai-workspace/plans/2026-04-20-v0-34-1-dashboard-tests-polish\.md|scripts/v034-1-acceptance\.sh)$' | wc -l | awk '$1 == 0 { exit 0 } { exit 1 }'
   ```

10. **AC-10 — Acceptance wrapper exists and passes.**
    ```bash
    test -x scripts/v034-1-acceptance.sh && bash scripts/v034-1-acceptance.sh | tail -1 | grep -q 'ALL V0.34.1 ACCEPTANCE CHECKS PASSED'
    ```

## Out of scope

1. **#293, #294, #295** — already fixed on master. PR body uses `Closes #293`, `Closes #294`, `Closes #295`. Do NOT re-apply any code for these.
2. **`classifyStaleness` refactor** — existing pattern. Do NOT alter it; only mirror it for `chooseBannerCopy`.
3. **Idle-banner HTML test preservation** — the existing `"Idle — no tool running"` substring-in-HTML tests (from v0.33.0 PR C) STAY. AC-5's new tests are in addition; do not delete the existing ones.
4. **`progress.ts` / `progress.test.ts`** — this bundle is strictly dashboard-renderer scope. v0.34.1 allowlist does not include progress.
5. **Package version bump + CHANGELOG** — `/ship` Stage 7 handles.
6. **Other v0.34.x bundles.**

## Verification procedure

Reviewer runs `bash scripts/v034-1-acceptance.sh` from repo root. Exits 0 iff all 10 AC pass. Print-on-pass: `ALL V0.34.1 ACCEPTANCE CHECKS PASSED`.

Reviewer manually verifies the 3 already-fixed claims by reading master state:
- (a) `FIXTURE_PROJECT_ROOT` at `dashboard-renderer.test.ts:684` — #293 done
- (b) `useAutoOpenEnvGate()` helper at `:690` called from `:703` + `:748` — #294 done
- (c) Env-gate test in its own describe per comment at `:787` — #295 done

**PR body requirement:** include `Closes #293`, `Closes #294`, `Closes #295` (already-fixed), plus `Fixes #301`, `Fixes #302`, `Fixes #303`, `Fixes #355` (real fixes).

## Critical files

- `server/lib/dashboard-renderer.ts` — #303 docstring fix at `maybeAutoOpenBrowser` JSDoc (starting ~L709); #355 `chooseBannerCopy` helper added at top level near `classifyStaleness` (L72), serialized into `updateBanner` IIFE (L472).
- `server/lib/dashboard-renderer.test.ts` — #301 JSDoc for `useAutoOpenEnvGate` at L690; #302 inline `eperm` at L752/L754; #355 unit tests for `chooseBannerCopy`.
- `scripts/v034-1-acceptance.sh` — new acceptance wrapper. Must be executable, `set -euo pipefail`, `export MSYS_NO_PATHCONV=1`.
- `.ai-workspace/plans/2026-04-20-v0-34-1-dashboard-tests-polish.md` — this file (allowlisted in AC-9).

## Checkpoint

- [x] All 7 issue bodies re-verified against master (`1b09203` post-v0.33.2)
- [x] 3 already-fixed issues identified (#293, #294, #295) — close-and-cite only
- [x] 4 real fixes sized: 3 trivial doc/cleanup + 1 refactor (#355)
- [x] Plan drafted with 10 binary AC
- [ ] `/coherent-plan` review
- [ ] `/delegate --via subagent` to executor
- [ ] Executor returns "branch ready + wrapper green"
- [ ] `/ship` — PR + stateless review + merge + tag v0.33.3 + release

Last updated: 2026-04-20T12:50:00+00:00 — post-/coherent-plan (4 findings, 4 fixed: AC-1 dead awk removed + case-insensitive JSDoc check + wider `-B 30` grep, AC-3 awk→grep simpler extract, AC-5 OR branch removed — require call-with-parens, Critical files line range smoothed).
