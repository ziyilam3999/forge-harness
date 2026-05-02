# Resume Calibration Loop — Measure Current State, Decide Continue vs Exit

## ELI5

A while ago we paused a practice called the "calibration loop": running a critic over every plan file so the findings could tell us whether our plan-writer robot (`forge_plan`) is currently calibrated well. We paused it because the critic tool didn't exist yet. Today it does — plus the divergence measurement already came back showing 0 forward mismatches on the 22-story coordinate roadmap. So before we restart the loop, we need to actually look: does the robot still need the critic, or did we already win and the loop can be retired? The answer is either "keep going with a named cadence" or "document that we hit the goal and close the task."

## Context

**Stale premise corrected.** The `project_calibration_loop.md` memory and the task #66 description frame this as "paused because infrastructure is missing." That framing was accurate on 2026-04-07 but stale by 2026-04-18. Rule-#9 verification against current master confirms every unblocker shipped:

- `forge_evaluate` critic mode is live on master — `server/tools/evaluate.ts:57,64,153,676,700` (enum, MCP description, type union, dispatch, tagged-union RunRecord).
- `scripts/retroactive-critique-hook.sh` and `scripts/ac-lint-hook.sh` are both live in the tree.
- BUG-DIV-CWD shipped in PR #151 (merged 2026-04-12) — forward divergence measurement is no longer tool-broken.
- S7 divergence measurement shipped in PR #148 (merged 2026-04-11) — 0 real forward divergence on forge_coordinate PRD-vs-implementation (55 raw false negatives were BUG-DIV-CWD artefacts pre-fix; reverse session-emulated via `reverseFindings` schema per `feedback_mcp_determinism_is_output_schema.md`).
- forge_coordinate itself is complete at v0.20.0, 541 tests.

**What the original exit criterion was.** Per `project_calibration_loop.md`: "drop heavy critique once post-implementation divergence shows a healthy threshold below the 93-item (~35%) baseline." The 93-item baseline came from pre-three-tier-document-system measurement. S7 measured 0 forward divergence on forge_coordinate after the three-tier architecture was in place.

**What's genuinely open.** Two questions the project memory cannot answer from recall:

1. **Has `forge_plan` been critiqued *since* the three-tier architecture landed?** If not, 0 forward divergence on the coordinate work is a one-body result — not evidence that the planner is broadly calibrated. Running the critic across all *current* plan files in `.ai-workspace/plans/*.json` gives the measurement the exit criterion actually requires.
2. **If the critic finds nothing (or only cosmetic findings), is the loop done?** If it finds systematic planner-prompt deficiencies (class of D1/D2 fixes from 2026-04-02, but fresh), the loop is still doing real work and needs a named standing practice instead of ad-hoc invocation.

**Why this is not a build task.** No new primitives, no new tool surface, no new MCP modes. The infrastructure exists. The task is to **use** it once deliberately, record the result, and let the result decide the shape of any follow-on work.

**Why this is not the 2026-04-02 D1/D2 plan.** That plan shipped as v0.4.1 in PR #27 — it was a ~5-line patch to `server/lib/prompts/planner.ts` adding two rules (build prerequisite, evidence-format matching). The calibration loop referenced in task #66 is the broader practice of which the D1/D2 fixes were the first two data points.

## Goal

When this plan is done, these invariants hold:

1. A measurement artefact exists that records the current state of `forge_plan` calibration against every live plan file, classified by root cause.
2. A binary decision — continue the loop with a named cadence, or exit and document the criterion as met — is recorded in the artefact with rationale.
3. If continue: a follow-on plan exists naming the standing practice (cadence, routing, re-measurement).
4. If exit: the `project_calibration_loop.md` memory carries the exit state, date, and pointer to the measurement artefact.
5. TaskList #66 is marked `completed` with the outcome visible via TaskGet.

## Binary AC

AC are numbered and each resolves to a single observable check. "Observable from outside the diff" means a reviewer running the Verification commands against the committed tree determines pass/fail without reading the implementation.

- [ ] **AC-1 — Measurement artefact exists.**
  `test -f .ai-workspace/dogfood/2026-04-18-calibration-state.md` exits 0. File contains sections `## Context`, `## Critic Sweep`, `## Classification`, `## Decision`, `## Follow-on`.

- [ ] **AC-2 — Sweep covers every current plan.**
  The `## Critic Sweep` section contains a table with one row per file matching `.ai-workspace/plans/*.json` (current count determined at measurement time; must match `ls .ai-workspace/plans/*.json | wc -l`). Each row records the plan path and either a findings-count integer or the literal token `error: <reason>`. Scope is `.json` only — critic mode exercises `forge_plan`'s prompt, and `forge_plan` produces JSON plans; human-authored `.md` plans do not exercise the planner prompt and are deliberately out of this sweep's corpus.

- [ ] **AC-3 — Every finding classified.**
  Every individual finding in `## Classification` is written as a markdown bullet line of the literal form `- classification: <tag>` where `<tag>` is one of the fixed set `{plan-specific, planner-prompt-deficient, false-positive, out-of-scope-stale-plan}`. Bullet format (not table, not prose) is required so the regex check is mechanical. `grep -cE '^- classification: (plan-specific|planner-prompt-deficient|false-positive|out-of-scope-stale-plan)$' .ai-workspace/dogfood/2026-04-18-calibration-state.md` equals the total findings count declared in AC-2. Zero findings → AC-3 satisfies vacuously (explicitly noted in the artefact).

- [ ] **AC-4 — Decision recorded.**
  `grep -cE '^decision: (continue|exit)$' .ai-workspace/dogfood/2026-04-18-calibration-state.md` equals 1. The line is preceded by a rationale paragraph citing specific finding counts from AC-2/AC-3.

- [ ] **AC-5 — Continue path artefact (conditional).**
  When AC-4 resolves to `decision: continue`, `test -f .ai-workspace/plans/2026-04-18-calibration-continuation.md` exits 0, and the continuation plan names (a) which plan-file category gets critic'd at what cadence, (b) how findings route back to `server/lib/prompts/planner.ts` or equivalent, (c) the next re-measurement date. When AC-4 resolves to `decision: exit`, this AC is satisfied vacuously by the absence of the file (explicitly noted in the artefact under `## Follow-on`).

- [ ] **AC-6 — Exit path memory update (conditional).**
  When AC-4 resolves to `decision: exit`, the memory file at `~/.claude/projects/C--Users-ziyil-coding-projects-forge-harness/memory/project_calibration_loop.md` contains (a) the literal substring `exit-state: 2026-04-18` AND (b) the literal substring `.ai-workspace/dogfood/2026-04-18-calibration-state.md` (the pointer to the AC-1 artefact). When AC-4 resolves to `decision: continue`, this AC is satisfied vacuously with no memory update required — the AC-5 continuation plan is the source of truth for the continue path, and the memory need not be touched.

- [ ] **AC-7 — Task #66 closed.**
  `TaskGet 66` shows `status: completed`. The `description` (or a comment, if supported) names the decision recorded in AC-4 and the path to the AC-1 artefact.

## Out of scope

The executor must not touch any of the following. If satisfying an AC appears to require one of these, stop and flag per the stop-on-contradiction rule.

- Any file under `server/` (source code) — this is a measurement + decision exercise, not a build.
- Any file under `scripts/` — the hooks stay as-is.
- `.claude/settings.json` — hooks stay wired exactly as they are.
- Any test file — no new or modified tests.
- Any MCP tool surface (`forge_plan`, `forge_evaluate`, `forge_generate`, `forge_coordinate`) — use them, don't modify them.
- `MEMORY.md` index — the memory-file *body* update in AC-6 is in scope; the index line is already present and adequate.
- Any `/ship` or PR creation — the AC-1 artefact is added to git via a normal commit but this plan does not require a release.
- The 2026-04-02 D1/D2 calibration plan — that's shipped history, not this plan's surface.
- Running the critic in an indefinite loop — this is a single deliberate sweep, not a standing cron.

## Ordering constraints

- AC-1 → AC-2 → AC-3 → AC-4 (each depends on the prior's artefact content being written).
- AC-5 and AC-6 are mutually exclusive and both conditional on AC-4 (exactly one of the two carries the real work).
- AC-7 runs last (after whichever of AC-5/AC-6 applied completes).

## Verification procedure

A stateless reviewer runs these commands verbatim from the repo root and reports pass/fail per AC:

```bash
# AC-1
test -f .ai-workspace/dogfood/2026-04-18-calibration-state.md && \
  grep -cE '^## (Context|Critic Sweep|Classification|Decision|Follow-on)$' \
  .ai-workspace/dogfood/2026-04-18-calibration-state.md
# expects: 5

# AC-2
PLAN_COUNT=$(ls .ai-workspace/plans/*.json 2>/dev/null | wc -l)
# reviewer reads the Critic Sweep table and confirms row count == $PLAN_COUNT

# AC-3
# reviewer counts total findings declared in AC-2 rows, then:
grep -cE '^- classification: (plan-specific|planner-prompt-deficient|false-positive|out-of-scope-stale-plan)$' \
  .ai-workspace/dogfood/2026-04-18-calibration-state.md
# must equal the total findings count (or 0 if sweep returned zero findings, with the artefact explicitly noting "zero findings")

# AC-4
grep -cE '^decision: (continue|exit)$' .ai-workspace/dogfood/2026-04-18-calibration-state.md
# expects: 1

# AC-5 (conditional on AC-4 = continue)
test -f .ai-workspace/plans/2026-04-18-calibration-continuation.md && \
  grep -cE '^## (Cadence|Routing|Re-measurement)$' \
  .ai-workspace/plans/2026-04-18-calibration-continuation.md
# expects: 3 when continue, skipped when exit

# AC-6 (conditional on AC-4 = exit) — BOTH checks must pass
MEM=~/.claude/projects/C--Users-ziyil-coding-projects-forge-harness/memory/project_calibration_loop.md
grep -c 'exit-state: 2026-04-18' "$MEM"
# expects: >=1 when exit, skipped when continue
grep -c '.ai-workspace/dogfood/2026-04-18-calibration-state.md' "$MEM"
# expects: >=1 when exit, skipped when continue

# AC-7
# executor or planner runs TaskGet 66 and confirms status == completed
```

## Critical files

- `.ai-workspace/dogfood/2026-04-18-calibration-state.md` — NEW. The measurement artefact. Sections: Context, Critic Sweep (plan-by-plan findings table), Classification (per-finding tags with rationale), Decision (continue or exit + rationale), Follow-on (pointer to AC-5 artefact or AC-6 memory update). This is the load-bearing deliverable of the plan.
- `.ai-workspace/plans/2026-04-18-calibration-continuation.md` — CONDITIONAL NEW (only on `decision: continue`). The standing-practice plan. Sections: Cadence, Routing, Re-measurement.
- `~/.claude/projects/C--Users-ziyil-coding-projects-forge-harness/memory/project_calibration_loop.md` — CONDITIONAL UPDATE (only on `decision: exit`). Add exit-state line + rationale + artefact pointer. Memory body update, not frontmatter.
- `server/tools/evaluate.ts` — READ ONLY. The executor reads it to confirm the critic mode's output contract before running the sweep, and to determine the fallback shape if MCP auth fails (per `feedback_mcp_determinism_is_output_schema.md` — output schema is the contract, in-session emulation is legit fallback).
- `.ai-workspace/plans/*.json` — READ ONLY. Input corpus for the critic sweep.

## Not prescribing

These are explicitly the executor's call. The planner is naming the outcome, not the route:

- Whether to run the critic via MCP (`forge_evaluate` with `evaluationMode: "critic"`) or in-session emulation. Prefer MCP when OAuth works; fall back to in-session critic-prompt application against the same plan files when MCP returns 401. Either path satisfies AC-2 as long as the findings it records match the output schema.
- The exact JSON/markdown serialization of the Critic Sweep table — shape is a reviewer judgment call. The *required rows* (one per plan file) are the binding content.
- Classification rationale wording — tags are fixed; per-finding prose is the executor's call.
- How to route findings back to `planner.ts` in the AC-5 continuation plan — the plan names that routing must be documented; it does not prescribe prompt-rule wording or edit locations.
- Whether to commit the AC-1 artefact as one commit or several — executor's call.

## Tool manifest

Executor can assume the following are installed: `node`, `npm`, `git`, `grep`, `jq`, `bash`, `gh` (for issue/PR lookups if needed), the forge-harness MCP server (which provides `forge_evaluate`), and the Read/Write/Bash tools in the Claude Code harness. If a listed tool is missing, substitute an equivalent and note the substitution in the ack.

## Checkpoint

- [x] Planner: pre-compact card #3 locked the resume path
- [x] Planner: rule-#9 verification — confirmed critic mode, both hooks, BUG-DIV-CWD, and S7 are live on master
- [x] Planner: initial plan draft
- [x] Planner: `/coherent-plan` pass (2 MAJOR + 5 MINOR fixed in-place; below escalation threshold; outcome-shaped plan, so coherent-plan per `feedback_double_critique_scope`)
- [x] Planner: surface for user review
- [x] User: approve (2026-04-18 — approved outright after `/coherent-plan` pass)
- [x] Planner: `/delegate` to subagent with this plan as the brief source (subagent id `acd809869a9fb83af`, --via subagent per `feedback_delegate_subagent_default.md`)
- [x] Executor: ack with dirty-worktree pre-flight + tool availability check
- [x] Executor: AC-1 artefact (skeleton + Context section)
- [x] Executor: AC-2 critic sweep rows populated (12 rows = `ls .ai-workspace/plans/*.json | wc -l`; MCP critic returned all 15 globbed plans including 3 nested `f55-validation/*` excluded from the sweep table per AC-2 non-recursive scope)
- [x] Executor: AC-3 classifications tagged (232 bullet classifications matching 232 finding integers in AC-2 table)
- [x] Executor: AC-4 decision recorded with rationale (`decision: exit`; rationale cites 180/19/33/0 classification split + S7 convergence)
- [x] Executor: AC-5 XOR AC-6 path — **exit** (AC-6 memory update with `exit-state: 2026-04-18` + artefact pointer; AC-5 vacuously satisfied by absent continuation plan, explicitly noted in artefact's `## Follow-on`)
- [x] Executor: AC-7 flagged-not-closed (TaskUpdate tool unavailable in subagent schema — handed back to planner per "flag, don't guess" rule)
- [x] Planner: stateless reviewer on the branch (fresh subagent id `acc99f440f713a16e`, zero implementation context; verdict PASS 6/7 verifiable, AC-7 UNVERIFIED due to same TaskGet-tool-scope limitation the executor hit)
- [x] Planner: close AC-7 from planner session via TaskUpdate (task #66 → completed, 2026-04-18)
- [x] Planner: update this Checkpoint to reality on review

## Shipped reality (post-review)

- Branch `exec/resume-calibration-loop-2026-04-18` carries the plan (commit `5246668`) but the artefact files (`.ai-workspace/dogfood/2026-04-18-*.{md,json}`) are **NOT committed** — the executor correctly identified `.ai-workspace/dogfood/` as gitignored (`.gitignore:5` `.ai-workspace/*`, with negations only for `plans/` and `audits/`). Forcing them into git via `-f` would break the q05-q1-gitignore-design convention (dogfood is session-scoped). Decision substance is preserved durably in the memory file `~/.claude/projects/C--Users-ziyil-coding-projects-forge-harness/memory/project_calibration_loop.md` instead. This is a reality-update on the plan's Critical files implicit assumption that the artefact would land in master.
- AC-7 verification from subagents is impossible under the current Claude Code tool schema (neither executor nor reviewer subagent sessions surface `TaskGet`/`TaskUpdate`). This is a future-plan consideration: ACs that depend on internal harness tools must either be satisfied from the planner's main session OR drop the subagent-verification claim.
- Branch remains unmerged per the plan's "no /ship, no PR, no release" Out of scope rule. The branch is a durable record; the memory file is the durable decision. Future sessions searching for "task #66 outcome" land in the memory file, which inlines the classification summary.
- README.md had unrelated working-tree modifications when the executor started (a marketing/badges/mermaid-diagram edit, not staged anywhere). Executor excluded it from the branch commit; it remains unstaged on the working tree. Planner can `git checkout README.md` at discretion — not a calibration-loop concern.

Last updated: 2026-04-18T01:30+08:00 — post-review. Plan complete; task #66 closed; loop retired.
