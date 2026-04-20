# v0.33.0 PR E — Cumulative minor-version release (v0.32.14 → v0.33.0)

## Context

Fifth and final slice of the v0.33.0 polish bundle. PRs A1/A2/B/C/D shipped as patch releases v0.32.9 through v0.32.14; PR E promotes the cumulative work to a minor-version milestone (v0.33.0).

This is a **release-only** PR — no feature code, no behavior changes. Two deliverables:

1. **Version bump**: `package.json` 0.32.14 → 0.33.0.
2. **CHANGELOG consolidation + header fix**: prepend a consolidated v0.33.0 entry summarizing the polish bundle arc, AND fix issue #354 (CHANGELOG header monotonic-ordering bug).

### Why #354 is bundled (not deferred)

Issue #354 was filed during PR C's stateless review: the `# Changelog` H1 is buried at line 47 of CHANGELOG.md because `/ship` Stage 7 prepends every new version section to the file top, without special-casing an existing title block. v0.33.0 polish entries (v0.32.9–v0.32.14) landed above the H1; pre-polish entries (v0.32.8 and below) sit below it. Bundling #354 into PR E makes sense because:

- PR E is the natural place to add ONE more entry at the top — fixing the H1 ordering at the same time is zero additional risk.
- If deferred to v0.34.x, the bug would deepen (every new v0.34.x entry would prepend above a mis-placed H1, compounding the drift).
- Scope remains purely document-formatting — same class as the CHANGELOG-split in PR C.

The underlying `/ship` skill prepend-logic bug is out of scope for this repo — it's a skill-level fix candidate for the ai-brain `/ship` skill definition.

### Git log shape deviation carried forward from PR D

PR D tagged its merge commit (`c92aaf6`) directly as v0.32.14 without creating a separate `chore: release 0.32.14` commit — a deviation from PRs A1/A2/B/C which all have a post-merge chore commit. PR E will mirror PR D: the feature-branch commit `chore(release): v0.33.0 ...` becomes the merge commit, tagged v0.33.0 directly. One commit, one tag, one merge. Rationale: PR E's content IS the release — there's no feature to separate from the release-metadata, so a redundant post-merge chore commit has no signal value.

## Goal

Ship v0.33.0 as a clean minor-version milestone with a readable CHANGELOG that future readers can navigate without encountering a buried H1.

## Binary AC

1. **AC-E1** — `package.json` version is exactly `"0.33.0"`:
   ```bash
   node -e "console.log(require('./package.json').version)" | grep -cx '0.33.0' | awk '$1 == 1 { exit 0 } { exit 1 }'
   ```

2. **AC-E2** — `CHANGELOG.md` line 1 is the `# Changelog` H1 (not a version entry):
   ```bash
   awk 'NR==1 { if ($0 == "# Changelog") exit 0; else exit 1 }' CHANGELOG.md
   ```

3. **AC-E3** — `CHANGELOG.md` contains exactly ONE `# Changelog` H1 (no stray duplicates after prior move):
   ```bash
   grep -cE '^# Changelog$' CHANGELOG.md | awk '$1 == 1 { exit 0 } { exit 1 }'
   ```

4. **AC-E4** — First `## [X.Y.Z]` version header is `## [0.33.0]...`:
   ```bash
   grep -nE '^## \[' CHANGELOG.md | head -1 | grep -qE '^[0-9]+:## \[0\.33\.0\]'
   ```

5. **AC-E5** — Version header monotonic-descending (no version appears BEFORE a higher version in file order):
   ```bash
   grep -oE '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md | awk -F'[][]' '{print $2}' > tmp/pr-e-versions.txt && node -e "const fs=require('fs');const v=fs.readFileSync('tmp/pr-e-versions.txt','utf8').trim().split('\n');const cmp=(a,b)=>{const[a1,a2,a3]=a.split('.').map(Number);const[b1,b2,b3]=b.split('.').map(Number);return a1-b1||a2-b2||a3-b3;};for(let i=0;i<v.length-1;i++){if(cmp(v[i],v[i+1])<=0){console.error('non-monotonic at '+i+': '+v[i]+' before '+v[i+1]);process.exit(1);}}"
   ```

6. **AC-E6** — v0.33.0 CHANGELOG entry references issue #354 (proves bundle intent):
   ```bash
   awk '/^## \[0\.33\.0\]/,/^## \[0\.32\.14\]/' CHANGELOG.md | grep -q '#354'
   ```

7. **AC-E7** — All tests pass (no regressions) with count unchanged from master baseline of 776:
   ```bash
   mkdir -p tmp && MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/pr-e-vitest.json > /dev/null 2>&1; node -e "const r=require('./tmp/pr-e-vitest.json'); if (r.numFailedTests === 0 && r.numPassedTests >= 776) process.exit(0); else { console.error('tests: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed'); process.exit(1); }"
   ```

8. **AC-E8** — Changes confined to release-only surface (no code edits):
   ```bash
   git diff --name-only master...HEAD | grep -vE '^(CHANGELOG\.md|package\.json|\.ai-workspace/plans/2026-04-20-v0-33-0-pr-e-cumulative-release\.md|scripts/pr-e-acceptance\.sh)$' | wc -l | awk '$1 == 0 { exit 0 } { exit 1 }'
   ```

## Out of scope

1. Any changes to `server/**/*.ts` (no feature code).
2. Fixing the underlying `/ship` skill prepend-logic bug (candidate for ai-brain v0.34.x task).
3. Rewriting historical CHANGELOG entries (only the v0.33.0 prepend + H1 relocation).
4. Resolving any other v0.34.x polish items (#352/#353/#355 from PR C review; #347-#350 from PR B review; #357/#358/#359 from PR D review).
5. Renderer/dashboard work (monday's forge_status proposal is tracked under Task #111 for v0.34.x).
6. Issue-closure PRs for pre-v0.32.5 backlog (#271-#303 range).
7. The `# Changelog` H1 move is the ONLY structural change to existing lines — don't reformat or rewrap historical entries.

## Verification procedure

Reviewer runs `scripts/pr-e-acceptance.sh` from repo root against the feature branch. It executes AC-E1..E8 in order and exits 0 iff all pass. Print-on-pass: `ALL PR E ACCEPTANCE CHECKS PASSED`.

## Critical files

- `package.json` — version field. Bump 0.32.14 → 0.33.0.
- `CHANGELOG.md` — prepend v0.33.0 entry, move `# Changelog` H1 to top, drop stray intro lines at buried position.
- `scripts/pr-e-acceptance.sh` — new acceptance wrapper, runs AC-E1..E8.
- `.ai-workspace/plans/2026-04-20-v0-33-0-pr-e-cumulative-release.md` — this file, in-scope for AC-E8 allowlist.

## Checkpoint

- [x] Plan written, baseline state measured (current tag v0.32.14, CHANGELOG H1 at L47)
- [x] #354 bug confirmed via direct read of CHANGELOG.md
- [ ] Run `/coherent-plan` on this plan
- [ ] Create feature branch, implement edits
- [ ] Create `scripts/pr-e-acceptance.sh`
- [ ] Run wrapper locally — all 8 AC green
- [ ] `/ship` — Stage 5 stateless review + merge + tag v0.33.0

Last updated: 2026-04-20T10:55:00+00:00
