# Q3 / Task #38 — `F56-passed-grep` → `F55-passed-grep` rule rename

## Context

The ac-lint rule `F56-passed-grep` is mis-labeled. In `hive-mind-persist/knowledge-base/02-anti-patterns.md`:

- **F55** — AC Grep Regex Fails in MCP Subprocess Context (TTY-Dependent Output). The `grep -q 'passed'` / `grep -q 'failed'` pattern on vitest output is textbook F55: the subprocess has no TTY, vitest drops the "passed" summary line, and the grep false-greens. That failure mode is exactly what the rule detects.
- **F56** — AC Pipe Chain Stdin Bug Causes Infinite Hang. `cmd | grep -q 'x' && grep -q 'y'` has the second grep reading from the parent's terminal stdin and blocking forever. That's a different class.

The ac-lint source has three rules today, two of which are labeled F56:

| Rule id (current) | Actual class | Action |
|---|---|---|
| `F55-vitest-count-grep` | F55 (count regex on runner output) | keep |
| `F56-multigrep-pipe` | F56 (pipe chain stdin) | keep |
| `F56-passed-grep` | **F55** (passed/failed regex on runner output — not a pipe-chain bug) | **rename to `F55-passed-grep`** |

The rename is purely a label correction. No lint behavior changes — the matcher, the findings, the exempt surface, and the fixture corpus all stay identical. Only the `ruleId` string mutates.

**Blast radius** (measured on master `@ 919e0a7`, ~45 occurrences across 16 files):
- `server/lib/prompts/shared/ac-subprocess-rules.ts` — 1 (the definition)
- `server/validation/ac-lint.test.ts` — 22
- `server/lib/evaluator.test.ts` — 4
- `server/validation/ac-lint.ts` — 0 (reads `rule.id` indirectly; no hard-coded string)
- 9 phase JSONs under `.ai-workspace/plans/forge-{coordinate,generate}-phase-PH-0{1,2,3,4}.json` — 1 each in the `lintExempt[].rules` array (batch `2026-04-13-c1-bootstrap`, refreshed on v0.30.5 via task #22)
- `.ai-workspace/plans/2026-04-02-phase2-forge-plan-output.json` — 1 (historical fixture)
- `CHANGELOG.md` — 1 (historical — leave as-is)
- `.ai-workspace/plans/2026-04-13-q05-c1-bis-lint-exempt-plan-scope.md` — 1 (historical — leave as-is)
- `.ai-workspace/plans/2026-04-15-q1-cross-phase-grep-audit.md` — 1 (historical — leave as-is)
- `.ai-workspace/audits/2026-04-14-q05-verification-sweep.md` — 6 (historical — leave as-is)

**History preservation rule:** historical plans/audits/changelog reference the old id as a snapshot of what existed at the time. Do NOT rewrite them — that would launder the name through history and make future readers unable to correlate a past decision with its then-current rule id. The rename touches live source + live phase JSONs only.

**Why now.** Task #22 (PR #210) refreshed the 9 phase JSONs' `lintExempt` blocks on AFFIRM, which means the `F56-passed-grep` label just got re-asserted as load-bearing across all 9 files. Every future PH-01 AC rewrite (task #40, ~59 ACs) will also touch exempt blocks by reference. Fixing the label now is strictly cheaper than fixing it after #40 lands. Task #21 (PR #212) rewrote 5 PH-01 ACs without touching exempt blocks — no conflict.

**Hard-rename vs back-compat alias.** No back-compat alias. Everything that references the rule id lives in-repo; there are no downstream consumers. A hard rename is atomic, the test suite catches any miss, and it avoids the perpetual "rename incomplete" state that aliases create.

## Goal

When this plan is done, **every live reference to `F56-passed-grep` in source + phase JSONs says `F55-passed-grep`**, `ac-lint` + `evaluator` tests are green, and the 9 phase JSONs still lint-exempt the same AC commands they exempted before (verified by a before/after ac-lint findings diff).

## Binary AC

- [ ] **AC-1 — Rule definition renamed.** `server/lib/prompts/shared/ac-subprocess-rules.ts` contains `id: "F55-passed-grep"` and does NOT contain `"F56-passed-grep"`. Reviewer command:
  ```bash
  grep -c '"F55-passed-grep"' server/lib/prompts/shared/ac-subprocess-rules.ts  # returns 1
  grep -c '"F56-passed-grep"' server/lib/prompts/shared/ac-subprocess-rules.ts  # returns 0
  ```
- [ ] **AC-2 — Zero live `F56-passed-grep` references in source + phase JSONs.** Reviewer command (bash, Windows MSYS-safe; `xargs -r` guards against empty input hang):
  ```bash
  git ls-files 'server/**/*.ts' '.ai-workspace/plans/forge-*-phase-PH-*.json' '.ai-workspace/plans/2026-04-02-phase2-forge-plan-output.json' \
    | xargs -r grep -l 'F56-passed-grep' 2>/dev/null \
    | wc -l
  ```
  Returns `0`.
- [ ] **AC-3 — Live `F55-passed-grep` count equals the original live `F56-passed-grep` count, exactly.** The rename is strictly semantics-preserving — every old live reference becomes a new live reference, no net add/drop. An inequality in either direction is a rewrite bug (miss on the shrink side; drive-by add on the grow side). Reviewer command (uses per-file `git show origin/master:<path>` — the `-- <paths>` form of `git show` prints a filtered commit diff, not file contents, so it cannot be used here; `MSYS_NO_PATHCONV=1` required on Windows MSYS bash per task #22 learning #2):
  ```bash
  export MSYS_NO_PATHCONV=1
  FILES="server/lib/prompts/shared/ac-subprocess-rules.ts server/validation/ac-lint.test.ts server/lib/evaluator.test.ts .ai-workspace/plans/forge-coordinate-phase-PH-01.json .ai-workspace/plans/forge-coordinate-phase-PH-02.json .ai-workspace/plans/forge-coordinate-phase-PH-03.json .ai-workspace/plans/forge-coordinate-phase-PH-04.json .ai-workspace/plans/forge-generate-phase-PH-01.json .ai-workspace/plans/forge-generate-phase-PH-02.json .ai-workspace/plans/forge-generate-phase-PH-03.json .ai-workspace/plans/forge-generate-phase-PH-04.json .ai-workspace/plans/2026-04-02-phase2-forge-plan-output.json"
  OLD=0
  for f in $FILES; do
    c=$(git show "origin/master:$f" 2>/dev/null | grep -c 'F56-passed-grep' || echo 0)
    OLD=$((OLD + c))
  done
  NEW=$(grep -h 'F55-passed-grep' $FILES 2>/dev/null | wc -l)
  test "$OLD" -eq "$NEW"
  ```
  Exits 0 iff the counts are equal.
- [ ] **AC-4 — Semantics-preserving delta on phase JSONs (text proof).** AMENDED mid-flight by executor. The original framing (run `lintPlan` against master-JSONs and branch-JSONs, diff finding tuple sets) is structurally unsatisfiable: `lintPlan` validates every `lintExempt[].rules` id against the current worktree's `AC_LINT_RULES` and THROWS on unknown ids (`validateAndCollectPlanLevelExempts` in `server/validation/ac-lint.ts`). After the rename, `F56-passed-grep` is not in `AC_LINT_RULES` anymore, so master-JSONs are rejected before findings are produced — there is no tuple set to compare. The equivalent (and stronger) proof: for each phase JSON (plus `2026-04-02-phase2-forge-plan-output.json`), verify that the git-diff between master and branch is LITERALLY and ONLY the `F56-passed-grep` → `F55-passed-grep` swap, with no other changes. Given the ac-lint matcher is unchanged (verified by AC-5 unit tests staying green), a pure-label-swap text delta is sufficient proof that exempt-block behavior is preserved by construction. Reviewer command: `bash scripts/q3-task38-acceptance.sh` and read the AC-4 section — it iterates each phase JSON, extracts `git diff origin/master -- <file>`, and asserts removed-lines-minus-`F56-passed-grep` equals added-lines-minus-`F55-passed-grep`. Exits 0 iff every file is a pure swap.
- [ ] **AC-5 — ac-lint unit tests green.** `npx vitest run server/validation/ac-lint.test.ts` exits 0 with zero failures. Absolute — ac-lint is clean on master per task #22 baseline, and a rename that broke the test suite is a rename bug.
- [ ] **AC-6 — evaluator unit tests green.** `npx vitest run server/lib/evaluator.test.ts` exits 0. Same rationale as AC-5 — evaluator_test pins 4 occurrences of the old id and must be renamed in lockstep.
- [ ] **AC-7 — Build is delta-clean vs master.** `npm run build` exits 0 AND produces no new errors vs `origin/master`. Delta-framed per CLAUDE.md "latent debt" rule; expected to collapse to "exits 0".
- [ ] **AC-8 — Lint is delta-clean vs master.** `npm run lint` produces no new errors vs `origin/master`. Same framing.
- [ ] **AC-9 — Full test suite is delta-clean vs master.** `npm test` produces no new failures vs `origin/master`. Expected pass count on master: 719/4 skipped/0 failed (per task #22 baseline).
- [ ] **AC-10 — No drive-by edits.** `git diff origin/master...HEAD --stat` shows changes confined to:
  - `server/lib/prompts/shared/ac-subprocess-rules.ts`
  - `server/validation/ac-lint.test.ts`
  - `server/lib/evaluator.test.ts`
  - `.ai-workspace/plans/forge-coordinate-phase-PH-01.json`
  - `.ai-workspace/plans/forge-coordinate-phase-PH-02.json`
  - `.ai-workspace/plans/forge-coordinate-phase-PH-03.json`
  - `.ai-workspace/plans/forge-coordinate-phase-PH-04.json`
  - `.ai-workspace/plans/forge-generate-phase-PH-01.json`
  - `.ai-workspace/plans/forge-generate-phase-PH-02.json`
  - `.ai-workspace/plans/forge-generate-phase-PH-03.json`
  - `.ai-workspace/plans/forge-generate-phase-PH-04.json`
  - `.ai-workspace/plans/2026-04-02-phase2-forge-plan-output.json`
  - `.ai-workspace/plans/2026-04-16-q3-task38-f56-to-f55-passed-grep-rename.md` (this plan file)
  - `scripts/q3-task38-acceptance.sh` (new file — hard-rule-8 acceptance wrapper per task #22/#21 precedent)
  - Standard PR dotfiles (if any)
  No historical file rewrites (CHANGELOG.md, `.ai-workspace/plans/2026-04-13-*.md`, `.ai-workspace/plans/2026-04-15-*.md`, `.ai-workspace/audits/2026-04-14-*.md` MUST be unchanged).
- [ ] **AC-11 — CI green on the PR**, including lint, build, test, ac-lint, smoke-gate, and the code-review workflow.

## Out of scope

- **Do not rename `F55-vitest-count-grep`.** It's correctly labeled. Only `F56-passed-grep` → `F55-passed-grep`.
- **Do not rename `F56-multigrep-pipe`.** It IS the real F56 (pipe-chain stdin bug). Keep it.
- **Do not touch any AC `command` fields.** Task #21 rewrote 5 commands in PH01-US-06; task #40 will rewrite ~59 more. This task only touches exempt-rule ids and test-fixture ids. An AC command edit in this PR is an AC-10 violation.
- **Do not rewrite historical plans, audits, or CHANGELOG entries.** They are time-snapshots. Changing them rewrites history.
- **Do not add a back-compat alias** (`F56-passed-grep` → `F55-passed-grep` legacy mapping in ac-lint). Hard rename only.
- **Do not modify hive-mind-persist.** The F55/F56 entries in `02-anti-patterns.md` are already correct — the rename is local to forge-harness, not cross-repo.
- **Do not touch `eslint.config.js`, `.github/workflows/*.yml`, or `tsconfig.json`.**
- **Do not force-push or rewrite history.**
- **Do not bundle task #40's AC rewrites.** Task #40 is blocked on task #21 template, not on this task; bundling them blurs the blast radius.

## Ordering constraints

AC-1 and AC-2 must hold **simultaneously on the same commit** — a partial rename that leaves live `F56-passed-grep` references is a regression (ac-lint tests will red). AC-5 and AC-6 depend on AC-1 (the rule definition). AC-4 (the semantics-preserving tuple diff) is the load-bearing check — it can only be verified by the acceptance wrapper, not by unit tests, because the phase JSONs are not in the test corpus.

## Critical files

- `server/lib/prompts/shared/ac-subprocess-rules.ts` — rule definitions, single source of truth for ids. The rename's root: change `id: "F56-passed-grep"` on line 83 to `id: "F55-passed-grep"`.
- `server/validation/ac-lint.ts` — consumes `rule.id` as the finding's `ruleId`. No hard-coded string to change; verified via `grep`. Read-only.
- `server/validation/ac-lint.test.ts` — 22 references. Rewrite each as a direct literal swap.
- `server/lib/evaluator.test.ts` — 4 references under the critic-mode plan-level-exempt tests. Rewrite each as a direct literal swap.
- `.ai-workspace/plans/forge-{coordinate,generate}-phase-PH-0{1,2,3,4}.json` — 9 files, each with a `lintExempt[].rules` array containing `"F56-passed-grep"`. Rewrite each to `"F55-passed-grep"`. Do NOT touch any other field in the block (batch id, rationale, scope).
- `.ai-workspace/plans/2026-04-02-phase2-forge-plan-output.json` — historical fixture with 1 ref. The file is not "historical documentation" like the other audits — it's a captured LLM output used as a fixture. Rewrite the ref.
- `scripts/q3-task38-acceptance.sh` — new file. Wraps AC-1..AC-10 into a single executable script per task #22/#21 precedent. MUST export `MSYS_NO_PATHCONV=1` at top.

## Verification procedure

Reviewer runs (PR branch, fresh checkout):

```bash
git fetch origin && git checkout <pr-branch>
git diff origin/master...HEAD --stat                                  # AC-10
npm ci && npm run build && npm test && npm run lint                   # AC-7..AC-9
npx vitest run server/validation/ac-lint.test.ts                      # AC-5
npx vitest run server/lib/evaluator.test.ts                           # AC-6
bash scripts/q3-task38-acceptance.sh                                  # wraps AC-1..AC-4
```

Then reviewer independently runs the AC-1, AC-2, AC-3 reviewer commands verbatim from the Binary AC section (not via the wrapper — independent verification). For AC-4, reviewer spot-checks one phase JSON (e.g., `forge-coordinate-phase-PH-01.json`) by running the same before/after finding-set diff manually.

## Checkpoint

- [x] Context measured (planner): 45 occurrences across 16 files; live vs historical split captured
- [x] Plan drafted (planner)
- [x] Plan run through `/coherent-plan` (2 MAJOR + 3 MINOR, all fixed: AC-3 `git show` syntax, AC-4 wrapper flag prescription, AC-2 xargs -r, AC-3 strict equality, ordering constraints hardened)
- [ ] Baselines measured: AC-5 / AC-6 / AC-7 / AC-8 / AC-9 against master via `/delegate gate`
- [ ] Brief delivered via `/delegate` to stateless subagent
- [ ] Executor ack received with pre-flight clean
- [ ] Executor ships PR, acceptance wrapper green locally
- [ ] CI green (AC-11)
- [ ] Stateless review PASS
- [ ] Merged + released
- [ ] Plan updated to shipped reality
- [ ] Unblock task #40 — the rename removes the "which rule id do the new exempt blocks use?" ambiguity before #40 touches PH-01 US-01..US-05

Last updated: 2026-04-16 (planner draft, pre-critique)
