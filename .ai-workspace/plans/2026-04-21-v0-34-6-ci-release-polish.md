---
slice: v0.34.6
release: v0.33.8
scope: seventh and final v0.34.x polish slice; bundled patch release
baselineSha: c9dc46597ffec124e586cd238f03e24778ebb206
issuesFixed: "#297, #298, #364, #398"
issuesClosedAsShipped: "#287, #288, #289"
---

# v0.34.6 — CI + release polish

## ELI5

Imagine seven sticky notes on the backlog wall about CI robot chores. When I went to pick them up, three had already fallen off — the work they described is already done inside `.github/workflows/s8-kanban-dashboard-acceptance.yml` (the workflow got renamed to nice casing, a rationale comment got added, and a "cancel old runs" block showed up). For those three I just write "done" on the back and put them in the closed pile. The other four need small, surgical edits:

- Two tiny YAML tweaks in the same workflow file — one swaps a hardcoded group name for the idiomatic `${{ github.workflow }}` form; the other drops `{}` from a line so it becomes just `workflow_dispatch:`.
- One bash wrapper (`pr-e-acceptance.sh`) where if the test runner crashes before writing its JSON report, the script currently shows a confusing "module not found" error. Fix: check the file exists before reading it, and stop swallowing the crash with `|| true`.
- Five sibling wrappers (`v034-1` through `v034-5`) need an inline comment above their full-suite test check explaining why the baseline has a 2-test buffer — that buffer is intentional but currently invisible. Comment, not logic change.

At the end: release tagged `v0.33.8`, seven issues closed, sweep done.

## Context

Final slice of the v0.34.x polish sweep. Six prior slices (v0.33.2..v0.33.7) shipped iter-1 PASS on the stateless reviewer; streak holds. Remaining candidate backlog is CI-workflow hygiene + wrapper-family maintenance — no user-facing behavior change, no semver-minor surface touched.

**Key load-bearing facts:**
- Master HEAD is `c9dc46597ffec124e586cd238f03e24778ebb206` (release 0.33.7).
- #287/#288/#289 are already satisfied in live master — the workflow file at `.github/workflows/s8-kanban-dashboard-acceptance.yml` already has title-case `name:`, `--ignore-scripts` rationale comment, and a concurrency block. These get closed-as-shipped with a rationale pointer, not re-shipped.
- #297 targets `s8-kanban-dashboard-acceptance.yml:18` (concurrency group syntax). #298 targets `:13` (bare `workflow_dispatch:`). Both cosmetic; semantically identical to current state.
- #364 targets `scripts/pr-e-acceptance.sh:62-69` AC-E7 block. `|| true` after vitest invocation masks crashes and produces a confusing secondary error when the JSON file is missing.
- #398 targets five sibling wrappers (`v034-1` through `v034-5`). The `>= <baseline - 2>` threshold is intentional buffer-for-parallel-churn but undocumented in the wrapper itself. Lowest-friction option from the issue body: add an explicit comment documenting the buffer policy. No logic change.
- **Rule from v0.33.7 WM card**: historical release-pinned acceptance wrappers verify structurally, not by re-execution. All AC here use `grep`/`yq`/`bash -n`, never `bash scripts/<wrapper>.sh`.
- **Rule from v0.33.7 WM card**: AC greps with alternation use `grep -E`, never basic-regex `\|`.

**Deferred to post-sweep cleanup (not in this slice):** task #113 (anthropic.ts OAuth comment), #391/#392/#393/#394 (anthropic-test refactors), #396 (evaluate audit regex widening), #397 (D7 gap comment).

## Goal

Invariants that must hold when done:
1. `s8-kanban-dashboard-acceptance.yml` uses idiomatic concurrency-group form and has no empty workflow_dispatch mapping.
2. `pr-e-acceptance.sh` AC-E7 surfaces real vitest exit codes and produces a clear error when the JSON report file is missing (no "Cannot find module" confusion).
3. Each of `v034-1` through `v034-5` acceptance wrappers carries an inline comment documenting the test-count buffer policy.
4. Package released as `v0.33.8` via /ship pipeline; all 7 issues (`#287`, `#288`, `#289`, `#297`, `#298`, `#364`, `#398`) closed.
5. No behavioral regression: full vitest suite count unchanged from master baseline within the existing buffer window.

## Binary AC

All checkable from static file content or a single command exit code. No AC requires reading the diff. 12 ACs total (no AC-5 in prior drafts — dropped as redundant with AC-1..AC-4 file-structural checks; a yaml-parser AC would require adding yq/python3 to the tool manifest for no signal gain).

1. `grep -c '^  workflow_dispatch:$' .github/workflows/s8-kanban-dashboard-acceptance.yml` returns `1`.
2. `grep -cE 'workflow_dispatch:\s*\{\}' .github/workflows/s8-kanban-dashboard-acceptance.yml` returns `0`.
3. `grep -cE '^\s+group:\s+\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}' .github/workflows/s8-kanban-dashboard-acceptance.yml` returns `1`.
4. `grep -cE '^\s+group:\s+s8-dashboard-\$\{\{\s*github\.ref\s*\}\}' .github/workflows/s8-kanban-dashboard-acceptance.yml` returns `0`.
5. Vitest-specific `|| true` is removed: `grep -cE 'vitest.*pr-e-vitest\.json.*\|\| true' scripts/pr-e-acceptance.sh` returns `0`. **Scoped to the vitest invocation line only — the legitimate `|| true` on AC-E8's `git diff ... | grep -vE ...` line (grep exit-1-when-no-match handling) MUST remain untouched.**
6. Explicit JSON-file existence check added before node parse: `grep -cE 'test -f tmp/pr-e-vitest\.json|\[\s+-f\s+tmp/pr-e-vitest\.json|existsSync.*pr-e-vitest' scripts/pr-e-acceptance.sh` returns at least `1`.
7. For each wrapper in `scripts/v034-{1,2,3,4,5}-acceptance.sh`: `grep -cE 'buffer|slack|headroom|churn' "$f"` returns at least `1` (explicit buffer-policy comment present). Executor may pick wording.
8. `scripts/v034-0-acceptance.sh` is NOT modified — `git diff master...HEAD -- scripts/v034-0-acceptance.sh` returns empty output. (#398 body does not list v034-0.)
9. Full vitest count invariant: `npx vitest run --reporter=json --outputFile=tmp/v0346-full.json` produces `numFailedTests === 0` and `numPassedTests >= 798` (v0.33.7 shipped 800; this allows the existing 2-test buffer window).
10. Package release: `node -e "console.log(require('./package.json').version)"` prints `0.33.8` after /ship completes (verified post-ship, not pre-ship).
11. CHANGELOG.md has a `## [0.33.8]` header referencing at least `#297`, `#298`, `#364`, `#398` (verified post-ship).
12. Issues closed: after PR merge AND after planner runs `gh issue close` on #287/#288/#289, `for n in 287 288 289 297 298 364 398; do gh issue view "$n" --json state -q .state; done` prints `CLOSED` seven times. (#287/#288/#289 closed via rationale comment pointing at current master file:line — that's the planner's post-merge action, NOT an executor-satisfiable AC; the other four auto-close via `Fixes #N` in PR body.)

**Stricter-than-issue-#364 stance (justified):** Issue #364 allows *either* an existence check *or* removing `|| true`. This plan requires *both* (AC-5 AND AC-6). Justification: either fix alone leaves a failure mode — existence-check alone still swallows real vitest exit codes via `|| true`; `|| true` removal alone leaves stale-JSON as a silent-pass risk on incremental runs. Together they fully close the issue's stated concern.

## Out of scope

1. **`scripts/v034-0-acceptance.sh`** — not listed in #398 body; leave untouched. Buffer rationale can be folded into a future wrapper-family audit if needed.
2. **`scripts/pr-d-acceptance.sh`** — has similar `|| true` pattern but #364 is pr-e-specific. Do not generalize.
3. **Other workflow files** (`ci.yml`, `smoke-gate.yml`, `q0-l4-*.yml`) — no issue in the bundle targets them. Concurrency-group idiomatic form may be added to them in a future sweep if/when an issue is filed.
4. **Historical release-pinned wrappers** (`pr-a-acceptance.sh`, `pr-b-acceptance.sh`, etc.) — immutable-by-release per v0.33.7 WM card rule; never touch.
5. **anthropic.ts OAuth comment** (task #113) — deferred.
6. **anthropic-test refactors** (#391, #392, #393, #394) — deferred.
7. **Evaluate audit regex widening** (#396) — deferred; would re-open v0.33.7 surface.
8. **D7 gap self-documenting comment** (#397) — deferred.
9. **Version bump override is the PLANNER's call (not the executor's).** If `/ship` Stage 7's conventional-commit algorithm computes a non-patch bump (e.g. `feat:` prefix triggering minor), the planner overrides to patch per v0.33.7 WM card pattern during Stage 7. Executor uses their preferred commit prefix; no need to anticipate the override.

## Ordering constraints

**Code ordering: none** — all four code changes are independent and can ship in any commit order within the single PR.

**Close-as-shipped timing:** #287/#288/#289 are closed by the **planner** (not the executor) via `gh issue close <n> --comment "<rationale pointing at master file:line>"`. This happens **post-PR-merge** so the rationale comment can cite the merged master state. The PR body should include `Refs #287 #288 #289 — already satisfied at master .github/workflows/s8-kanban-dashboard-acceptance.yml` (but NOT `Fixes`, which would auto-close on PR merge without a rationale comment).

## Verification procedure

Reviewer runs these in order against the executor's branch head:

1. `git fetch origin master && git diff --stat origin/master...HEAD` — confirm only `.github/workflows/s8-kanban-dashboard-acceptance.yml`, `scripts/pr-e-acceptance.sh`, `scripts/v034-{1,2,3,4,5}-acceptance.sh`, `scripts/v034-6-acceptance.sh` (NEW, executor-authored per /delegate brief), `CHANGELOG.md`, `package.json`, and the plan file are modified. Flag any other file.
2. AC-1..AC-4 against the YAML file — all pass.
3. AC-5..AC-6 against `pr-e-acceptance.sh` — all pass.
4. AC-7 against each of five wrappers (`v034-1` through `v034-5`) — all pass.
5. AC-8 against `v034-0-acceptance.sh` — empty diff.
6. AC-9: `rm -rf tmp/ && MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/v0346-full.json > /dev/null 2>&1; node -e "const r=require('./tmp/v0346-full.json'); console.log(r.numPassedTests, r.numFailedTests); process.exit(r.numFailedTests === 0 && r.numPassedTests >= 798 ? 0 : 1)"` exits 0.
7. AC-10/AC-11 post-ship only — verified by /ship Stage 7 + CHANGELOG self-read.
8. AC-12 **post-merge-and-post-planner-close** (two-step gate): first the PR merges, then the planner runs three `gh issue close 287/288/289` commands with rationale comments, THEN the reviewer runs `for n in 287 288 289 297 298 364 398; do gh issue view "$n" --json state -q .state; done` which should print `CLOSED` seven times. If the reviewer runs step 8 before the planner's close commands, #287/#288/#289 will still show OPEN — that's expected-before-close, not a failure.

## Critical files

- `.github/workflows/s8-kanban-dashboard-acceptance.yml` — the single YAML file carrying AC-1..AC-4.
- `scripts/pr-e-acceptance.sh` — AC-E7 block (lines 62-69 at baseline) carrying AC-5, AC-6.
- `scripts/v034-1-acceptance.sh` through `scripts/v034-5-acceptance.sh` — five sibling wrappers carrying AC-7. Each has a full-suite test-count check that needs an explanatory comment nearby.
- `scripts/v034-0-acceptance.sh` — explicitly out-of-scope file for AC-8.
- `scripts/v034-6-acceptance.sh` (NEW, executor-authored) — per the `/delegate` brief's acceptance-wrapper requirement, the executor creates this file to run AC-1..AC-9 internally and exit 0 iff all pass. Binary AC above remain the canonical contract; the wrapper is the executor's self-check tool, not an AC enforcer.
- `CHANGELOG.md` — version header `## [0.33.8]` for AC-11 (added by /ship Stage 7).
- `package.json` — version field `"0.33.8"` for AC-10 (bumped by /ship Stage 7).

## Checkpoint

- [x] Live-verify all 14 candidate issues (#287, #288, #289, #297, #298, #364, #391, #392, #393, #394, #396, #397, #398, plus task #113)
- [x] Scope decision: 4 fix + 3 close-as-shipped; 6 items + task #113 deferred
- [x] Plan draft at `.ai-workspace/plans/2026-04-21-v0-34-6-ci-release-polish.md`
- [x] Run `/coherent-plan` on plan file, fix findings in-place (1 CRITICAL + 3 MAJOR + 2 MINOR found, all fixed; banner escalated but /double-critique correctly skipped per outcome-plan Shape-1 HARD BLOCK — third consecutive slice where this pattern holds)
- [ ] `/delegate .ai-workspace/plans/2026-04-21-v0-34-6-ci-release-polish.md --via subagent`
- [ ] Executor delivers branch + wrapper green
- [ ] `/ship` — PR + stateless review + merge + tag v0.33.8 + release
- [ ] Post-merge: close #287, #288, #289 with rationale comment pointing at current master file:line
- [ ] Post-ship checkpoint ritual (6-part) + save WM card
- [ ] Mark #134, #135 completed; start post-sweep TaskList (monday ping + deferred items)

Last updated: 2026-04-21T05:10:00Z (post-coherent-plan: 1 CRITICAL + 3 MAJOR + 2 MINOR findings fixed in-place; AC-5 dropped as redundant, AC numbering re-flowed 13→12; v034-6 wrapper added to Critical files; OOS-9 role clarified; ordering + verification post-close semantics clarified)
