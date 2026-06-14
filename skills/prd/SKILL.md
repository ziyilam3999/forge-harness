---
name: prd
description: |
  Interactive PRD creation with product diagnostic. Guides users through a structured
  interview that challenges premises, validates demand, and produces a pipeline-ready PRD
  following the forge-harness PRD document structure.
  Use when asked to "create a PRD", "write a PRD", "I have an idea", "help me define
  requirements", "what should I build", or "/prd".
  Proactively suggest when the user describes a new product idea or feature before any
  code is written — product-level rethinking should happen before a line of code.
---

# PRD Creation Skill

Create structured PRDs for the forge-harness pipeline through a guided product diagnostic and requirements interview. Challenges whether you're building the right thing before structuring requirements.

The PRD this skill produces is the **vision doc** that `forge_plan` transforms into an execution plan — `/prd` is the front door, `forge_plan` is the next step.

**You ASSIST, you do not REPLACE the human's judgment.** The human decides WHAT to build and WHY. You push them to think harder about both.

## Session Resume

Check if `.ai-workspace/prd-draft.md` exists. If found, ask: "Found an in-progress PRD draft. Resume or start fresh?" Best-effort — skip if user intent is clear.

## Phase Flow

```
1. DISCOVER  ->  2. DRAFT  ->  3. VALIDATE  ->  4. REFINE  ->  5. EXPORT
```

## Phase 1: DISCOVER

Five steps, run sequentially.

**1A. Context Gathering**
1. Read the project codebase to understand what exists
2. Read optional project-context files if present — e.g. a repo `README.md`, a `.forge/` config directory, or any project memory / constitution / principles doc the repo happens to carry. These reads are **best-effort**: if a file is absent, skip it silently and continue (a fresh public project may have none). Never error on a missing file.
3. If greenfield, note that and skip codebase reading

**1B. Product Diagnostic**
Challenge whether the right thing is being built using four forcing questions (Q1-Q4), plus a conditional Q5 for UI/visual features. Between Q3 and Q4, an infrastructure prerequisite scan checks whether the feature needs plumbing (event emitters, auth, WebSocket, etc.) that doesn't exist in the codebase -- advisory only, surfaces gaps to inform Q4's wedge choice. See `references/product-diagnostic.md` for the full question set, infra scan table, smart routing, response posture, and escape hatch.

**Q4 must explicitly challenge infrastructure gaps surfaced by the prereq scan.** When the scan flags missing plumbing (auth, event emitters, persistence, etc.), Q4's "narrowest wedge" answer must address the gap directly rather than route around it. Empirically: when Q4 doesn't reference the scan's gap output, expansion options collapse to UI-layer-only and the diagnostic loses its forcing function. If the scan returns gaps, restate them in Q4's prompt verbatim before asking for the wedge.

**Expansion options must span at least two layers.** A SELECTIVE EXPAND or EXPAND that produces only UI-layer additions is a quality smell — the diagnostic flagged gaps for a reason. Each expansion REQ should name its layer (UI / data / control / infra). If all expansion REQs land on UI, the diagnostic's infra scan was ignored. Re-prompt for at least one non-UI expansion before proceeding to 1C Premise Challenge.

**1C. Premise Challenge**
Synthesize diagnostic answers into premises. Get explicit agree/disagree. See `references/premise-challenge.md`.

**1D. Scope Mode Selection**
Ask user to pick: EXPAND, SELECTIVE EXPAND (default), HOLD, or REDUCE. See `references/scope-modes.md` for mode definitions and requirements-interview behavior per mode.

**1E. Requirements Interview**
Collect requirements informed by diagnostic and scope mode:
1. Key capabilities -> REQ-01, REQ-02, etc.
2. Out of Scope (informed by Narrowest Wedge)
3. Success criteria (binary pass/fail only)
4. Concrete input/output examples per key requirement

If user gives terse answers, prompt with examples from similar PRDs or codebase context.

## Phase 2: DRAFT

Assemble answers into the 10-section PRD structure defined in `references/document-template.md` (self-contained — it carries the canonical section list, the diagnostic-answer-to-section mapping, and the drafting rules; no external document is required).

Save draft to `.ai-workspace/prd-draft.md`. Present to human.

## Phase 3: VALIDATE

Run advisory quality checks on the draft. See `references/quality-checklist.md` for the full check table and compliance notes.

All severities are advisory. The human is the real quality gate. Present results as a summary table.

## Phase 4: REFINE

Iterate on human feedback. Re-run quality checklist after changes. Continue until satisfied.

## Phase 5: EXPORT

1. Write final PRD to user-specified path (default: `PRD.md`)
2. Delete `.ai-workspace/prd-draft.md`
3. Hand off to `forge_plan` (see "Handoff to forge_plan" below) — the exported PRD is the vision doc `forge_plan` turns into an execution plan.

If write fails, report error and ask for alternative path.

### Handoff to forge_plan

The exported PRD is the input `forge_plan` was built to consume. Print this handoff to the user.

**Lead with the master tier — decompose the PRD into phases (the richer forge flow):**

```
forge_plan({ documentTier: "master", visionDoc: <the exported PRD's contents> })
```

**Or, for a single standalone plan (simpler — one focused plan, no phase decomposition):**

```
forge_plan({ intent: <the exported PRD's contents> })
```

Pick `documentTier: "master"` when the PRD spans multiple phases of work; pick `intent` when it's one focused slice. Either way, pass the **contents** of the exported PRD as the string value.

## Rules

- The human decides WHAT and WHY -- you challenge both but defer to their judgment
- Every REQ needs an ID (REQ-NN) and binary acceptance criteria
- Out of Scope must be explicit with rationale
- No HOW sections -- architecture belongs in the execution plan / SPEC
- Be direct, not sycophantic -- take positions, challenge weak answers
- The product diagnostic is not optional

## Run Data Recording

<!-- skill version: 1.0.1 (2026-04-15) — outcome enum expanded + issues field added -->

After Phase 5 (EXPORT) completes — or if the user abandons early — persist run data. This section always runs.

**Resolve the skill base directory** from the skill's own install directory (where this `SKILL.md` lives), not the current working directory.

### What to record

Append to `runs/data.json` (create with `{"skill":"prd","lastRun":null,"totalRuns":0,"runs":[]}` if missing):

```json
{
  "timestamp": "{ISO-8601}",
  "outcome": "exported-clean|exported-with-warnings|exported-verify-failed|abandoned|resumed",
  "project": "{current project directory name}",
  "prdTopic": "{one-line topic from Q1/user description}",
  "routing": "new-product|enhancement|internal-tooling",
  "questionsAsked": ["Q1","Q2","Q3","Q4","Q5"],
  "infraScanRan": true,
  "infraGapsFound": "{N or 0}",
  "scopeMode": "EXPAND|SELECTIVE_EXPAND|HOLD|REDUCE",
  "requirementCount": "{N REQs in final PRD}",
  "qualityChecks": {"fail": 0, "warn": 0, "info": 0},
  "refinementRounds": "{N iterations in Phase 4}",
  "outputPath": "{path to exported PRD or null}",
  "issues": [
    {"stage": "verify", "type": "false-negative", "description": "parser rejected a valid story assertion on story 3/4"}
  ],
  "summary": "{one-line: e.g., 'Pipeline Observability Dashboard, 7 REQs, SELECTIVE EXPAND, exported to PRD.md'}"
}
```

**Outcome value semantics (v1.0.1 2026-04-15):**
- `exported-clean` — PRD generated AND all Phase 4 verification passed without warnings or failures
- `exported-with-warnings` — PRD generated; verification produced warnings (e.g., scope warnings, non-blocking quality checks)
- `exported-verify-failed` — PRD generated AND exported, but verification failed outright (e.g., story-level assertions failed, parser false-negatives not resolvable). The PRD is still shipped because the generation succeeded — verification failure is a separate signal tracked in `issues: []`.
- `abandoned` — user exited before Phase 5 (EXPORT)
- `resumed` — continuation of a prior session; the new run picked up mid-flow

Prior to v1.0.1 the outcome enum was just `exported|abandoned|resumed`, which conflated clean runs with verify-failed runs and prevented quality-trend tracking. Readers of pre-v1.0.1 data should treat `exported` as equivalent to `exported-with-warnings` (the safe fallback) unless the summary explicitly says "all passed."

**Issues field (v1.0.1 2026-04-15):** each entry conforms to the cross-skill convention `{stage, type, description}` — e.g. `{"stage": "verify", "type": "false-negative", "description": "..."}`. This is the field skill-improvement tooling mines to find recurring quality issues. Historical runs (pre-v1.0.1) did not populate this field; treat missing `issues` as `null`, not an error.

Keep last 50 runs (older runs are permanently discarded). Set `lastRun` and increment `totalRuns`.

Append one line to `runs/run.log` (keep last 100 lines):
```
{timestamp} | {outcome} | {prdTopic} | {requirementCount} REQs | {scopeMode} | {summary}
```

Do not fail the skill if recording fails — log a warning and continue.

## Attribution

Product diagnostic adapted from [Garry Tan's gstack](https://github.com/garrytan/gstack).
