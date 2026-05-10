# Auto-rebuild dist/ after ship-or-merge — forge-harness post-merge git hook

**Date filed:** 2026-05-10
**Author:** forge-plan
**Status:** P4-swept — all 4 plan-chain reviewers complete; pending operator ELI5 approval gate

## ELI5

When we `git pull` after shipping new code to forge-harness, our main checkout gets the new TypeScript source — but the **compiled JavaScript in `dist/` is left behind**. The MCP server runs from `dist/` (its entry point is `dist/index.js` per `package.json` `scripts.start`); source `.ts` files are never executed directly. So the running server keeps loading yesterday's compiled code as if nothing changed. Smoke tests run against the old dist/ and silently lie — they say "all green!" when they really tested code that's a day stale.

The fix: a tiny **post-merge git hook** (with a sibling `post-rewrite` hook for `git pull --rebase` flows) that detects when source is newer than `dist/` and runs `npm run build` automatically. It piggybacks on the existing `scripts/install-hooks.cjs` machinery (same place `commit-msg` and `pre-commit` hooks already live), so any future clone that runs `npm install` once gets it for free.

## Execution model

**Mode: inline-with-per-task-review-loop (single session; per-task stateless reviewer dispatched in background after each implementation task).**

Rationale: this plan touches 3 files (`scripts/install-hooks.cjs` + new hook templates + `README.md`) plus a small unit test (`scripts/test-rebuild-hook.cjs`), crosses an architectural decision (mechanical-hook vs instruction-only fix per Rule 17), and is ~150-250 LOC total. Per CLAUDE.md `/per-task-review-loop` decision-table row "Inline multi-task arc: serial execution in a single session where each task could break (infra mutation, custom code, non-trivial config)," wrapping with `/per-task-review-loop` per-task mode gives independent quality gates per implementation task without subagent-handoff overhead.

Per saved feedback memory `feedback_per_task_review_loop_for_inline_tasks.md` (operator directive 2026-05-10): inline execution MUST be wrapped with /per-task-review-loop — never inline-without-review. The /auto-flow Stage 2 default (subagent dispatch via /delegate) is REPLACED here with inline + /per-task-review-loop per-task dispatch.

**Concrete implementation tasks** (each gets its own per-task reviewer dispatch on completion):

1. Extend `scripts/install-hooks.cjs` with two hook templates + install blocks + marker-aware logic.
2. Define + ship the marker file format (JSON shape + the helper that reads/writes it from the hook scripts).
3. Add Troubleshooting subsection to `README.md`.
4. Write `scripts/test-rebuild-hook.cjs` covering the three required cases (newer source, older source, absent dist/).
5. Run `npm install` to materialize the hooks; verify AC-0 through AC-4 locally before pushing.

## Why

**Caught 2026-05-10.** After today's `/ship` runs merged v0.41.0 (5 PRs) and v0.41.1 (1 PR) to forge-harness master, my primary clone had:

- `server/lib/spec-generator.ts` mtime: **2026-05-10 19:23**
- `server/tools/status.ts` mtime: **2026-05-10 19:23**
- `dist/lib/spec-generator.js` mtime: **2026-05-09 08:26** (~11h stale)
- `dist/tools/status.js` mtime: **2026-05-09 08:26** (~11h stale)

I almost mailed monday2 a 10-smoke ask without realizing both of us would be smoke-testing **yesterday's compiled code**. The trap is silent: nothing prints a warning, nothing fails loudly. You just get false PASS/FAIL signals.

**Why "remember to rebuild" won't work.** Per Rule 17 (Default to hooks for mechanically verifiable rules) and KB pattern F2 (behavioral prose without consequences ≈ 17% compliance) + KB pattern P13 (Tier 1-2 mechanical hooks ≈ 90-100% compliance), instruction-only fixes for mechanically-verifiable rules consistently fail. The signal here is objective (source mtime > dist mtime, OR HEAD changed since last build). That's mechanical territory → hook.

**Why forge-harness is special.** It's an MCP server the planner session itself uses. Stale dist/ creates a **feedback loop**: the agent thinks it's testing new code but tests old code, then ships more code on the false confidence, then mails downstream consumers (monday2) a smoke-test ask that they too will run against stale dist/. The trap compounds across the conversation graph.

## What (intent)

Forge-harness should automatically rebuild `dist/` whenever a git operation (merge, fast-forward inside `git pull`, OR rebase via `git pull --rebase`) brings in source changes that `dist/` doesn't reflect. Neither the operator nor downstream MCP consumers (interactive Claude sessions, monday2 smoke-test handlers) should need to remember `npm run build` manually.

The hook should be:

- **Self-installing** via `scripts/install-hooks.cjs` (so `npm install` is the one-time setup).
- **Fast no-op** when `dist/` is already fresh (don't penalize merges that didn't change source).
- **Loud on failure** so a tsc error after pull surfaces immediately rather than at next runtime.
- **Bypassable** by an operator who explicitly wants stale dist/ for A/B testing.
- **Cross-platform within the POSIX-shell-providing matrix** — macOS BSD, Linux GNU userland, AND Git-for-Windows MSYS bash (which is what GitHub Actions `windows-latest` uses to run `.git/hooks/*`). No `stat -f %m`, no `date +%s%N`. Native Windows CMD/PowerShell is **explicitly out of scope** — git hooks have always required a bash interpreter on Windows, and operators running git via Windows-native tooling without Git-for-Windows are already outside the existing `commit-msg`/`pre-commit` hook support matrix.

## Critical files

**Preconditions (verifiable BEFORE implementation begins):**

- `test -f scripts/install-hooks.cjs` (existing installer present)
- `node -e "console.log(require('./package.json').scripts.postinstall)" | grep -q install-hooks` (postinstall actually invokes installer)
- Current `pull.rebase` config check — `git config --get pull.rebase` returning empty (default merge) means `post-merge` hook covers `git pull`. If user globally configures `pull.rebase=true`, only `post-rewrite` covers it. Both hooks installed, so either case works.

**Files modified:**

- `scripts/install-hooks.cjs` — extend to install **two** new hooks: `post-merge` (covers `git pull` default) and `post-rewrite` (covers `git pull --rebase` and `git commit --amend`). Both call the same freshness-check + rebuild logic and **both write an execution marker** on every invocation (see below).
- `.git/hooks/post-merge` — **new** hook script (installed by above; not committed; gitignored).
- `.git/hooks/post-rewrite` — **new** hook script (installed by above; not committed; gitignored).
- `.git/.forge-rebuild-hook-marker` — **new** marker file written by both hooks. JSON shape: `{ "lastRunAt": <unix-millis>, "lastRebuildAt": <unix-millis | null>, "trigger": "post-merge" | "post-rewrite" }`. `lastRunAt` updates on EVERY hook invocation (proves hook fired even when freshness check no-ops); `lastRebuildAt` updates only when tsc actually ran. Enables AC-5 to verify hook fires on real merges where source under `server/` may not have changed (this plan's own merge being a key example).
- `README.md` — Troubleshooting section: add "I pulled but my changes don't seem live" subsection. Document the hooks, the manual fallback (`npm run build`), and the bypass (`git -c hooks.post-merge=false pull` or `git -c core.hooksPath=/dev/null pull`).
- `scripts/test-rebuild-hook.cjs` (or similar) — small Node-based test that materializes a temp git repo + dist/ + source fixture, runs the hook, asserts mtime advanced. Cross-platform; no shell-dependent stat formats.

## Binary AC

All AC verifiers are written cross-platform (no `stat -f` macOS-isms; no `date +%s%N` GNU-isms). Use `node -e` for time/mtime where the platform difference matters.

### AC-0 — preconditions hold

**Verifier:**

```bash
test -f scripts/install-hooks.cjs && \
  node -e "process.exit(require('./package.json').scripts.postinstall.includes('install-hooks') ? 0 : 1)"
```

**Pass:** exit 0. **Fail:** installer missing or postinstall chain doesn't invoke it.

### AC-1 — both hooks are installed by `npm install`

**Verifier (run in a fresh clone or after `npm install`):**

```bash
npm install --ignore-scripts=false 2>&1 >/dev/null
test -x .git/hooks/post-merge && \
  test -x .git/hooks/post-rewrite && \
  head -3 .git/hooks/post-merge | grep -qE '(auto-rebuild|forge-harness)' && \
  head -3 .git/hooks/post-rewrite | grep -qE '(auto-rebuild|forge-harness)'
```

**Pass:** exit 0. **Fail:** any non-zero exit means a hook is missing or marker comment absent.

### AC-2 — hooks rebuild when source is newer than dist/

**Verifier (touches BOTH the source AND the compiled file so tsc actually has work to do; invokes the hook DIRECTLY rather than via `git pull` because git short-circuits `post-merge` when there are no upstream changes to fetch):**

```bash
# Make source artificially newer than dist/
node -e "fs=require('fs'); fs.utimesSync('server/lib/spec-generator.ts', Date.now()/1000, Date.now()/1000)"
node -e "fs=require('fs'); old=Date.now()/1000-86400; fs.utimesSync('dist/lib/spec-generator.js', old, old)"

PRE_MTIME=$(node -e "console.log(require('fs').statSync('dist/lib/spec-generator.js').mtimeMs)")

# Invoke hook directly — proves rebuild logic, decoupled from git's pull short-circuit behavior
.git/hooks/post-merge 2>&1

POST_MTIME=$(node -e "console.log(require('fs').statSync('dist/lib/spec-generator.js').mtimeMs)")
node -e "process.exit(${POST_MTIME} > ${PRE_MTIME} ? 0 : 1)"
```

**Pass:** exit 0 (mtime advanced — rebuild happened). **Fail:** mtime unchanged means hook didn't detect staleness or didn't run tsc.

### AC-3 — hook is fast no-op when dist/ is already fresh

**Why 500ms ceiling is the right number (measured 2026-05-10 on M-class macOS):**

- Pure freshness check (`find server -name '*.ts' -newer dist/index.js`): **51-53ms** across 3 runs on this codebase
- tsc no-op (`npx tsc --noEmit`, all incremental caches valid): **1525-1671ms** across 2 runs
- 500ms threshold is ~10× the freshness-check baseline (generous noise margin) but well below the lowest tsc invocation (1525ms) — so the AC distinguishes "hook took the fast path" from "hook ran tsc."

**Verifier (times the hook itself, NOT the network round-trip of `git pull`):**

```bash
npm run build                                                 # everything fresh
sleep 1
START=$(node -e "console.log(Date.now())")
.git/hooks/post-merge 2>&1 >/dev/null
END=$(node -e "console.log(Date.now())")
ELAPSED_MS=$((END - START))
node -e "process.exit(${ELAPSED_MS} < 500 ? 0 : 1)"            # <500ms wall-clock
```

**Pass:** exit 0 (hook freshness check completed without invoking tsc). **Fail:** wall-clock ≥500ms strongly implies tsc ran when it shouldn't have.

### AC-4 — README documents the hooks + manual fallback + bypass

**Verifier (combines bypass-config tokens into one tight regex to avoid false-positive on standalone `false`):**

```bash
grep -qE 'post-merge' README.md && \
  grep -qE 'post-rewrite' README.md && \
  grep -qE 'npm run build' README.md && \
  grep -qE 'hooks\.post-merge[[:space:]]*=[[:space:]]*false' README.md
```

**Pass:** exit 0 (all four markers present, bypass-config token is the combined `hooks.post-merge=false` regex with optional whitespace around `=`). **Fail:** any missing marker means documentation is incomplete.

### AC-5 — hook fires on a real /ship merge of THIS plan's PR

**Why this AC uses an execution marker, not dist/ mtime:** this plan's source diff is `scripts/install-hooks.cjs` + `README.md` + new `.git/hooks/*` templates + `scripts/test-rebuild-hook.cjs`. **None of those live under `server/`** (tsc's `rootDir`), so a real merge of this plan would NOT cause tsc to produce different `dist/` output — checking `dist/` mtimes would falsely fail. Instead, AC-5 verifies the hook FIRED via the `lastRunAt` marker (which updates on every invocation, regardless of whether tsc rebuild was needed).

**Verifier (run after the PR for this plan merges to master). PRE_RUN and POST_RUN BOTH defensively try/catch — partial JSON / missing file / shape drift fails the AC cleanly with exit 2 instead of throwing an opaque SyntaxError (F47 mitigation):**

```bash
cd ~/coding_projects/forge-harness
PRE_RUN=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('.git/.forge-rebuild-hook-marker','utf8'));console.log(typeof j.lastRunAt==='number'?j.lastRunAt:0)}catch{console.log(0)}")
git pull --no-rebase
POST_RUN=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('.git/.forge-rebuild-hook-marker','utf8'));console.log(typeof j.lastRunAt==='number'?j.lastRunAt:'NaN')}catch{console.log('NaN')}")
node -e "if('${POST_RUN}'==='NaN'){console.error('marker missing or shape-broken');process.exit(2)};process.exit(${POST_RUN} > ${PRE_RUN} ? 0 : 1)"
```

**Pass:** marker `lastRunAt` advanced after the merge (proves hook fired). **Fail:** marker unchanged or missing means hook didn't fire on a real merge.

### AC-6 — unit test covers the freshness-check logic

**Verifier:**

```bash
test -f scripts/test-rebuild-hook.cjs && node scripts/test-rebuild-hook.cjs
```

**Pass:** test exits 0. **Fail:** test missing or fails. Test must cover at least: (a) source-newer-than-dist triggers rebuild, (b) source-older-than-dist no-ops, (c) absent dist/ triggers rebuild.

## Out of scope

- **Modifying the `/ship` skill** (lives in ai-brain repo). Stage 11 addition would be belt-and-suspenders but is cross-repo and a separate plan.
- **Auto-restarting the running MCP child** after rebuild. That's the F54 trap (runtime variant) — modules are loaded once at MCP server startup; rebuild on disk doesn't propagate to a running child. Operators must restart their Claude Code session manually. README will note this.
- **Hooks for monday-bot or other TypeScript MCPs** in the workspace — defer to a follow-up plan once this pattern proves out.
- **Pre-test guard** that refuses smoke-tests with stale dist/ — unnecessary if post-merge/post-rewrite hooks fire reliably; would be belt-and-suspenders.
- **Replacing tsc with esbuild / SWC** for faster rebuilds — premature optimization; tsc on this codebase is sub-3-second.
- **Restoring `dist/` if `mv`'d to quarantine accidentally** — out of scope; that's a different incident class.
- **Concurrency-safe build serialization** — if operator runs `npm run build` manually while the hook also fires, two `tsc` invocations may race. tsc tolerates this in practice (last-writer-wins on `dist/`); not worth a flock for the projected race window.

## Risks

- **R1 (low):** Post-merge hook fires on EVERY merge, including merges that didn't change source. **Mitigation:** AC-3 (fast no-op when fresh) — freshness check is a stat() comparison; measured baseline 51-53ms (see AC-3 measurement block).
- **R2 (medium):** Hook writes to `dist/` after merge, which could surprise an operator who explicitly wanted stale dist/ for A/B comparison. **Mitigation:** documented bypass via `git -c hooks.post-merge=false pull` (and similarly for post-rewrite).
- **R3 (low):** `scripts/install-hooks.cjs` already overwrites existing hook files unconditionally — verified: `scripts/install-hooks.cjs:66-70` does `fs.writeFileSync` with no marker check, no absent-check (P3 measurement, 2026-05-10). The new hooks inherit that "stomp on every npm install" pattern. **Mitigation:** documented as a known property; operators with custom `post-merge` / `post-rewrite` hooks must `mv` them aside before `npm install`. Not net-new behavior — same trade-off existing `commit-msg` / `pre-commit` already make. Adding marker-check would be inconsistent with the existing installer; out of scope to also retrofit it for the existing two hooks.
- **R4 (low):** TypeScript build error after merge → dist/ in mixed state. **Mitigation:** tsc runs as a single command; on failure, hook prints the error and exits non-zero. Operator sees the failure on pull, not at next runtime.
- **R5 (low):** Hook fires on `git checkout` of a different branch — could rebuild dist/ for a feature branch the operator wasn't intending to test. **Note:** post-merge fires on `git pull` (which is fetch+merge), NOT on `git checkout`. We deliberately do NOT install `post-checkout` (which would fire on every branch switch).
- **R6 (medium):** `post-merge` does NOT fire on `git pull --rebase` (rebase replays commits, doesn't merge). **Mitigation:** install a sibling `post-rewrite` hook with identical freshness-check logic. `post-rewrite` fires after both `git rebase` and `git commit --amend` — the amend case is a harmless no-op (no source mtime change vs dist/, freshness check exits fast).
- **R7 (low):** Concurrent `npm run build` (operator) + hook-triggered build → two `tsc` processes write to `dist/`. **Mitigation:** documented as out-of-scope; tsc tolerates the race in practice (worst case is the second writer's output wins, which is correct).

## Anti-cascade

This plan is **purely additive**:

- `scripts/install-hooks.cjs` gains two new hook-template constants + two new install blocks.
- New `.git/hooks/post-merge` and `.git/hooks/post-rewrite` files materialized at install time.
- `README.md` gains one new H3 subsection under existing Troubleshooting H2.
- New `scripts/test-rebuild-hook.cjs` test file.
- No runtime code changes (no edits to `server/**`).
- No `package.json` script changes.
- No version bump strictly required (operator's call — could ship as v0.42.0 for visibility).

## Cairn references

- **F54** Stale MCP Server (runtime variant — this plan is the **build-time** variant of the same family)
- **F65** Planning Without Measuring (the trap I fell into pre-incident — almost mailed monday2 without measuring my own dist/ mtimes)
- **F2** Behavioral prose without consequences ≈ 17% compliance — why instruction-only "remember to rebuild" was always going to fail
- **P6** Mechanical detection over judgment — this plan's design principle
- **P13** Tier 1-2 mechanical hooks ≈ 90-100% compliance — the empirical case for hook over instruction
- **P64** Producer/Consumer Seam Assertion — source/dist is the canonical producer/consumer pair; mtime comparison is the seam assertion
- **Rule 17** (parent-claude.md): Default to hooks for mechanically verifiable rules — this plan is a textbook application

## Plan-chain review history

- **P1 (stateless, 2026-05-10):** AMEND. Surfaced verifier portability bugs (`stat -f %m`, `date +%s%N`), AC-2 measuring wrong file (need to stale BOTH source AND dist/), AC-3 1500ms threshold including network round-trip, missing `git pull --rebase` coverage (post-rewrite hook). All applied.
- **P2 (comparative, 2026-05-10):** SHIP with 3 net-new tightenings: (a) AC-4 `grep 'false'` was over-broad → tightened to combined `hooks\.post-merge[[:space:]]*=[[:space:]]*false` regex; (b) AC-5 dist/ mtime check would falsely fail because this plan's diff has no `server/` changes → introduced execution marker `.git/.forge-rebuild-hook-marker` written on every hook invocation, AC-5 verifies `lastRunAt` advanced; (c) AC-2 `git pull --no-rebase` short-circuits on no-upstream-changes → switched to direct hook invocation `.git/hooks/post-merge`. P2 also locked in 5 protect-from-rewrite items (cross-platform doctrine, AC-3 direct invocation, AC-6 three-case test, R6+post-rewrite, all `node -e` portability calls).
- **P3 (cairn-grounded, 2026-05-10):** AMEND with 4 mechanical gaps (all cited F-IDs accurately). All 6 cited F/P-IDs verified accurate against KB. Fixes applied: (1) **F65 — R3 misstated existing pattern**: install-hooks.cjs:66-70 unconditionally writes (no marker check); R3 rewritten to document hook-stomping is the existing pattern, not a new property. (2) **F46 — AC-3 500ms unmeasured**: measured baseline added (freshness check 51-53ms; tsc no-op 1525-1671ms); 500ms is ~10× freshness baseline and well below tsc invocation. (3) **F47 — AC-5 POST_RUN parse undefended**: symmetric try/catch + shape-guard added; missing/broken marker exits 2, not opaque SyntaxError. (4) **F65 — Windows scope unstated**: cross-platform claim re-scoped to POSIX-shell-providing matrix (macOS BSD, Linux GNU, Git-for-Windows MSYS bash); native CMD/PowerShell explicitly out-of-scope (consistent with existing hook support matrix).
- **P4 (mechanical sweep, 2026-05-10):** AMEND with 3 cosmetic mechanical gaps. Applied: (1) deleted duplicate "P3 pending" + extra "P4 pending" scaffolding (this section); (2) updated Status header to reflect P3 completion; (3) fixed R1 "<50ms" contradicting AC-3's measured 51-53ms baseline. Sweep otherwise CLEAN — all F/P-ID cross-refs intact, all verifiers cross-platform per doctrine, all Plan-First metadata sections present.

## Per-task review schedule

Per the updated execution model above, every implementation task (1-5) gets a `/per-task-review-loop` per-task dispatch on completion — stateless reviewer in background subagent, sequential per-task per `feedback_auto_flow_planning_always_sequential.md`. Cost per task ~3-5K tokens; whole-plan ceiling ~25K tokens (5 tasks × ~5K). On reviewer FAIL: pause, fix, re-dispatch. On IMPROVE: apply if cheap (≤2 min). On PASS: log + continue. Phase boundary (before /ship dispatch) blocks on all in-flight per-task reviewers PASS-ing.

After all 5 tasks PASS: skip /auto-flow Stage 2 dispatch (no /delegate handoff in inline mode); proceed directly to /auto-flow Stage 3 I1+I2 post-code reviewers + /ship.

## Post-arc actions

- **Verify against monday2's smoke window** — once the hook ships, mail monday2 confirming her next pull will auto-rebuild (closes the gap from T2110).
- **File ai-brain follow-up** — separate plan for `/ship` Stage 11 (post-merge primary-clone refresh prompt). Belt-and-suspenders for the case where a clone hasn't run `npm install` yet.
- **Cairn stone on completion**: "Post-merge auto-rebuild hook lands — F54-build-variant trap closed at the source for forge-harness."
- **Working-memory card on completion**: ship-completeness card with AC outcomes (link from this plan's incident card `2026-05-10-stale-dist-after-ship-merge-incident`).
- **Lift-and-shift candidate**: monday-bot (TypeScript MCP, same shape). Defer to a follow-up plan if monday2 confirms the pattern is valuable.
