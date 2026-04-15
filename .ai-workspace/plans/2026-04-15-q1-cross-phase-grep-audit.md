# Q1 cross-phase audit — F-55/F-56 grep patterns in PH-02/03/04 phase JSONs

## Context

Task #21 (Q1 PH01-US-06 AC rewrite) addressed F-55/F-56 hazards in **one** story's ACs. Task #22 was scoped as the cross-phase sweep: do PH-02, PH-03, PH-04 carry the same grep-as-stdout-consumer hazard?

**Baseline measured 2026-04-15 against `master @ 2d2b78d`:**

- **Markdown plans are clean.** `2026-04-07-ph0{2,3,4}-*.md` and `2026-04-11-ph04-impl.md` contain **zero** `grep -q`/`grep -n` against subprocess stdout. The only grep is `grep -rn callClaude server/tools/...` in PH-04 (file-tree, F-55-safe).
- **Phase JSON files are NOT clean — but the smell is documented suppression, not drift.**
  - `grep -l 2026-04-13-c1-bootstrap .ai-workspace/plans/*.json` → **9 files** carry the exemption tag.
  - 6 of them (`forge-coordinate-phase-PH-{02,03,04}.json` + `forge-generate-phase-PH-{02,03,04}.json`) carry **112 total `grep -q 'passed'` AC commands** between them.
  - All 9 declare a `lintExempt[scope: "plan"]` block listing `F36-source-tree-grep`, `F56-passed-grep`, `F56-multigrep-pipe` with `batch: "2026-04-13-c1-bootstrap"` and rationale: *"Bootstrap absorption of pre-C1-bis grep-based verification smells. New drift must use F-rule-specified patterns. Unwind via grep -l 2026-04-13-c1-bootstrap .ai-workspace/plans/*.json."*

**The real question.** The 112 ACs were exempted as a *bootstrap* concession when C1-bis landed. Since then, forge-coordinate shipped v0.20.0, lint is now wired into CI (PR #208), the F-55/F-56 captured-output pattern is documented and proven, and the PH-02/03/04 phase work is **already complete** (these JSONs are historical execution records, not live ACs). The bootstrap exemption may have outlived its purpose — but it also may be load-bearing in some way I haven't measured (e.g., ac-lint or some CI step reads these JSONs and would redden if the exemption disappears).

This task makes that call **with measurement, not memory**, and either re-affirms the exemption with a refreshed rationale or unwinds the 112 ACs.

## Goal

Exactly one of the following invariants holds when done:

- **(A) Exemption re-affirmed.** All 9 `lintExempt` blocks exist with an updated `rationale` field citing the post-v0.20.0 / post-PR#208 measurement (i.e. "PH-{02,03,04} are shipped historical records; ac-lint does not consume these files in CI; live drift is prevented by [mechanism]"). The 112 grep ACs remain unchanged. A short rationale memo is committed alongside.
- **(B) Exemption unwound.** All 9 `lintExempt` blocks are removed (or have F36/F56 entries removed and other entries preserved), the 112 grep ACs are rewritten to the F-55/F-56-safe captured-output pattern (`OUT=$(...); echo "$OUT" | grep -q 'passed'` or equivalent documented in the F-55 rule), and `ac-lint` reports zero F-55/F-56 violations against the 9 files.

Not both. Not partial. Choose one branch based on the measured answer to "does anything currently consume these AC commands at runtime?"

## Binary AC

- [ ] AC-1 — **Branch chosen and recorded.** A new file `.ai-workspace/audits/2026-04-15-c1-bootstrap-exemption-decision.md` exists on the PR branch and contains a line matching `Decision: AFFIRM` or `Decision: UNWIND` within the first 10 lines. Reviewer command: `head -10 .ai-workspace/audits/2026-04-15-c1-bootstrap-exemption-decision.md | grep -cE '^Decision: (AFFIRM|UNWIND)$'` returns `1`.
- [ ] AC-2 — **Decision is supported by a measurement.** The same file contains a section starting `## Measurement` with at least one shell command that was actually run, its output, and one sentence explaining what the output proves. Reviewer command: `grep -c '^## Measurement$' .ai-workspace/audits/2026-04-15-c1-bootstrap-exemption-decision.md` returns `1`. (Reviewer additionally spot-reads the section.)
- [ ] AC-3 — **Branch A invariant (only if Decision: AFFIRM).** For every file in `grep -l 2026-04-13-c1-bootstrap .ai-workspace/plans/*.json`, the `lintExempt` block tagged `batch: "2026-04-13-c1-bootstrap"` still exists AND its `rationale` field on the PR branch differs from the rationale on `origin/master` (i.e. the rationale was actually refreshed, not left stale). Reviewer command: `for f in $(grep -l 2026-04-13-c1-bootstrap .ai-workspace/plans/*.json); do diff <(git show origin/master:"$f" | jq -r '.lintExempt[] | select(.batch=="2026-04-13-c1-bootstrap") | .rationale') <(jq -r '.lintExempt[] | select(.batch=="2026-04-13-c1-bootstrap") | .rationale' "$f") > /dev/null && echo "STALE $f"; done` prints zero `STALE` lines.
- [ ] AC-4 — **Branch B invariant (only if Decision: UNWIND).** `grep -c "grep -q 'passed'" .ai-workspace/plans/forge-{coordinate,generate}-phase-PH-0{2,3,4}.json | awk -F: '{s+=$2} END {print s}'` returns `0`. AND `grep -l 2026-04-13-c1-bootstrap .ai-workspace/plans/*.json` returns 0 lines (or all returned files no longer reference F36/F56 in their `lintExempt[].rules`).
- [ ] AC-5 — **ac-lint clean against the 9 files.** Whatever the chosen branch, `npx vitest run server/validation/ac-lint.test.ts 2>&1 | tail -5` shows 0 failures. (The test suite already covers this; the AC just guarantees it still passes.)
- [ ] AC-6 — **Build still passes.** `npm run build` exits `0`.
- [ ] AC-7 — **Lint still passes.** `npm run lint` exits `0` (newly enforced by PR #208).
- [ ] AC-8 — **Tests still pass.** `npm test` exits `0`.
- [ ] AC-9 — **No drive-by edits.** `git diff origin/master...HEAD --stat` shows changes confined to `.ai-workspace/plans/forge-*-phase-PH-0{2,3,4}.json`, `.ai-workspace/audits/2026-04-15-*.md`, and the plan file itself. No `server/**` source changes. No CI workflow changes.
- [ ] AC-10 — **CI green on the PR**, including the new lint step.

## Out of scope

- Do not touch `server/**`. This is a pure docs/JSON edit task.
- Do not modify `eslint.config.js`, `.github/workflows/*.yml`, or `tsconfig.json`.
- Do not edit phase JSONs for PH-01 (task #21 already handled that scope).
- Do not edit the PH-02/03/04 markdown plan files (they're already clean).
- Do not bundle task #21, #38 (Q3 F56→F55 rename), #23 (Q2 calibration), or #24 (Q3 issue triage).
- Do not alter the `lintExempt` block on any file that does NOT carry `batch: "2026-04-13-c1-bootstrap"`. Other exemption batches are out of scope.
- Do not force-push or rewrite history.

## Ordering constraints

AC-1/AC-2 must land in the same PR as AC-3 OR AC-4 (not both). The decision file and the executed branch are a single contract — landing one without the other is forbidden.

## Critical files

- `.ai-workspace/plans/forge-coordinate-phase-PH-02.json` — 19 grep occurrences
- `.ai-workspace/plans/forge-coordinate-phase-PH-03.json` — 29 grep occurrences
- `.ai-workspace/plans/forge-coordinate-phase-PH-04.json` — 29 grep occurrences
- `.ai-workspace/plans/forge-generate-phase-PH-02.json` — 15 grep occurrences
- `.ai-workspace/plans/forge-generate-phase-PH-03.json` — 10 grep occurrences
- `.ai-workspace/plans/forge-generate-phase-PH-04.json` — 10 grep occurrences
- 3 additional files match `grep -l 2026-04-13-c1-bootstrap` but carry zero `grep -q 'passed'` ACs — likely `forge-evaluate-phase-*.json` or master plans. Executor enumerates and decides per branch.
- `.ai-workspace/audits/2026-04-15-c1-bootstrap-exemption-decision.md` — created by executor, contains Decision + Measurement + (if UNWIND) before/after counts
- `server/validation/ac-lint.test.ts` — the test file the executor must keep green; **read-only**, do not edit

## Verification procedure

Reviewer runs (on PR branch):

```
git fetch origin && git checkout <pr-branch>
head -10 .ai-workspace/audits/2026-04-15-c1-bootstrap-exemption-decision.md   # AC-1, AC-2
git diff origin/master...HEAD --stat                                          # AC-9
npm ci && npm run build && npm test && npm run lint                           # AC-5..AC-8
```

Then, depending on the first line of the decision file:
- If `Decision: AFFIRM`: run AC-3's loop.
- If `Decision: UNWIND`: run AC-4's commands.

Reviewer reads the `## Measurement` section and confirms it actually justifies the decision.

## Checkpoint

- [x] Baseline measured (planner): 9 files exempt-tagged, 6 of them carry 112 `grep -q 'passed'` ACs total
- [x] Plan drafted (planner)
- [x] Plan critiqued via `/coherent-plan` (4 findings, 2 MAJOR fixed, below escalation threshold)
- [x] Baselines measured against master @ 2d2b78d via `/delegate`: AC-5 (52/52), AC-6 (build 0), AC-7 (lint 0), AC-8 (719 passed/4 skipped). All 4 regression baselines green; AC-1..AC-4 are new-artifact ACs (expected to fail baseline; that's the contract); AC-10 is post-merge.
- [x] Brief delivered to lucky-iris via `/delegate` — first real run, mailbox commit `38ccd83`, thread `q1-cross-phase-grep-audit`
- [ ] Executor ack with dirty-worktree pre-flight + HEAD SHA + tool check
- [ ] AC-1..AC-9 pass locally on executor's branch
- [ ] PR opened with `plan-refresh: no-op` trailer
- [ ] AC-10 (CI green) passes
- [ ] Stateless review PASS
- [ ] Merged + released
- [ ] Plan updated to shipped reality

Last updated: 2026-04-15T02:35:00+08:00 — plan critiqued via /coherent-plan, 2 MAJOR fixes applied (AC-1 prose↔command alignment, AC-3 jq selector keyed by batch).
