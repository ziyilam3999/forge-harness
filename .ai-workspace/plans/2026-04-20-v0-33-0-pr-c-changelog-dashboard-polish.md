---
task: v0.33.0 PR C — CHANGELOG + dashboard polish
issues: [328, 331]
branch: chore/v0.33.0-pr-c-changelog-dashboard-polish
base: master
author: forge-plan
created: 2026-04-20
---

# v0.33.0 PR C — CHANGELOG + dashboard polish

## Context

Third of five PRs in the v0.33.0 polish bundle. Prior slices shipped cleanly:
- PR A1 → v0.32.9 (setup-config, 5 issues)
- PR A2 → v0.32.10 (acceptance wrapper, 3+1 issues)
- PR B → v0.32.12 (anthropic + plan, 6 issues)

This slice retires two low-risk polish issues on two independent surfaces:

- **#328 (CHANGELOG)** — the v0.32.8 entry is one dense sentence block (measured 1315 chars on the longest line as of master `fd05e1b`); ship-review E4 flagged it as unreadable in release-note viewers (compare viewers wrap at ~80-120 chars). Split into 2–3 structured paragraphs (problem / fix / arc-closure) for readability. Pure textual edit on a single file.
- **#331 (dashboard liveness banner)** — when `.forge/activity.json` has `{ "tool": null }` (post-bootstrap idle, or between `forge_coordinate` invocations), the liveness banner's time-based classifier flips red after 120s and says **"No update for 2+ min — may be hung"**. Correct alarming for mid-execution stuck cases; misleading for the idle case. Reported by monday-bot operator during post-v0.32.8 verification. Surface: `server/lib/dashboard-renderer.ts` (`updateBanner` client-side IIFE).

### Relevance to concurrent feature request

Monday's 2026-04-20T07:45 mail (thread `forge-harness-monday-bot-support`) asked for three dashboard states to become more visible: `in progress`, `retry`, `blocked`. **Research shows all three columns already exist and route correctly** (`server/lib/dashboard-renderer.ts:64-87, 260-268`):

| Monday's ask | Current state |
|---|---|
| `in-progress` column | Exists. `activeStoryId = activity?.storyId` routes any matching story into `COLUMN_IDS.inProgress` regardless of underlying `StoryStatus`. Gap on monday-bot's side: if implementation runs *outside* `forge_generate` (direct Claude edits), `activity.json` isn't populated → column stays empty. That's a telemetry-contract question, not a renderer bug. |
| `retry` column | Exists. `ready-for-retry` → `COLUMN_IDS.retry` via `statusToColumn` (line 82). |
| `blocked` column | Exists. Both `failed` and `dep-failed` route to `COLUMN_IDS.blocked` (lines 84-85). |

Therefore **monday's three asks are out-of-scope for PR C** — the columns are shipped and working; her observation was from a dashboard rendered in an idle state where no implementation activity was happening, so in-progress legitimately had nothing. The *separate* "stale-ready threshold" micro-feature (show yellow badge on Ready stories after N hours idle) is a genuine new feature, deferrable to v0.34.x.

A reply to monday inlining this explanation is included in the Checkpoint below.

## Goal

When PR C merges:
1. CHANGELOG.md's v0.32.8 section is a readable structured entry (≤400 chars per line), with the same semantic content preserved.
2. The dashboard's liveness banner shows **"Idle — no tool running"** (neutral styling) when `activity.tool === null` and elapsed > 120s, instead of the false-alarm **"No update for 2+ min — may be hung"** red banner.
3. The existing mid-execution red-alarm path (`activity.tool` set + stale) is unchanged — this is the legitimate "stuck tool" case and must keep its red "may be hung" copy.
4. Test count grows by ≥1 (new idle-banner branch coverage).
5. Zero drive-by edits — diff stays inside the 6-file allowlist.

## Binary AC

Every AC's `Check` line is a command executable against the feature branch whose pass/fail is visible without reading the diff. Where a command needs `<rev>:<path>` syntax on Windows MSYS bash, prefix with `MSYS_NO_PATHCONV=1`.

### AC-C1 — CHANGELOG v0.32.8 section has no line longer than 400 characters

Issue: #328 — split dense paragraph.

**Check:**
```bash
node -e "const s=require('fs').readFileSync('CHANGELOG.md','utf8');const m=s.match(/## \[0\.32\.8\][\s\S]*?(?=\n## \[)/);if(!m){console.error('v0.32.8 section not found');process.exit(2)}const lines=m[0].split('\n');const maxLen=Math.max(...lines.map(l=>l.length));process.exit(maxLen<=400?0:1)"
```

**Baseline on master:** FAIL (max line length 1315 chars in the single-paragraph entry, measured against master `fd05e1b`).

**Reviewer command:** same as Check.

### AC-C2 — CHANGELOG v0.32.8 section preserves the load-bearing technical terms

Issue: #328 — ensure content is preserved, not truncated.

The split must keep: `messages.stream`, `finalMessage`, `DEFAULT_MAX_TOKENS`, `LLMOutputTruncatedError`, `stop_reason`, and the `closes #325` trailer.

**Check:**
```bash
node -e "const s=require('fs').readFileSync('CHANGELOG.md','utf8');const m=s.match(/## \[0\.32\.8\][\s\S]*?(?=\n## \[)/);if(!m){process.exit(2)}const sec=m[0];const terms=['messages.stream','finalMessage','DEFAULT_MAX_TOKENS','LLMOutputTruncatedError','stop_reason','closes #325'];const missing=terms.filter(t=>!sec.includes(t));if(missing.length){console.error('missing terms:',missing);process.exit(1)}process.exit(0)"
```

**Baseline on master:** PASS (all terms present in current single-paragraph form).

**Reviewer command:** same as Check.

### AC-C3 — `updateBanner` client-side script receives a `TOOL_RUNNING` signal

Issue: #331 — serialize `activity.tool`-derived boolean into the browser script block alongside `LAST_UPDATE` / `ACTIVITY_STARTED`.

**Check:**
```bash
MSYS_NO_PATHCONV=1 grep -cE '(var|let|const)\s+TOOL_RUNNING\s*=' server/lib/dashboard-renderer.ts
```
Expected output: `1` (single declaration inside the serialized `<script>` block; keyword choice `var`/`let`/`const` is the executor's — `var` matches existing file style).

**Baseline on master:** FAIL (returns `0` — variable does not exist).

**Reviewer command:** same as Check.

### AC-C4 — Idle-banner text is emitted when `TOOL_RUNNING === false` and elapsed > 120s

Issue: #331 — add the "Idle — no tool running" branch.

**Check:**
```bash
MSYS_NO_PATHCONV=1 grep -cE 'Idle[^"]*no tool running' server/lib/dashboard-renderer.ts
```
Expected output: `≥ 1`. The `[^"]*` class accepts an em-dash, ASCII hyphen, or any non-quote separator — copy is up to the executor.

**Baseline on master:** FAIL (returns `0`).

**Reviewer command:** same as Check.

### AC-C5 — Existing "may be hung" red alarm copy preserved for the `TOOL_RUNNING === true` case

Issue: #331 — do not regress the legitimate stuck-tool alarm.

**Check:**
```bash
MSYS_NO_PATHCONV=1 grep -cE 'may be hung' server/lib/dashboard-renderer.ts
```
Expected output: `1` (the existing string is still present for the `TOOL_RUNNING === true && level === red` branch).

**Baseline on master:** PASS (returns `1`).

**Reviewer command:** same as Check.

### AC-C6 — Idle-banner behavior has dedicated unit coverage

Issue: #331 — add a regression test so the idle branch cannot silently regress.

The new test must render `renderDashboardHtml` with an `Activity` whose `tool === null` (or with `activity === null`) and a stale `lastUpdate`, then assert the emitted script block contains the idle-banner branch and that `updateBanner` would emit "Idle — no tool running" for that input. Test-library choice (string-match on HTML output vs. JSDOM vs. direct function extraction) is the executor's decision.

**Check (structural existence):**
```bash
node -e "const s=require('fs').readFileSync('server/lib/dashboard-renderer.test.ts','utf8');const has=/idle[\s\S]*no tool running|TOOL_RUNNING[\s\S]*false/i.test(s);process.exit(has?0:1)"
```

**Baseline on master:** FAIL (returns `1` — no such test exists).

**Reviewer command:** same as Check.

### AC-C7 — Full test suite passes, zero new failures vs. master

**Check:**
```bash
mkdir -p tmp && npx vitest run --reporter=json --outputFile=tmp/pr-c-vitest.json server/ 2>&1 | tail -5
node -e "const r=JSON.parse(require('fs').readFileSync('tmp/pr-c-vitest.json','utf8'));console.log('failed:',r.numFailedTests,'skipped:',r.numPendingTests,'passed:',r.numPassedTests);process.exit(r.numFailedTests===0?0:1)"
```

**Baseline on master:** PASS (0 failed after v0.32.12, 772 passed / 4 skipped).

**Reviewer command:** same as Check.

### AC-C8 — Test count grows by ≥ 1 (idle-banner coverage added)

**Check (delta, not absolute):**
```bash
BEFORE=$(MSYS_NO_PATHCONV=1 git show origin/master:server/lib/dashboard-renderer.test.ts | grep -cE '^\s*it\(')
AFTER=$(grep -cE '^\s*it\(' server/lib/dashboard-renderer.test.ts)
test "$AFTER" -gt "$BEFORE"
```

**Baseline on master:** N/A (delta check, master = master yields 0 delta).

**Reviewer command:** same as Check.

### AC-C9 — No drive-by edits — diff allowlist enforced

All files modified/added by this PR must be in the allowlist:
- `CHANGELOG.md`
- `server/lib/dashboard-renderer.ts`
- `server/lib/dashboard-renderer.test.ts`
- `.ai-workspace/plans/2026-04-20-v0-33-0-pr-c-changelog-dashboard-polish.md` (this file)
- `scripts/pr-c-acceptance.sh`
- `package.json` (version bump — optional; only if the executor chose to touch it)

**Check:**
```bash
git fetch origin master 2>/dev/null
node -e "const{execSync}=require('child_process');const out=execSync('git diff --name-only origin/master...HEAD',{encoding:'utf8'});const allow=new Set(['CHANGELOG.md','server/lib/dashboard-renderer.ts','server/lib/dashboard-renderer.test.ts','.ai-workspace/plans/2026-04-20-v0-33-0-pr-c-changelog-dashboard-polish.md','scripts/pr-c-acceptance.sh','package.json']);const files=out.trim().split('\n').filter(Boolean);const bad=files.filter(f=>!allow.has(f));if(bad.length){console.error('out-of-scope files:',bad);process.exit(1)}console.log('allowlist OK:',files.length,'files');process.exit(0)"
```

**Reviewer command:** same as Check.

### AC-C10 — The ship-mandated acceptance wrapper exists and exits 0

Per CLAUDE.md's Brief structure, the executor must produce `scripts/pr-c-acceptance.sh` that runs AC-C1 through AC-C9 in order and exits 0 iff all pass.

**Check:**
```bash
test -x scripts/pr-c-acceptance.sh && bash scripts/pr-c-acceptance.sh
```

**Baseline on master:** FAIL (file does not exist).

**Reviewer command:** same as Check.

## Out of scope

Explicitly **must NOT** be touched by this PR:

1. Monday's three Kanban-column asks (in-progress / retry / blocked) — the columns already exist and route correctly. Gap is telemetry-contract (does the implementer write `activity.json`?), not renderer. Reply to monday handles this.
2. The `stale-ready` threshold feature (yellow badge on Ready stories idle >N hours) — genuine new feature, not polish. Defer to v0.34.x triage.
3. The staleness thresholds (`60_000` / `120_000` ms in `classifyStaleness`). Do not re-tune.
4. CSS for `liveness-banner.neutral` (or whatever class name the executor chooses for idle) — if introducing a new class, inline minimal CSS in the same edit; but do not restyle the other banner states.
5. Dashboard HTML beyond the `<script>` IIFE change and the new idle-banner copy.
6. Other CHANGELOG entries (v0.32.5 through v0.32.7 are equally dense). Note: issue #328's body explicitly says its style polish "applies to older dense entries too" — but this slice limits scope to v0.32.8 as a **planner bundle-budget decision**, not an issue-body constraint. If the executor finishes v0.32.8 with time/context to spare, they MUST NOT expand into other entries in the same PR — file a separate follow-up instead.
7. All other `server/lib/*.ts` files, `server/tools/*.ts`, `server/types/*.ts`.
8. Any `.github/workflows/*.yml` — CI config is not touched.
9. `.forge/*` runtime outputs.
10. `scripts/*` besides the new `scripts/pr-c-acceptance.sh`.

If satisfying any AC would require touching an out-of-scope file, **stop and send a `priority: blocker` mail to forge-plan** with `reply_sla_seconds: 600` and `auto_schedule_wakeup: true`. Do not push through.

## Verification procedure

Reviewer runs these in order on the feature branch:

1. `git fetch origin master`
2. Run each AC-C1 through AC-C10 check command verbatim; collect pass/fail.
3. If all pass → PASS verdict → `/ship` self-review spawns. If any fail → BLOCK verdict with the failing AC numbers and failure reasons.
4. Spot-read the CHANGELOG v0.32.8 section to confirm readability (human judgment, not blocking).
5. Spot-read the `updateBanner` IIFE in `dashboard-renderer.ts` to confirm no logic regression on the red/amber/green thresholds.

## Critical files

| File | Role |
|---|---|
| `CHANGELOG.md` | v0.32.8 entry at line 27-31 — subject of AC-C1/C2. Textual edit. |
| `server/lib/dashboard-renderer.ts` | `renderDashboardHtml` function (lines 415-466) — serializes the `<script>` IIFE. Target of AC-C3/C4/C5. Also `classifyStaleness` (lines 55-59) read-only reference for the executor (do not modify thresholds). |
| `server/lib/dashboard-renderer.test.ts` | Existing test file — extend with new idle-banner test per AC-C6. |
| `.ai-workspace/plans/2026-04-20-v0-33-0-pr-c-changelog-dashboard-polish.md` | This plan file. |
| `scripts/pr-c-acceptance.sh` | New acceptance wrapper (AC-C10). Executor-owned implementation. |

## Checkpoint

- [x] Plan drafted (this file)
- [x] `/coherent-plan` critique run (0 critical / 1 major / 4 minor; all 5 fixed in-place; below escalation threshold)
- [x] Plan refined per critique findings (size numbers corrected to measured 1315, AC-C3 regex widened, AC-C4 regex simplified, AC-C7 command trimmed, Out-of-scope #6 attribution clarified)
- [ ] `/delegate --via subagent` on this plan path
- [ ] Executor ack received (HEAD SHA + dirty-worktree report + tool manifest check)
- [ ] Executor ships branch with acceptance wrapper green
- [ ] Planner-side `/delegate gate` sanity check
- [ ] `/ship plan-refresh: no-op` on the feature branch
- [ ] Stateless review PASS
- [ ] Merge + v0.32.13 release
- [ ] Close #328 and #331 via `fixes` trailer
- [ ] Reply to monday on thread `forge-harness-monday-bot-support` with scope decision (columns already shipped; fold #331 landed; in-progress telemetry is a contract question; filing stale-ready threshold as a separate v0.34.x candidate if she confirms interest)
- [ ] Update working-memory card for PR C ship
- [ ] Mark task #108 completed, advance to task #109 (PR D — evaluate.ts audit-only)

Last updated: 2026-04-20 — plan drafted + /coherent-plan pass complete (0C/1M/4m, all fixed). Ready for `/delegate --via subagent`.
