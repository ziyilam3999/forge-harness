# Q0.5 Follow-up Q1 — `.ai-workspace/` gitignore redesign

## Context

Task #20 (doc-hygiene sweep, shipped v0.30.2) surfaced that `.ai-workspace/` is fully gitignored at the repo root. 4 plan files had to be force-added with `git add -f` so reviewers could see them in the PR diff. That friction will repeat on every future doc-hygiene or planning PR until the gitignore is redesigned.

The investigation during task #20 produced one load-bearing finding: **`package.json` has no `files:` whitelist and no `.npmignore`, so `npm publish` currently falls back to `.gitignore` to decide what ships.** That's why `.ai-workspace/` is gitignored in the first place — it's doing double duty as both "hide dev noise from git" and "keep dev noise out of the npm tarball." `npm pack --dry-run` was run during task #20 and confirmed zero `.ai-workspace/` entries currently publish.

The user's original framing was "git-track now, re-ignore before v1.0 release." That framing conflates two concerns (git visibility vs npm publish scope). Decoupling them is the real fix.

## Goal

1. Plans and audits under `.ai-workspace/` are visible to reviewers via normal `git diff` / PR review, without needing `git add -f`.
2. Transient dev noise (dogfood runs, session state, reports, lessons, lint-audit artifacts) stays out of git.
3. `npm publish` scope is explicitly pinned and does NOT depend on `.gitignore` state. Zero `.ai-workspace/` entries in the published tarball, both before and after this change.
4. The change survives a fresh clone — someone who `git clone`s the repo sees the same plan/audit files a reviewer sees on GitHub.

## Binary acceptance criteria

Executor is done when ALL of these hold. Each is checkable with a single command.

- [ ] AC-1 — **npm publish scope is explicit.** `node -e "console.log(!!require('./package.json').files)"` prints `true`.
- [ ] AC-2 — **No regression in published scope.** `npm pack --dry-run 2>&1 | grep -c '\.ai-workspace'` returns `0`.
- [ ] AC-3 — **Published scope still contains the runtime.** `npm pack --dry-run 2>&1 | grep -c 'dist/'` returns a value `≥ 1`, and same for `server/`, `scripts/`, `schema/`.
- [ ] AC-4 — **Plans directory is tracked.** `git ls-files .ai-workspace/plans/ | wc -l` returns a value `≥ 20` (baseline before task #20 was 33 force-added; any healthy number ≥ 20 is fine).
- [ ] AC-5 — **Audits directory is tracked.** `git ls-files .ai-workspace/audits/ | wc -l` returns a value `≥ 5`.
- [ ] AC-6 — **Dogfood directory stays ignored.** `git check-ignore -q .ai-workspace/dogfood/anything.json` exits `0` (meaning: ignored).
- [ ] AC-7 — **Sessions directory stays ignored.** `git check-ignore -q .ai-workspace/sessions/anything` exits `0`.
- [ ] AC-8 — **New plan files auto-track.** Create `.ai-workspace/plans/test-ac8.md`, run `git status --porcelain .ai-workspace/plans/test-ac8.md`, see the file listed as untracked (i.e., NOT ignored). Clean up the test file before commit.
- [ ] AC-9 — **New dogfood files stay ignored.** Create `.ai-workspace/dogfood/test-ac9.json`, run `git status --porcelain .ai-workspace/dogfood/test-ac9.json`, see empty output. Clean up before commit.
- [ ] AC-10 — **Tests still green.** `npm test` exits `0`.
- [ ] AC-11 — **Lint still green.** `npm run lint` exits `0`.
- [ ] AC-12 — **Build still green.** `npm run build` exits `0`.
- [ ] AC-13 — **CI green on the PR.** All required checks on the PR pass before merge.

## Out of scope

Things the executor should NOT do as part of this PR:

- Do not touch any source file under `server/`, `scripts/`, `schema/`, or `dist/`.
- Do not rename, move, or delete any existing plan/audit file.
- Do not bundle the F56→F55 rule rename (Q3 follow-up) — that's a separate PR.
- Do not retroactively un-ignore `dogfood/`, `sessions/`, `reports/`, `lessons/`, or `lint-audit/`. Keep them hidden.
- Do not add git history rewrites or force-pushes.

## Ordering constraint (the only "how" the planner prescribes)

**AC-1 (explicit npm scope) must land in the same PR as, or before, the gitignore relaxation.** Rationale: the moment `.gitignore` no longer excludes `.ai-workspace/`, npm publish would start picking up plan files unless the `files:` whitelist is already in place. One PR with two commits is fine; splitting into two PRs is also fine as long as the `files:` whitelist lands first. The executor chooses which shape.

## Verification procedure (what review will run)

On the PR branch, reviewer runs:

```
npm ci && npm run build && npm test && npm run lint
npm pack --dry-run 2>&1 | tee /tmp/pack.txt
grep -c 'ai-workspace' /tmp/pack.txt        # must print 0
grep -c 'dist/' /tmp/pack.txt               # must print ≥ 1
git ls-files .ai-workspace/plans/ | wc -l   # must print ≥ 20
git ls-files .ai-workspace/audits/ | wc -l  # must print ≥ 5
git check-ignore -q .ai-workspace/dogfood/foo.json && echo IGNORED
```

Then a fresh-clone test:

```
cd /tmp && git clone <repo> fresh && cd fresh
git ls-files .ai-workspace/plans/ | wc -l   # must match PR branch
```

## Critical files (executor chooses edits, planner only names them)

- `package.json` — must end with a `files:` whitelist field.
- `.gitignore` — current line 5 (`.ai-workspace/`) must be replaced with something more targeted.

The executor chooses the exact shape of the whitelist and the exact ignore patterns. A reasonable starting point is a whitelist of `["dist/", "server/", "scripts/", "schema/", "package.json", "README.md", "CHANGELOG.md"]` and a subdir-level ignore of `dogfood/`, `sessions/`, `reports/`, `lessons/`, `lint-audit/` under `.ai-workspace/`. If the executor finds a cleaner pattern while working, that's fine — the AC are the contract.

## Checkpoint

- [x] Plan drafted (planner)
- [ ] Brief delivered to lucky-iris
- [ ] Executor acks and starts
- [ ] AC-1..AC-12 pass locally on executor's branch
- [ ] PR opened with `plan-refresh: no-op` (or fresh signal)
- [ ] AC-13 passes (CI green)
- [ ] Stateless review PASS
- [ ] Merged + released
- [ ] Plan updated to reflect shipped reality (planner, post-merge)

Last updated: 2026-04-14T22:40:00+08:00 — drafted after v0.30.2 ship, pending delivery to lucky-iris.
