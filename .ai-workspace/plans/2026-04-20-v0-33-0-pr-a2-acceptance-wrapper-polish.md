---
title: "v0.33.0 PR A2 — acceptance wrapper polish"
date: 2026-04-20
owner: forge-plan (planner)
status: in-flight (delegated)
parent-triage: .ai-workspace/plans/2026-04-20-v0-33-0-polish-bundle-triage.md
closes: #315 #321 #323
retires: #322 (closed as dup of #315 during triage)
---

## ELI5

Two acceptance wrappers (corrector-crash-fix from v0.32.6, default-max-tokens-sweep from v0.32.7) share three defects: (a) they parse vitest stdout text like `Tests 12 passed` instead of using `--reporter=json`, which is brittle across vitest upgrades; (b) the v0.32.7 wrapper has an AC numbering gap (AC-1..AC-6 + AC-8, no AC-7); (c) both use `wc -l` without whitespace trim, fragile on BSD/macOS. Roughly 40 LoC across two scripts. Zero runtime behavior change — the wrappers still prove the same things, just more robustly.

## Context

**Baseline** (master HEAD `5ac9c1d`, post-v0.32.9):
- `bash scripts/corrector-crash-fix-acceptance.sh` — exits 0 on master (regression guard — must stay green).
- `bash scripts/default-max-tokens-sweep-acceptance.sh` — exits 0 on master (regression guard — must stay green).
- Both wrappers are **LOCAL acceptance gates**, not CI checks (`grep setup-config .github/workflows/` returns nothing, same pattern applies to these wrappers).

**The three defects:**
- **#315** — stdout string-matching. `scripts/corrector-crash-fix-acceptance.sh:67-73` and `scripts/default-max-tokens-sweep-acceptance.sh:50-56` both match `Tests  *[0-9]+ (failed|passed)` via `grep -qE` to distinguish a pre-existing vitest teardown-rpc flake from a real failure. Fix: use `npx vitest run --reporter=json` and query the structured JSON field (`numFailedTests` at the top level, or equivalent). Retires #322 (closed as dup during triage).
- **#321** — `scripts/default-max-tokens-sweep-acceptance.sh:32-66` prints AC-1..AC-6 and AC-8, skipping AC-7. Either add `[ -x "$0" ]` as AC-7, or renumber AC-8 down to AC-7. Both satisfy the contiguity AC below.
- **#323** — `git diff ... | wc -l` may emit leading whitespace on BSD/macOS. Trim via `| tr -d ' '` or equivalent. Applies to corrector wrapper line 81 and max-tokens wrapper line 64.

## Goal

1. Both wrappers use vitest's `--reporter=json` (or equivalent structured parse) instead of stdout string-matching for the full-suite "is it green ignoring the teardown flake" check.
2. v0.32.7 wrapper's AC numbering is contiguous.
3. Both wrappers trim `wc -l` before numeric compare.
4. Both wrappers exit 0 (regression guards still pass).
5. #315, #321, #323 auto-close via PR `closes` trailer.

## Binary AC

### AC-1 — corrector-crash wrapper still green
`bash scripts/corrector-crash-fix-acceptance.sh` exits 0, stdout contains `ALL GREEN`.

### AC-2 — max-tokens-sweep wrapper still green
`bash scripts/default-max-tokens-sweep-acceptance.sh` exits 0, stdout contains `ALL GREEN`.

### AC-3 — #315 reporter=json replaces stdout string-matching
```bash
grep -q -- '--reporter=json' scripts/corrector-crash-fix-acceptance.sh
grep -q -- '--reporter=json' scripts/default-max-tokens-sweep-acceptance.sh
! grep -qE 'Tests  *[0-9]+ (failed|passed)' scripts/corrector-crash-fix-acceptance.sh
! grep -qE 'Tests  *[0-9]+ (failed|passed)' scripts/default-max-tokens-sweep-acceptance.sh
```

### AC-4 — #321 max-tokens-sweep wrapper AC numbering is contiguous
```bash
NUMS=$(grep -oE 'check "AC-[0-9]+"' scripts/default-max-tokens-sweep-acceptance.sh | grep -oE '[0-9]+' | sort -n | uniq)
MIN=$(echo "$NUMS" | head -1)
MAX=$(echo "$NUMS" | tail -1)
COUNT=$(echo "$NUMS" | wc -l | tr -d ' ')
[ "$COUNT" -eq "$((MAX - MIN + 1))" ]
```

### AC-5 — #323 every `wc -l` use in both wrappers is trimmed
```bash
TOTAL=$(grep -cE 'wc -l' scripts/corrector-crash-fix-acceptance.sh scripts/default-max-tokens-sweep-acceptance.sh 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
TRIMMED=$(grep -cE 'wc -l[^|]*\| *(tr -d|awk|sed)' scripts/corrector-crash-fix-acceptance.sh scripts/default-max-tokens-sweep-acceptance.sh 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
[ "$TOTAL" -gt 0 ] && [ "$TOTAL" -eq "$TRIMMED" ]
```

### AC-6 — this A2 plan file exists (satisfied on merge)
`test -f .ai-workspace/plans/2026-04-20-v0-33-0-pr-a2-acceptance-wrapper-polish.md`.

## Out of scope

- Any other polish issue (#314, #316, #317, #318, #328, #329, #330, #331, #324 — land in PR B/C/D).
- Any core anthropic / plan / evaluate / corrector logic — wrappers ONLY.
- Renaming the wrappers.
- Adding a `jq` npm dependency — if `jq` isn't on PATH, substitute `node -e` + `fs.readFileSync` + `.numFailedTests` (same structural parse).
- setup-config surface (that was PR A1).

## Ordering constraints

None. All three defects touch disjoint regions inside each wrapper.

## Critical files

- `scripts/corrector-crash-fix-acceptance.sh` — lines 67-73 (stdout grep → --reporter=json), line 81 (wc -l trim).
- `scripts/default-max-tokens-sweep-acceptance.sh` — lines 50-56 (stdout grep → --reporter=json), line 64 (wc -l trim), AC numbering.
- `.ai-workspace/plans/2026-04-20-v0-33-0-pr-a2-acceptance-wrapper-polish.md` — this plan.

## Checkpoint

- [x] Baseline check against master (AC-1, AC-2 green on 5ac9c1d)
- [x] Run /coherent-plan (2 majors fixed)
- [x] /delegate invoked
- [ ] Executor ships branch green
- [ ] /ship → stateless reviewer → merge + auto-close

Last updated: 2026-04-20T06:50:00+00:00 — delegated.
