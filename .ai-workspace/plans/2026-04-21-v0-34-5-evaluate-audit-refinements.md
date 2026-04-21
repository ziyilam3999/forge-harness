---
plan: v0.34.5 — Evaluate audit refinements
date: 2026-04-21
scope: sixth v0.34.x polish slice; bundled patch release will be v0.33.7
issuesFixed: "#357, #358, #359"
baselineSha: 6bbf9a61de22527afb1c7fdb08b24b4ec8c07b1c
---

## ELI5

When we shipped the evaluate-max-tokens audit test (PR #356 in v0.33.0), the stateless reviewer flagged three polish items — all "works today, could be tighter." This slice tightens them:

1. **#357 — Tighten the regex.** The audit test scans `evaluate.ts` for `maxTokens` or `max_tokens` anywhere in the file. Anywhere means: inside comments too. If a future contributor writes `// note: maxTokens is intentionally omitted`, CI trips. We narrow the pattern to key on `<name>:` (the SDK-option shape), so comments can mention `maxTokens` without breaking CI.
2. **#358 — Drop the tautology.** The PR D acceptance wrapper has an AC that checks "this script is executable" — but the AC only runs *because* the script is executable. It's checking its own pulse. Remove it.
3. **#359 — Better ENOENT message.** If someone moves `evaluate.ts`, the audit test throws a low-level `readFileSync` error. Add an `existsSync` pre-check so CI prints a clean "audit target missing" message instead.

All three are quality-of-signal wins, zero behavior change, small surface area. Bundled for one patch release to minimize release churn.

## Context

PR #356 (v0.33.0 PR D) shipped a structural audit test for issue #324: guardrails that `server/tools/evaluate.ts` contains zero `maxTokens` / `max_tokens` references. The test + its acceptance wrapper landed green, but the stateless reviewer flagged three polish items as enhancements (#357, #358, #359). All three were left open for a follow-up slice; this is that follow-up.

Load-bearing facts for the executor:
- **Audit invariant MUST hold** post-change: `grep -cE 'maxTokens|max_tokens' server/tools/evaluate.ts` still returns `0`. This slice touches only the *test* regex, not the audited file.
- **Test currently has 9 `maxTokens` mentions** (measured 2026-04-21 against master `6bbf9a6`). AC-D2 in `scripts/pr-d-acceptance.sh` asserts `>= 3`. After the refactor, mentions may drop slightly but must stay `>= 3`.
- **`pr-d-acceptance.sh` is an already-shipped historical artefact** from v0.33.0. Editing it retroactively is fine (it has no upstream CI hook — it's an executor-local re-verification script). Removing AC-D7 is a pure noise-reduction edit.
- **Issue #358 names a pattern-wide concern** ("future plan-mandated acceptance wrappers should omit self-referential ACs"). We are NOT retrofitting that rule into this slice — only fixing the one wrapper named in the issue. The pattern-wide lesson lives in the WM card + CLAUDE.md feedback, not in code.
- **Cumulative master test count at baseline**: 800 passing / 4 skipped (pre-slice). Test count deltas in this slice are restricted to the audit test file; no new describe blocks expected.

## Goal

Outcomes that must hold when done:

1. `evaluate-max-tokens-audit.test.ts` uses a regex keyed on SDK-option shape (`<name>:`) rather than substring match, eliminating the comment-false-positive class of failure.
2. `evaluate-max-tokens-audit.test.ts` emits a clear "audit target missing" error (rather than a raw `readFileSync` ENOENT) when `evaluate.ts` is moved or deleted.
3. `scripts/pr-d-acceptance.sh` no longer contains the self-referential AC-D7 section (script-is-executable check).
4. All three issues are referenced in the PR body via a `Fixes` trailer, so merge auto-closes them.
5. Invariants preserved: `evaluate.ts` maxTokens count still 0; test still runs green; full vitest suite still green; no changes to any file outside the slice's allowlist.

## Binary AC

1. **AC-1** — test regex is keyed on option-shape: `grep -cE '\\bmaxTokens\\s*:|\\bmax_tokens\\s*:' server/tools/evaluate-max-tokens-audit.test.ts` returns `>= 1`.
2. **AC-2** — old substring-match pattern is removed: the exact literal `/maxTokens|max_tokens/g` no longer appears in `server/tools/evaluate-max-tokens-audit.test.ts`. Reviewer command: `grep -F '/maxTokens|max_tokens/g' server/tools/evaluate-max-tokens-audit.test.ts | wc -l` returns `0`.
3. **AC-3** — `existsSync` pre-check is wired in: `grep -c "existsSync" server/tools/evaluate-max-tokens-audit.test.ts` returns `>= 2` (one import, at least one call site).
4. **AC-4** — the audit test file still runs green against the current `evaluate.ts`: `npx vitest run server/tools/evaluate-max-tokens-audit.test.ts` exits `0` with zero failures reported.
5. **AC-5** — the audit invariant still holds on `evaluate.ts`: `grep -cE 'maxTokens|max_tokens' server/tools/evaluate.ts` returns `0`.
6. **AC-6** — AC-D7 section is removed from the wrapper: `grep -c "AC-D7" scripts/pr-d-acceptance.sh` returns `0` AND `grep -c "wrapper script is executable" scripts/pr-d-acceptance.sh` returns `0` (the pass-message phrase was unique to the AC-D7 block).
7. **AC-7** — full test suite runs green: `npx vitest run --reporter=json --outputFile=tmp/v034-5-vitest.json` exits `0` AND `node -e "const r=JSON.parse(require('fs').readFileSync('tmp/v034-5-vitest.json','utf8')); if(r.numFailedTests===0 && r.numPassedTests >= 798) process.exit(0); else process.exit(1);"` exits `0`. (Lower bound `>= 798` allows two-test slack for parallel-work churn; baseline is 800, so any material regression is caught.)
8. **AC-8** — lint passes: `npm run lint` exits `0`.
9. **AC-9** — typecheck passes: `npm run build` exits `0` (tsc strict mode).
10. **AC-10** — no drive-by edits. `git diff --name-only origin/master...HEAD` returns ONLY files from this allowlist (no extras): `server/tools/evaluate-max-tokens-audit.test.ts`, `scripts/pr-d-acceptance.sh`, `.ai-workspace/plans/2026-04-21-v0-34-5-evaluate-audit-refinements.md`, `scripts/v034-5-acceptance.sh`.
11. **AC-11** — PR body closes all three issues: the PR body contains the literal string `Fixes #357, fixes #358, fixes #359` (exact casing on first word, comma-separated `fixes` for the rest — per feedback_github_fixes_multi_issue_syntax).
12. **AC-12** — plan-mandated acceptance wrapper exists and runs green: `bash scripts/v034-5-acceptance.sh` exits `0`. The wrapper runs AC-1..AC-10 internally; AC-11 (PR body) is reviewer-only since it requires the PR URL, and AC-12 is trivially its own existence.

## Out of scope

1. **Renumbering the remaining ACs in `pr-d-acceptance.sh`.** AC-D7 deletion leaves a gap (D1..D6, D8). Whether to close that gap is an executor judgment call — either keep the gap (less diff churn, slight readability cost) or renumber D8→D7 (cleaner, more diff). Plan stays neutral. AC-10's allowlist does NOT flag either choice as out-of-scope.
2. **Re-running `bash scripts/pr-d-acceptance.sh` end-to-end.** This wrapper's AC-D5 pins `package.json` to the historical `0.32.14`; it will fail on any branch that isn't that exact release. AC-D7 removal is verified structurally (via AC-6 grep checks), not by re-executing the wrapper. Do NOT add an AC that runs the wrapper — it is non-executable outside its original v0.33.0 PR D context.
3. **Changes to `server/tools/evaluate.ts` itself.** This slice touches only audit-side code. If the executor spots drift in `evaluate.ts`, flag it back as a separate issue — do NOT fix it here.
4. **Changes to other acceptance wrappers** (`scripts/pr-a1-acceptance.sh`, `scripts/pr-a2-acceptance.sh`, `scripts/pr-b-acceptance.sh`, `scripts/pr-c-acceptance.sh`, `scripts/pr-e-acceptance.sh`, or any `scripts/v0*-acceptance.sh`). Issue #358's "pattern-wide" note is deliberately not retrofitted in this slice — the lesson lives in the WM card + a feedback memory, not in code. Future wrappers should follow the pattern, but we do not rewrite history for wrappers already shipped and green.
5. **Touching `server/tools/evaluate-max-tokens-audit.test.ts` beyond the three named fixes.** Do not refactor the JSDoc, test names, describe blocks, or helper extraction — the file's shape is fine as-is.
6. **Updating `CHANGELOG.md` or bumping `package.json`.** Those are /ship Stage 7 release-stage edits; they land AFTER the squash-merge, not in the executor's PR diff. Allowlist in AC-10 reflects this.
7. **Re-running or re-auditing PR #356's original scope.** Issue #324 is closed; this slice is purely a follow-up polish on the artefacts PR #356 produced.
8. **Adding a CI-side stat check for wrapper executability** (issue #358's option (b)). Out of scope this slice; not worth a workflow YAML edit for a once-per-wrapper concern.

## Verification procedure

Reviewer (stateless subagent, fresh eyes) runs these against the executor's branch:

1. **Confirm allowlist (AC-10):** `git diff --name-only origin/master...HEAD` returns exactly the 4-file allowlist.
2. **AC-1..AC-3 (test file shape):** the three greps in AC-1/AC-2/AC-3 each return expected counts.
3. **AC-4 (audit test green):** `npx vitest run server/tools/evaluate-max-tokens-audit.test.ts` exits 0, reports both `it(...)` cases passing.
4. **AC-5 (audit invariant):** `grep -cE 'maxTokens|max_tokens' server/tools/evaluate.ts` returns `0`.
5. **AC-6 (wrapper AC-D7 gone):** `grep -c "AC-D7" scripts/pr-d-acceptance.sh` returns `0` AND `grep -c "wrapper script is executable" scripts/pr-d-acceptance.sh` returns `0`. Do NOT attempt to `bash scripts/pr-d-acceptance.sh` — AC-D5 inside that wrapper pins package.json to 0.32.14 and will always fail on current branches (see out-of-scope item 2).
6. **AC-7 (full suite):** `npx vitest run` exits 0 with no failed tests, passed count >= 798.
7. **AC-8 (lint):** `npm run lint` exits 0.
8. **AC-9 (build):** `npm run build` exits 0.
9. **AC-12 (plan wrapper):** `bash scripts/v034-5-acceptance.sh` exits 0.
10. **AC-11 (PR body):** reviewer reads `gh pr view <n> --json body` and confirms the `Fixes #357, fixes #358, fixes #359` trailer is present verbatim.

## Critical files

- `server/tools/evaluate-max-tokens-audit.test.ts` — audit test. Target of #357 (regex tightening) + #359 (existsSync pre-check). Note the file's JSDoc block (lines 6-31) documents the audit rationale — preserve it verbatim.
- `server/tools/evaluate.ts` — the audited target. Read-only for this slice. AC-5 pins its maxTokens count at 0; if that count has drifted by the time the executor starts, flag back immediately (plan premise broken).
- `scripts/pr-d-acceptance.sh` — PR D historical wrapper. Target of #358 (AC-D7 removal). Note AC-D5 inside it pins package.json version to `0.32.14` — that's historical; no need to update.
- `scripts/v034-5-acceptance.sh` — NEW file, executor-authored. Runs AC-1..AC-10 as one script; exits 0 iff all pass. AC-11 (PR body) and AC-12 (wrapper self-existence) are deliberately excluded from the wrapper — one requires the PR URL (reviewer-only) and the other is trivially its own existence. Mirrors the conventions of `scripts/v034-4-acceptance.sh`: project-relative `tmp/acN.log`, explicit per-AC exit codes, MSYS_NO_PATHCONV guard at top.
- `.ai-workspace/plans/2026-04-21-v0-34-5-evaluate-audit-refinements.md` — this file. Executor may append to Checkpoint; planner owns everything else.

## Ordering constraints

None. All three fixes are independent and can land in any commit order. Commit-per-task is the default mode (per global feedback); executor may choose finer granularity if preferred.

## Checkpoint

- [ ] Executor ack received (with dirty-worktree check, HEAD SHA, tool availability)
- [ ] #357 regex tightened in test file
- [ ] #359 existsSync pre-check added in test file
- [ ] #358 AC-D7 section removed from wrapper
- [ ] `scripts/v034-5-acceptance.sh` created and exits 0
- [ ] All binary AC verified green on executor's branch
- [ ] Stateless reviewer PASS
- [ ] Merged + released as v0.33.7
- [ ] All three GH issues auto-closed by the `Fixes` trailer
- [ ] Post-ship checkpoint ritual + WM card

Last updated: 2026-04-21T07:55:00+08:00 — post-coherent-plan fixes (3 findings: 1 critical + 2 major). AC-7 removed (wrapper re-run asserted exit 0 but pr-d AC-D5 would fail), AC-6 simplified (dropped broken basic-regex alt + redundant substring check), ACs renumbered 1..12 and all cross-refs updated.
