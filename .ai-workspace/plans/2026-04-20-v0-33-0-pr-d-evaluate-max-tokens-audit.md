---
task: v0.33.0 PR D — evaluate.ts max_tokens audit (issue #324)
created: 2026-04-20
branch-state: commit-per-task
---

# v0.33.0 PR D — evaluate.ts max_tokens audit (issue #324)

## ELI5

When we raised the default token ceiling from 8192 → 32000 in v0.32.7 (PR #320), we swept every LLM call that uses the default — those are fine automatically. But some calls explicitly say "give me only 4096 tokens" on purpose. Those wouldn't get the raise. Issue #324 asks: are there any such explicit small ceilings inside `server/tools/evaluate.ts` that we missed?

Answer, measured against master SHA `2de7e1d`: **no**. All 3 LLM call sites in `evaluate.ts` (coherence-eval L282, reverse-eval L489, critic-eval L676) pass zero `maxTokens` override, which means they all ride the raised default. The companion file `evaluator.ts` turns out not to call Claude at all (it's purely shell-command execution), so it has nothing to audit.

PR D therefore has two jobs: (1) **lock the audit outcome as a test-enforced invariant** so a future edit that slips in `maxTokens: 4096` inside evaluate.ts fails CI, (2) document the audit result in the CHANGELOG so #324 closes with a paper trail. No runtime code changes.

## Context

- Source issue: [#324](https://github.com/ziyilam3999/forge-harness/issues/324) — filed on PR #320's review, tagged `enhancement` + `ship-review` + `housekeep-triaged` + `ready`.
- v0.32.7 raised `DEFAULT_MAX_TOKENS` from 8192 → 32000 in `server/lib/anthropic.ts:12`; callers that pass `maxTokens:` as an option override the default via `options.maxTokens ?? DEFAULT_MAX_TOKENS` at `anthropic.ts:227`.
- v0.32.8 made `callClaude` unconditionally streaming to clear the SDK's 10-minute timeout at the new high ceiling.
- Baseline grep against master (`2de7e1d`):
  - `grep -nE 'maxTokens|max_tokens' server/tools/evaluate.ts` → **zero matches**.
  - `grep -nE 'maxTokens|max_tokens' server/lib/evaluator.ts` → **zero matches**.
  - `grep -nE 'trackedCallClaude|callClaude' server/lib/evaluator.ts` → **zero matches** (mechanical-only, no LLM).
- 3 `trackedCallClaude` sites inside `server/tools/evaluate.ts`: line 282 (coherence-eval), line 489 (reverse-eval), line 676 (critic-eval). All pass `{system, messages, jsonMode}` with no `maxTokens` field.
- The audit scope per the issue body is **`server/tools/evaluate.ts` + `server/lib/evaluator.ts`** only. Other files with `trackedCallClaude` (`plan.ts`, `generate.ts`, `lint-refresh.ts`) are out of scope for this slice — separate audit if ever needed.
- Anthropic call tests already exist: `server/lib/anthropic.test.ts` covers the default-32000 case, the explicit-override case, and the truncation error at arbitrary ceilings (specific test count not measured — count not load-bearing).

## Goal

Close issue #324 with an evidence-backed "no action needed" outcome, implemented as:

1. A new test that structurally asserts `server/tools/evaluate.ts` contains zero `maxTokens` token appearances — guardrail against regression.
2. A CHANGELOG entry under v0.32.14 (next patch) documenting the audit result + scope + closure reference.

Both invariants must hold on master after the merge squash.

## Binary AC

All ACs must be runnable from a bash shell with `cwd = repo root`, exit 0 when the invariant holds. Each AC has been baseline-checked against master SHA `2de7e1d` — expected pre-implementation outcomes are noted.

**AC-D1** (regression-guard test exists and passes):

```bash
# Expect PASS after implementation. Baseline: FAIL on master (test doesn't exist yet).
mkdir -p tmp && MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/pr-d-ac-d1.json server/tools/evaluate-max-tokens-audit.test.ts > /dev/null 2>&1; node -e "const r=require('./tmp/pr-d-ac-d1.json'); if (r.numPassedTests >= 1 && r.numFailedTests === 0) process.exit(0); else { console.error('audit test: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed'); process.exit(1); }"
```

Reviewer command: the test file `server/tools/evaluate-max-tokens-audit.test.ts` must exist AND vitest JSON report for that file must show `numPassedTests >= 1` with `numFailedTests === 0`.

**AC-D2** (structural assertion is the actual content of the new test):

```bash
# Expect PASS after implementation. Baseline: FAIL (file absent).
test -f server/tools/evaluate-max-tokens-audit.test.ts && \
  grep -cE 'maxTokens' server/tools/evaluate-max-tokens-audit.test.ts | awk '$1 >= 3 { exit 0 } { exit 1 }'
```

The test file must mention `maxTokens` in at least 3 locations (the assertion, the rationale comment, and the expected-zero count check).

**AC-D3** (source file still has zero `maxTokens` overrides — the invariant the test locks in):

```bash
# Expect PASS on master. Baseline: PASS on master (already true — this is the guardrail).
grep -cE 'maxTokens|max_tokens' server/tools/evaluate.ts | awk '$1 == 0 { exit 0 } { exit 1 }'
```

**AC-D4** (CHANGELOG documents the audit):

```bash
# Expect PASS after implementation. Baseline: FAIL (no v0.32.14 entry yet).
node -e "const s=require('fs').readFileSync('CHANGELOG.md','utf8'); const m=s.match(/## \[0\.32\.14\][\s\S]*?(?=\n## \[)/); if (!m) { process.exit(1); } const block=m[0]; if (!/#324/.test(block)) process.exit(2); if (!/audit/i.test(block)) process.exit(3); if (!/evaluate\.ts/.test(block)) process.exit(4); process.exit(0);"
```

The CHANGELOG must have a `## [0.32.14]` section that mentions `#324`, the word `audit` (case-insensitive), and the file `evaluate.ts`.

**AC-D5** (package.json version bumped to 0.32.14):

```bash
# Expect PASS after implementation. Baseline: FAIL (currently 0.32.13).
node -e "if (require('./package.json').version === '0.32.14') process.exit(0); else process.exit(1);"
```

**AC-D6** (test suite still green end-to-end — no regressions AND the new audit test is counted):

```bash
# Expect PASS after implementation. Baseline floor: 774 passing (post-PR C).
# Post-PR-D floor: 774 baseline + >=1 new audit test = >=775. Silent-drop regression guard.
MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/pr-d-vitest.json > /dev/null 2>&1; node -e "const r=require('./tmp/pr-d-vitest.json'); if (r.numFailedTests === 0 && r.numPassedTests >= 775) process.exit(0); else { console.error('tests: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed'); process.exit(1); }"
```

**AC-D7** (acceptance wrapper present, executable, and green):

```bash
# Expect PASS after implementation. Baseline: FAIL (wrapper absent).
test -x scripts/pr-d-acceptance.sh && bash scripts/pr-d-acceptance.sh 2>&1 | tail -3 | grep -q 'ALL PR D ACCEPTANCE CHECKS PASSED'
```

The wrapper is both a deliverable AND the executor's self-check before handing back.

**AC-D8** (no drive-by edits beyond the allowlist):

```bash
# Expect PASS after implementation.
# Allowlist: CHANGELOG.md, package.json, server/tools/evaluate-max-tokens-audit.test.ts, scripts/pr-d-acceptance.sh, .ai-workspace/plans/2026-04-20-v0-33-0-pr-d-evaluate-max-tokens-audit.md
git diff --name-only origin/master...HEAD | grep -vE '^(CHANGELOG\.md|package\.json|server/tools/evaluate-max-tokens-audit\.test\.ts|scripts/pr-d-acceptance\.sh|\.ai-workspace/plans/2026-04-20-v0-33-0-pr-d-evaluate-max-tokens-audit\.md)$' | wc -l | awk '$1 == 0 { exit 0 } { exit 1 }'
```

Nothing outside the allowlist must change. Per CLAUDE.md's auto-injected AC-9 allowlist note, `scripts/pr-d-acceptance.sh` is automatically in-scope.

## Out of scope

1. **Auditing other LLM call sites** (`server/tools/plan.ts`, `server/tools/generate.ts`, `server/tools/lint-refresh.ts`, `server/lib/plan-*.ts`, `server/lib/generator.ts`). If any have small explicit ceilings, they need their own issues and PRs.
2. **Changing `DEFAULT_MAX_TOKENS`**. v0.32.7 set it to 32000; don't touch it.
3. **Adding runtime max-tokens handling in evaluate.ts**. The invariant is "no override exists." Don't add one "just in case."
4. **Runtime behavior of the 3 call sites**. The audit is structural — don't mock Anthropic SDK calls or assert token counts against live API responses.
5. **Fixing issues #352, #353, #354, #355** (new follow-ups filed on PR C). They're v0.34.x material.
6. **CHANGELOG non-monotonic header ordering** (issue #354). Known pre-existing condition; will be cleaned up during PR E or the final v0.33.0 release entry.
7. **Anything in `server/lib/evaluator.ts`**. Confirmed LLM-free during plan research. Mentioning it in the CHANGELOG entry is fine (as part of the audit scope), but no edits to that file.
8. **Editing `server/tools/evaluate.ts`**. The audit locks the file's current shape; any edit (even a comment) invalidates the audit premise. AC-D3 enforces zero `maxTokens` grep hits as a mechanical guardrail, but the out-of-scope is stronger: no edit at all.

## Verification procedure

Reviewer (stateless subagent or `/ship` Stage 5) runs these commands in order:

```bash
# 1. Structural invariant (source file)
grep -cE 'maxTokens|max_tokens' server/tools/evaluate.ts

# 2. Companion file sanity
grep -cE 'trackedCallClaude|callClaude' server/lib/evaluator.ts

# 3. New guardrail test runs green
MSYS_NO_PATHCONV=1 npx vitest run --reporter=verbose server/tools/evaluate-max-tokens-audit.test.ts

# 4. CHANGELOG entry shape
node -e "const s=require('fs').readFileSync('CHANGELOG.md','utf8'); console.log(s.match(/## \[0\.32\.14\][\s\S]*?(?=\n## \[)/)?.[0] ?? 'MISSING');"

# 5. Version bumped
node -p "require('./package.json').version"

# 6. Full test suite green
MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/pr-d-vitest.json > /dev/null; node -p "const r=require('./tmp/pr-d-vitest.json'); \`\${r.numPassedTests} passed / \${r.numFailedTests} failed / \${r.numTotalTests} total\`"

# 7. Wrapper script
bash scripts/pr-d-acceptance.sh
```

Expected outputs:
- #1: `0`
- #2: `0`
- #3: vitest reports the audit file with ≥1 passing test
- #4: a non-empty block containing `#324`, `audit`, `evaluate.ts`
- #5: `0.32.14`
- #6: `≥775 passed / 0 failed / ≥779 total` (774 baseline + ≥1 new test)
- #7: `ALL PR D ACCEPTANCE CHECKS PASSED`

## Critical files

- `server/tools/evaluate.ts` — the audit target (read-only; the test locks its current shape).
- `server/lib/evaluator.ts` — LLM-free shell-execution module (read-only; mentioned in CHANGELOG as scope coverage).
- `server/lib/anthropic.ts` — source of `DEFAULT_MAX_TOKENS = 32000` (read-only; context only).
- `server/lib/anthropic.test.ts` — existing max-token test reference for context only. The new audit test reads `server/tools/evaluate.ts` from disk and is structurally independent.
- `server/tools/evaluate-max-tokens-audit.test.ts` — **new file**; structural test that reads `server/tools/evaluate.ts` from disk and asserts zero `maxTokens` matches.
- `CHANGELOG.md` — prepend v0.32.14 entry above the existing v0.32.13 block.
- `package.json` — bump `version` `0.32.13` → `0.32.14`.
- `scripts/pr-d-acceptance.sh` — **new file, executable**; runs AC-D1 through AC-D6 in order; `set -euo pipefail`; exits 0 iff all green; prints `ALL PR D ACCEPTANCE CHECKS PASSED`.

## Ordering constraints

- AC-D1, AC-D2 land in the same commit (test file is the artifact both check).
- AC-D4, AC-D5 land together (`chore: release 0.32.14`-style commit or earlier).
- AC-D7 depends on AC-D1..D6 being runnable — wrapper runs them in sequence.
- AC-D8 is strictly post-hoc (assertion over the final diff set); it is run last.

## Hard rules for the executor

1. **Read the plan end-to-end before editing anything.** The audit outcome is pre-measured — no research needed, no AC tuning needed.
2. **AC is contract.** If you think an AC is wrong, flag it via mailbox/ack reply with `priority: blocker`; do not rewrite silently.
3. **Pick your own how.** The plan suggests a structural regex test; if you have a better way to enforce "zero `maxTokens` overrides in `evaluate.ts`" (e.g., TypeScript AST parse instead of string grep) that satisfies AC-D1/D2/D3, go for it.
4. **Environment quirks.** Windows MSYS: use `MSYS_NO_PATHCONV=1` as a prefix for any `git show <rev>:<path>`. All vitest commands should be invoked via `npx vitest run ...` to avoid PATH issues.
5. **Stop-on-mode-halt.** If plan mode activates, tool permission blocks, or any non-recoverable halt occurs — emit a status report and stop. No workarounds.
6. **Stop-on-contradiction.** If executing would violate out-of-scope AND satisfy an AC simultaneously, stop with a `priority: blocker` mail.
7. **Commit-per-task mode.** Commit logical units (test, CHANGELOG+version bump, wrapper) as separate commits on a feature branch. Don't stage-only.
8. **Stop-at-branch.** Final state: branch has all commits, wrapper green, no push/merge. `/ship` handles push/PR/merge/release.
9. **Acceptance wrapper pre-flight check.** Before handing back, run `bash scripts/pr-d-acceptance.sh` yourself. All green or STOP.
10. **Dirty-worktree pre-flight in the ack.** Before confirming "starting implementation," ack reply must include `git status --porcelain`, HEAD SHA, expected base branch (`master`), and tool availability: `npx vitest`, `node`, `grep`, `awk`. Dirty worktree → stash + note, or flag back.

### Windows MSYS path safety

The verification procedure and AC-D1, AC-D6 use `npx vitest run` with file paths. No `<rev>:<path>` git commands are in this brief, so `MSYS_NO_PATHCONV=1` is a defensive prefix only, not strictly required — but the wrapper should export it at top for safety.

### AC-D8 allowlist note (auto-injected per CLAUDE.md)

This brief's hard rule #8 mandates an acceptance wrapper at `scripts/pr-d-acceptance.sh`. AC-D8's allowlist glob names the wrapper explicitly; the wrapper is in-scope.

## Tool manifest

The executor can assume these tools are installed:

- `node` (≥20.0.0 per `package.json` engines)
- `npm` + `npx` (for vitest)
- `git`
- `grep`, `awk`, `wc` (bash builtins equivalents are acceptable)
- `bash` (MSYS on Windows is fine — wrapper should export `MSYS_NO_PATHCONV=1`)

If a listed tool is missing, substitute an equivalent and note the substitution in the ack.

## Checkpoint

- [x] Research complete: `evaluate.ts` has 0 `maxTokens`, `evaluator.ts` has 0 LLM calls, master HEAD = `2de7e1d`.
- [x] Baselines measured for AC-D1 through AC-D8 (6 expected-FAILs pre-implementation: AC-D1/D2/D4/D5/D6/D7; 1 expected-PASS as guardrail: AC-D3; AC-D8 is post-hoc diff check, no pre-baseline semantic).
- [x] Plan drafted.
- [ ] `/coherent-plan` review.
- [ ] `/delegate --via subagent`.
- [ ] Executor ack received.
- [ ] Executor reports wrapper green.
- [ ] Stateless review PASS.
- [ ] `/ship` merge + release.
- [ ] Issue #324 auto-closed by `fixes` trailer.

Last updated: 2026-04-20 — plan drafted with 8 binary AC, 5 critical files, 7 out-of-scope items.
