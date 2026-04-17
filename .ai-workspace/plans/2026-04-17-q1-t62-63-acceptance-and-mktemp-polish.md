# q1 task #62 + #63 — acceptance-script git-diff scope + generate-phase mktemp trap cleanup

## Context

Two independent defects discovered while verifying #62 and #63 via rule #9 (read target governance before accepting premise). Both are real; bundled in one PR because they touch adjacent areas (the q1 task-40 acceptance harness) and neither warrants a standalone slice.

**Defect A — issue #240 only partially fixed.** Issue #240 was closed by PR #225 (trap cleanup + git-diff scope fixes), but the fix landed only in scripts `q1-t40-02..04-acceptance.sh`. Scripts `q1-t40-06..09-acceptance.sh` still invoke `git diff --numstat` without a base-branch ref. Post-commit, raw `git diff --numstat` compares the working tree to the index (not the feature branch to master), so the computed add/remove counts are wrong — typically zero when the tree is clean, which means any AC that reads those counts silently passes against fake data. Current offending lines:

- `scripts/q1-t40-06-acceptance.sh:57` — `STAT=$(git diff --numstat .ai-workspace/plans/forge-coordinate-phase-PH-01.json)`
- `scripts/q1-t40-07-acceptance.sh:35,36` — `$(git diff --numstat -- "$JSON" | awk ...)`
- `scripts/q1-t40-08-acceptance.sh:22` — `STATS=$(git diff --numstat "$JSON")`
- `scripts/q1-t40-09-acceptance.sh:20,21` — `$(git diff --numstat .ai-workspace/plans/forge-generate-phase-PH-01.json | awk ...)`

Scripts `01` and `05` don't use `git diff --numstat` — a different shape — and are out of scope.

**Defect B — issue #239 only partially fixed.** Issue #239's trap-cleanup sweep landed `trap 'rm -f "$TMP"' EXIT` in the *coord-phase* PH-01 JSON (34 of 34 mktemp AC commands, confirmed). The *generate-phase* PH-01 JSON was authored on a separate track and never received the sweep — current parity is 32 mktemp / 0 trap. On MSYS/Windows bash, un-trapped mktemp files accumulate in `$TMPDIR` indefinitely because the OS never GCs them on process exit. CI re-runs of the generate-phase phase harness therefore leak a new temp file per AC per run.

**Why now.** Both fixes are small, mechanical, and unblock the task-40 harness's measurement integrity. #62 is load-bearing for any future AC that reads numstat counts (PR-body reporting, divergence measurement). #63 is cleanliness/hygiene but will leak indefinitely until fixed.

**Rule #9 evidence.** Both defects were visible only by opening the target artefacts — closed-issue memory said "fixed," the files said otherwise. Issue status is a routing hint, not governance.

## Goal

1. Every script in `scripts/q1-t40-06..09-acceptance.sh` measures git diffs against `origin/master...HEAD` (or a semantically-equivalent base-branch ref) such that `git diff --numstat` reports the feature-branch's divergence from master, not working-tree-vs-index.
2. `forge-generate-phase-PH-01.json` AC commands that use `mktemp` also trap-clean their temp file on EXIT, reaching parity with the coord-phase JSON (32 mktemp → 32 trap coverage).
3. No existing AC behavior changes semantically except for the git-diff scope and the trap addition. No story restructuring, no AC renaming, no unrelated JSON edits.

## Binary AC

1. **AC-1 — all four scripts reference a base-branch-scoped diff**. `grep -c "origin/master\.\.\.HEAD\|master\.\.\.HEAD" scripts/q1-t40-06-acceptance.sh scripts/q1-t40-07-acceptance.sh scripts/q1-t40-08-acceptance.sh scripts/q1-t40-09-acceptance.sh` reports a non-zero match count for each file (each script has at least one match). Reviewer command: `MSYS_NO_PATHCONV=1 for f in scripts/q1-t40-0{6,7,8,9}-acceptance.sh; do c=$(grep -c "master\.\.\.HEAD" "$f"); echo "$f $c"; [ "$c" -ge 1 ] || exit 1; done`.

2. **AC-2 — no raw, unscoped `git diff --numstat` remains in those scripts**. `grep -E "git diff --numstat( |$)[^o]" scripts/q1-t40-0{6,7,8,9}-acceptance.sh` returns zero matches (every `git diff --numstat` invocation is followed by an `origin/master...HEAD` or `master...HEAD` ref or a `--` separator preceded by the ref). Reviewer command: `grep -En "git diff --numstat" scripts/q1-t40-0{6,7,8,9}-acceptance.sh | grep -vE "master\.\.\.HEAD" | wc -l` returns `0`.

3. **AC-3 — generate-phase mktemp/trap parity is 32/32**. `node -e` script walks `forge-generate-phase-PH-01.json`, counts occurrences of `mktemp` and `trap ['\"]?rm -f` across all AC `command` strings, asserts `mktemp >= 1 && mktemp === trap`. Reviewer command (see Verification Procedure for the full node script). On master at plan time: `mktemp=32, trap=0` (fail). After fix: `mktemp=32, trap=32` (pass).

4. **AC-4 — per-AC mktemp/trap co-location**. Every `command` string in `forge-generate-phase-PH-01.json` that contains `mktemp` also contains a matching `trap` targeting the same variable. Reviewer runs the parity script which emits `MKTEMP-NO-TRAP @ <path>` for any offender; zero offenders required.

5. **AC-5 — acceptance wrapper green**. `bash scripts/q1-t62-63-acceptance.sh` exits 0. The wrapper runs AC-1 through AC-4 in order and halts on first failure.

6. **AC-6 — no drive-by edits**. `git diff --name-only origin/master...HEAD` returns only files matching the allowlist: `scripts/q1-t40-06-acceptance.sh`, `scripts/q1-t40-07-acceptance.sh`, `scripts/q1-t40-08-acceptance.sh`, `scripts/q1-t40-09-acceptance.sh`, `.ai-workspace/plans/forge-generate-phase-PH-01.json`, `.ai-workspace/plans/2026-04-17-q1-t62-63-acceptance-and-mktemp-polish.md`, `scripts/q1-t62-63-acceptance.sh`. Reviewer command: `MSYS_NO_PATHCONV=1 git diff --name-only origin/master...HEAD | grep -vE '^(scripts/q1-t40-0[6-9]-acceptance\.sh|\.ai-workspace/plans/forge-generate-phase-PH-01\.json|\.ai-workspace/plans/2026-04-17-q1-t62-63-acceptance-and-mktemp-polish\.md|scripts/q1-t62-63-acceptance\.sh)$' | wc -l` returns `0`.

## Out of scope

- Scripts `q1-t40-01-acceptance.sh`, `q1-t40-02-acceptance.sh`, `q1-t40-03-acceptance.sh`, `q1-t40-04-acceptance.sh`, `q1-t40-05-acceptance.sh` — do not touch. 02/03/04 already have the correct base-branch-scoped diff (PR #225); 01/05 use a different measurement shape.
- `.ai-workspace/plans/forge-coordinate-phase-PH-01.json` — already 34/34 trap coverage; do not touch.
- Any story/AC restructuring or renaming in the generate-phase JSON — only add `trap` lines, do not edit AC semantics or titles.
- Re-opening or re-closing issues #239 / #240 — post-merge follow-up, not this PR's concern.
- CHANGELOG / release bookkeeping — this is a content fix, not a release.
- Fixing any lint / test / build / pack failure that pre-existed on master.

## Verification procedure

The reviewer runs each AC command in order and halts on first failure. Each command is copy-pasteable from the Binary AC section. For AC-3 and AC-4, the full parity script is:

```bash
MSYS_NO_PATHCONV=1 node -e "
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('.ai-workspace/plans/forge-generate-phase-PH-01.json','utf8'));
let mk=0, tr=0, offenders=[];
const visit = (n,p='root') => {
  if (typeof n === 'string') {
    const m = (n.match(/mktemp/g)||[]).length;
    const t = (n.match(/trap ['\"]?rm -f/g)||[]).length;
    mk += m; tr += t;
    if (m > 0 && t === 0) offenders.push(p);
  } else if (Array.isArray(n)) n.forEach((v,i) => visit(v,p+'['+i+']'));
  else if (n && typeof n === 'object') for (const k of Object.keys(n)) visit(n[k],p+'.'+k);
};
visit(j);
console.log('mktemp='+mk+' trap='+tr+' offenders='+offenders.length);
if (mk < 1 || mk !== tr || offenders.length > 0) { console.error('FAIL', offenders); process.exit(1); }
"
```

After all 6 AC pass, reviewer returns PASS.

## Critical files

- `scripts/q1-t40-06-acceptance.sh` — audit-scope acceptance wrapper for story S0 / AC group; line 57 uses raw numstat on coord-phase JSON.
- `scripts/q1-t40-07-acceptance.sh` — per-AC numstat on a parameterised `$JSON` target; lines 35-36.
- `scripts/q1-t40-08-acceptance.sh` — single numstat on `$JSON`; line 22.
- `scripts/q1-t40-09-acceptance.sh` — numstat on the generate-phase JSON specifically; lines 20-21.
- `.ai-workspace/plans/forge-generate-phase-PH-01.json` — target for trap insertion; 32 mktemp AC commands need `trap 'rm -f "$TMP"' EXIT` inserted *after* `export TMP=$(mktemp)` and *before* the subsequent `&&`. Executor picks the exact line shape; the AC verifies co-location, not syntax.
- `scripts/q1-t62-63-acceptance.sh` — new wrapper the executor authors per the brief's hard-rule; runs all 6 AC in order.
- `.ai-workspace/plans/2026-04-17-q1-t62-63-acceptance-and-mktemp-polish.md` — this plan file.

## Checkpoint

- [x] Plan drafted — 2026-04-17
- [x] Baseline measured on master: scripts 06-09 have 0 `master...HEAD` matches; generate-phase JSON has 32 mktemp / 0 trap
- [ ] `/delegate` handoff to subagent
- [ ] Executor ack received (status --porcelain, HEAD sha, tool manifest check)
- [ ] Executor ships branch + wrapper green
- [ ] Stateless reviewer PASS on all 6 AC
- [ ] `/ship` merges PR
- [ ] Tasks #62 and #63 marked completed
- [ ] Post-merge: re-read generate-phase JSON from master to confirm 32/32 landed

Last updated: 2026-04-17
