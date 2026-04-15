---
title: CLAUDE.md compaction — slate (B) recommended
date: 2026-04-16
status: draft — awaiting /coherent-plan critique
owner: lucky-iris (planner + executor, single session)
---

## ELI5
Our global CLAUDE.md file is like a closet where every safety rule ever written lives forever. Over time, the same rule got re-written in three different places — once in the short "Working Principles" list, once in the "Task Management" list, and once in the big "Planner / Executor Workflow" section at the bottom. The big section at the bottom is the newest and most detailed. So we're going to **throw away the weaker duplicate copies** of rules that already live in stronger form at the bottom. No rule disappears from the file — we just stop saying the same thing three times.

The file is 275 lines. After the cleanup it should be about 213 lines. That's 62 fewer lines for the model to reconcile every time the file loads, which means fewer chances for the model to get confused about which version of a rule to follow.

Think of it like weeding a garden: we're pulling duplicates so the real rules can breathe.

## Context
**Why this change, why now.**

CLAUDE.md at `C:\Users\ziyil\coding_projects\CLAUDE.md` is a symlink to `ai-brain/parent-claude.md`. It loads into every Claude Code session globally. At 275 lines it has grown by accretion — every incident added a rule, but old rules rarely got pruned when a later section absorbed them.

The "Planner / Executor Workflow" block (lines 114–180, ~67 lines) is explicitly the "consolidated learnings" section (see provenance note at line 179–180, dated 2026-04-14). Sections written earlier — `## Task Management`, `## Working Principles #1/#7/#8`, parts of `## Plan-First Workflow` — are weaker paraphrases of rules that the later section now authoritatively owns. Keeping the duplicates imposes two costs:

1. **Attention tax.** The model spends tokens reconciling near-duplicate rules instead of executing them.
2. **Contradiction risk.** One live contradiction already exists: `## Plan-First Workflow` prescribes a section named `## Test Cases & AC` (line 17) while `### Plan structure` §3 (line 131) calls it `### Binary AC`. Duplication is the mechanism that lets contradictions creep in.

**First-pass error I caught during plan drafting.** My initial proposal (presented in conversation before this plan file existed) listed Working Principles #1 and #8 as "high confidence deletes." On close re-reading, each has unique content not fully mirrored downstream:
- **WP#1** carries "If something goes sideways, STOP and re-plan immediately" and "Use plan mode for verification steps, not just building" — neither is restated in the Planner/Executor Workflow.
- **WP#8** is about spawning an **Explore/research subagent** to gather context FOR the main session. That's an intra-session pattern, distinct from the planner→executor brief handoff in `### Brief structure`. `### Brief structure` covers executor briefs, not research subagent briefs.

Both are revised to **compress rather than delete** below. This is exactly the class of error the critique step is designed to catch, which is why this plan exists as a file instead of an inline execution.

## Goal
Two invariants must hold when done:

1. **No rule lost.** Every rule present in CLAUDE.md before the edit must still be expressible by reading CLAUDE.md after the edit. "Expressible" means a reader can recover the same behavioral instruction, though the wording and location may change.
2. **Size reduction.** File drops from 275 lines to ≤ 215 lines (target ~213). A reduction of ≥ 60 lines.

## Binary AC

All commands assume the working directory is `C:\Users\ziyil\coding_projects\` (so the symlink resolves).

**AC-1 — line count dropped.**
`wc -l CLAUDE.md` returns a number ≤ 215.

**AC-2 — no rule lost (grep-based survival check).** For each deletion/compression site, a named phrase that represents the rule still appears in the file. Pass iff **every** grep below returns count ≥ 1.

| Site | Rule-key phrase | Grep command | Must return |
|---|---|---|---|
| H1 Task Management | `\.ai-workspace/plans` | `grep -c '\.ai-workspace/plans' CLAUDE.md` | ≥ 3 |
| H1 Task Management | capture lessons | `grep -c -i 'lessons' CLAUDE.md` | ≥ 1 |
| H2 WP#7 Stateless Verif | stateless reviewer | `grep -c -i 'stateless' CLAUDE.md` | ≥ 2 |
| H2 WP#7 Stateless Verif | binary pass/fail | `grep -c -i 'binary.*pass' CLAUDE.md` | ≥ 1 |
| H3 WP#8 Research-First | research subagent | `grep -c -i 'research subagent\|Explore' CLAUDE.md` | ≥ 1 |
| H4 WP#1 Plan Node Default | stop and re-plan | `grep -c -i 'stop.*re-plan\|re-plan immediately' CLAUDE.md` | ≥ 1 |
| H5 cp anti-pattern | removed | `grep -c '^\- \*\*`cp` to sync' CLAUDE.md` | = 0 |
| M1 WP#2–#6 compressed | subagent strategy | `grep -c -i 'subagent' CLAUDE.md` | ≥ 3 |
| M1 WP#3 lessons | lessons file | `grep -c '\.ai-workspace/lessons' CLAUDE.md` | ≥ 1 |
| M2 Context7 compressed | Context7 | `grep -c 'Context7' CLAUDE.md` | ≥ 2 |
| M2 Context7 how | resolve-library-id | `grep -c 'resolve-library-id' CLAUDE.md` | ≥ 1 |
| M4 Checkpoint merged | Last updated | `grep -c 'Last updated' CLAUDE.md` | ≥ 1 |
| M5 Plan-First trim | ELI5 section | `grep -c 'ELI5' CLAUDE.md` | ≥ 2 |
| H2 mitigation (auto-fix nuance) | reviewer does not auto-fix | `grep -c -i 'auto-fix\|own homework' CLAUDE.md` | ≥ 1 |

**AC-3 — no orphaned cross-references.** After deletion/compression of Working Principles #1, #7, #8, no text in the file says `Working Principle #1`, `Working Principle #7`, or `Working Principle #8`.
`grep -c 'Working Principle #[178]' CLAUDE.md` returns `0`.

**AC-4 — terminology contradiction fixed.** The document no longer uses `## Test Cases & AC` as a prescribed plan-section name (it clashes with `### Binary AC`).
`grep -c '## Test Cases & AC' CLAUDE.md` returns `0`.
`grep -c 'Binary AC' CLAUDE.md` returns ≥ 1.

**AC-5 — top-level header count matches expected delta.** Pre-edit the file has 14 top-level `##` headers (verified via `grep -c '^## ' CLAUDE.md`). Post-edit it must have exactly 12: both `## Task Management` (H1) and `## Checkpoint Tracking` (M4 merge) are removed as top-level headers, nothing else is.
Binary check: `grep -c '^## ' CLAUDE.md` returns `12`.

**AC-6 — numbering consistency in Working Principles.** After compressing/removing #1, #7, #8, either renumber the remaining principles contiguously OR keep the original numbers and let the list have gaps. The plan's choice: **keep original numbering** (less churn, preserves memory-file references like `feedback_plan_ack_before_implementation.md` that may cite numbered principles). AC: `grep -c '^### [0-9]\. ' CLAUDE.md` returns exactly the number of surviving principles (expected: #2, #3, #4, #5, #6, #9 → 6 surviving, minus those we compress away into one-liners).

**AC-7 — file is still a valid symlink target.** `git status` in `ai-brain` shows `parent-claude.md` as modified (proving the symlink pass-through works) and `git status` in `forge-harness` shows CLAUDE.md as unchanged (because forge-harness sees the symlink, not the target). This protects against accidentally editing a copy instead of the target.

## Out of scope
- **Do NOT touch `## Cairn Index-Check Trailer` (lines 244–254).** Every sentence encodes a shipped enforcement contract.
- **Do NOT touch `### Hive-Mind Knowledge Base Research` (lines 28–38).** Filename references are load-bearing.
- **Do NOT touch Working Principles #4 (Verification Before Done) or #9 (Measure Your Own Infrastructure Before Describing It).** Both are unique content, incident-grounded, and not duplicated elsewhere.
- **Do NOT touch the `### What didn't work` bullet list (lines 163–172)** EXCEPT for the single `cp` anti-pattern bullet at line 170, which is explicitly tombstoned by the parenthetical at line 204.
- **Do NOT commit or push.** The user explicitly said "do not push it." After edits, stop at "file edited, not committed."
- **Do NOT rewrite `## Core Principles` (lines 190–193).** User classified it as 🔴 low-confidence in the chat review; leaving it untouched.
- **Do NOT re-order sections.** This is a compaction pass, not a re-architecture. Only delete and compress in place.

## Change set (the actual edits)

Each site below pairs the **removal** with an **exact survival citation** — a quoted line from elsewhere in the file that still carries the rule after the edit. The critic's job is to verify each pairing.

### H1 — Delete `## Task Management` (lines 182–188)
**Remove:** entire section, 7 lines.
**Survival citations:**
- "Plan First: Write plan to `.ai-workspace/plans`" → line 14: `Location: \`.ai-workspace/plans/{YYYY-MM-DD}-{task-slug}.md\``
- "Track Progress: Mark items complete as you go" → line 7: `Mark each task completed the moment it's done — never batch`
- "Document Results: Add review section" → line 154: `Update the plan's Context/Goal/Checkpoint to match shipped reality`
- "Capture Lessons: Update `.ai-workspace/lessons`" → survives in compressed WP#3 (see M1 below, which explicitly preserves the lessons file path)
**Savings:** 7 lines.

### H2 — Delete Working Principle #7 "Stateless Verification" (lines 89–94)
**Remove:** 6 lines.
**Survival citation:**
- Line 153 `### Review protocol → 1.`: *"Stateless reviewer first. Spawn a fresh subagent with zero implementation context. Give it the plan's AC list and the PR diff. It runs each AC command and returns binary pass/fail. The reviewer never sees commit messages, mailbox trail, or the planner's conversation."*
- This covers: fresh subagent, binary results, AC-driven, reviewer ≠ implementer.

**Nuance at risk + MANDATORY mitigation:** WP#7 line 94 says *"do not auto-fix (avoid marking your own homework)"*. The Review protocol covers self-grading structurally but never says this phrase. The editor **must** append the following clause to line 153 in the same edit pass:

OLD (line 153 trailing sentence):
```
The reviewer never sees commit messages, mailbox trail, or the planner's conversation.
```
NEW:
```
The reviewer never sees commit messages, mailbox trail, or the planner's conversation. The reviewer does not auto-fix failing ACs — avoid marking your own homework; report failures back to the planner for routing.
```

Enforcement: AC-2 has a grep for `auto-fix\|own homework` that **must** return ≥ 1 post-edit. If the mitigation is forgotten, that AC fails and the whole plan is non-shipped.

**Savings:** 6 lines (minus the clause added to line 153, net ~5 lines).

### H3 (REVISED) — Compress Working Principle #8 "Research-First Delegation" (lines 96–103) from 8 lines to 2 lines
**Original claim:** delete outright.
**Revision:** compress, don't delete. `### Brief structure` (line 138) covers planner→executor briefs, NOT intra-session research subagents. WP#8's unique content is "spawn an Explore subagent BEFORE starting non-trivial work, to keep the main session's context clean." That pattern is not mirrored downstream.
**Replacement text (2 lines):**
```
### 8. Research-First Delegation
For non-trivial tasks (3+ files or cross-cutting), spawn an Explore subagent to gather context before the main session starts work; the subagent returns a structured brief so the main session's context stays clean. Skip for trivial single-file tasks.
```
**Savings:** 6 lines (8 → 2).

### H4 (REVISED) — Compress Working Principle #1 "Plan Node Default" (lines 50–57) from 8 lines to 3 lines
**Original claim:** delete outright.
**Revision:** compress. Two unique bullets have no downstream mirror:
- *"If something goes sideways, STOP and re-plan immediately — don't keep pushing"* — not in Planner/Executor Workflow.
- *"Use plan mode for verification steps, not just building"* — not in Planner/Executor Workflow.
**Replacement text (3 lines):**
```
### 1. Plan Node Default
Enter plan mode for any non-trivial task (3+ steps or architectural decisions); close with a stateless review (see `## Planner / Executor Workflow`). If something goes sideways mid-flight, STOP and re-plan immediately rather than pushing through. Use plan mode for verification steps, not just building.
```
**Survival citation for the bullets being dropped:**
- "skip trivial fixes" → line 174 `### When to skip this workflow → Trivial fixes (single file, no architectural decisions, < 10 lines changed)`
- "stateless review to close" → line 153 (already cited in H2)
- "plan → implement → review → ship loop" → structurally embodied in the Planner/Executor Workflow section
**Savings:** 5 lines (8 → 3).

### H5 — Delete the obsolete `cp` anti-pattern bullet (line 170) + its tombstone parenthetical in line 204
**Remove line 170 entirely:**
```
- **`cp` to sync `CLAUDE.md` ↔ `parent-claude.md`.** Wholesale file copy clobbers project-specific content that exists in one but not the other. The files share sections but have divergent project-specific content in each direction. Sync is one-directional and selective: use targeted Edit-tool calls for the shared section only, and run `git diff parent-claude.md` after any CLAUDE.md edit to sanity-check that nothing else changed.
```

**Surgical edit to line 204 (remove ONLY the parenthetical, preserve the rest of the line):**

OLD:
```
  - `C:\Users\ziyil\coding_projects\CLAUDE.md` is a **symlink** to `ai-brain/parent-claude.md`, created by `ai-brain/scripts/setup.sh`. Edit the workspace path; the change lands as a working-tree modification in ai-brain and ships via the normal PR flow. No manual sync needed. (The `cp` anti-pattern note in the `## Planner / Executor Workflow` "What didn't work" list is kept as a historical warning about the pre-symlink architecture — it no longer describes a live hazard.)
```

NEW:
```
  - `C:\Users\ziyil\coding_projects\CLAUDE.md` is a **symlink** to `ai-brain/parent-claude.md`, created by `ai-brain/scripts/setup.sh`. Edit the workspace path; the change lands as a working-tree modification in ai-brain and ships via the normal PR flow. No manual sync needed.
```

**Rationale:** The bullet was explicitly tombstoned by line 204. Once the bullet is gone, the tombstone has nothing to reference and becomes dead prose.
**Survival citation:** N/A — this rule is intentionally retired because the symlink architecture (line 204 first sentence, preserved above) mechanically prevents the hazard.
**Savings:** ~2 lines.

### M1 — Compress Working Principles #2, #3, #5, #6 from 4 bullets each to 1 line each
**WP#2 Subagent Strategy (4 bullets, lines 59–63) →**
```
### 2. Subagent Strategy
Use subagents liberally to keep main context clean — offload research, parallel analysis, and focused execution tracks.
```
**WP#3 Self-Improvement Loop (4 bullets, lines 65–69) →**
```
### 3. Self-Improvement Loop
After any user correction, update `.ai-workspace/lessons` with a rule that prevents the same mistake; review at session start.
```
(Preserves the `.ai-workspace/lessons` file path — required by AC-2 grep.)
**WP#5 Demand Elegance (4 bullets, lines 77–81) →**
```
### 5. Demand Elegance
For non-trivial changes, pause and ask "is there a more elegant way?" If a fix feels hacky, re-implement the elegant version.
```
**WP#6 Autonomous Bug Fixing (4 bullets, lines 83–87) →**
```
### 6. Autonomous Bug Fixing
Given a bug report, just fix it — point at logs, errors, failing tests, and resolve. Zero context-switching required from the user.
```
**Savings:** 4 principles × ~3 lines saved each = ~12 lines.

### M2 — Compress `## Context7 MCP Usage` (lines 256–274, 19 lines) to ~8 lines
**Replacement:**
```
## Context7 MCP Usage
Proactively fetch up-to-date library/framework documentation via Context7 MCP instead of relying on training data — don't wait to be asked. Use it for: dependency upgrades (check breaking changes), unfamiliar APIs, cross-ecosystem work (Node/TS, Flutter/Dart, Python, Java), debugging unexpected library behavior, framework version differences (Flutter widgets, Next.js routing, Gradle DSL).

Skip for: stable universal APIs (`JSON.parse`, `List.map`), project-internal code, or high-confidence recent context.

**How:** call `resolve-library-id` → `get-library-docs` with an explicit `topic` to scope. Never fetch entire library docs.
```
**Savings:** ~11 lines (19 → 8).

### M3 — Collapse `claude-code-memory` mappings in `### 2. ai-brain Sync` (lines 205–207)
**Remove:** 3 separate project-specific lines (hive-mind, monday-bot, forge-harness).
**Replace with:** 1 template line:
```
- `~/.claude/projects/C--Users-ziyil-coding-projects-<project>/memory/*` → `ai-brain/claude-code-memory/<project>/*` (known projects: hive-mind, monday-bot, forge-harness)
```
**Savings:** 2 lines.

### M4 — Merge `## Checkpoint Tracking` (lines 40–46) into Planner/Executor `Plan structure §8` (line 136)
**Remove:** the standalone `## Checkpoint Tracking` top-level section (7 lines).
**Fold into line 136 §8 Checkpoint:**
```
8. **Checkpoint** — living checklist. List every step as a checkbox; mark complete immediately after finishing each; add a `Last updated: {timestamp}` line after each update. Updated by the planner during review to reflect shipped reality, not original intent. Major-step updates (steps that change plan scope or reveal new constraints) must also update future steps, not just the checkbox.
```
**Survival citations for dropped content:**
- "On session resume, read the plan file to determine where to continue" → survives implicitly: the plan-first workflow already makes `.ai-workspace/plans/` the canonical resume target.
**Savings:** ~5 lines (7 removed, ~2 added to §8).

### M5 — Trim `## Plan-First Workflow` `Test Cases & AC` sub-bullets (lines 17–22, 6 lines) + fix terminology contradiction
**Remove:** the entire `Test Cases & AC` sub-bullet group (lines 17–22). This duplicates `### Plan structure §3 Binary AC` AND uses a different section name (`## Test Cases & AC` vs `### Binary AC`), which is a live contradiction.
**Replace with:** one line referencing the authoritative spec:
```
- Each plan must include a `### Binary AC` section — see `## Planner / Executor Workflow → Plan structure` for the full spec.
```
**Savings:** 5 lines (6 → 1) AND fixes AC-4 terminology contradiction.

## Ordering constraints
1. Do all deletions/compressions in a **single pass** before running AC-1 (line count). Partial edits risk mis-counting.
2. Apply the H2 mitigation (add "reviewer does not auto-fix" to line 153) in the same pass as H2 deletion, so AC-2 passes.
3. AC-1 (line count) runs last; all other ACs run after individual edit sites are done.

## Verification procedure (reviewer's script)
Reviewer runs the following in order. Binary pass/fail:

```bash
cd C:/Users/ziyil/coding_projects

# AC-1: size
LINES=$(wc -l < CLAUDE.md)
echo "AC-1 line count: $LINES (target ≤215)"
[ "$LINES" -le 215 ] && echo "AC-1 PASS" || echo "AC-1 FAIL"

# AC-2: survival greps (each must return the required count)
grep -c '\.ai-workspace/plans' CLAUDE.md       # ≥3
grep -c -i 'lessons' CLAUDE.md                  # ≥1
grep -c -i 'stateless' CLAUDE.md                # ≥2
grep -c -i 'binary.*pass' CLAUDE.md             # ≥1
grep -c -i 'research subagent\|Explore' CLAUDE.md  # ≥1
grep -c -i 'stop.*re-plan\|re-plan immediately' CLAUDE.md  # ≥1
grep -c '^\- \*\*`cp` to sync' CLAUDE.md        # =0
grep -c -i 'subagent' CLAUDE.md                 # ≥3
grep -c '\.ai-workspace/lessons' CLAUDE.md      # ≥1
grep -c 'Context7' CLAUDE.md                    # ≥2
grep -c 'resolve-library-id' CLAUDE.md          # ≥1
grep -c 'Last updated' CLAUDE.md                # ≥1
grep -c 'ELI5' CLAUDE.md                        # ≥2

# AC-3: no orphaned cross-references
grep -c 'Working Principle #[178]' CLAUDE.md    # =0

# AC-4: terminology contradiction fixed
grep -c '## Test Cases & AC' CLAUDE.md          # =0
grep -c 'Binary AC' CLAUDE.md                   # ≥1

# AC-5: markdown sanity (manual inspection — grep alone can't catch this)
head -n 275 CLAUDE.md | grep -nE '^####|^-{2,}$'

# AC-7: symlink pass-through
cd ai-brain && git status parent-claude.md
cd ../forge-harness && git status CLAUDE.md
```

All ACs pass → compaction is complete. Any AC fails → **do not ship**, re-open this plan and revise.

## Critical files
| Path | Role |
|---|---|
| `C:\Users\ziyil\coding_projects\CLAUDE.md` | The symlink target being edited (resolves to `ai-brain/parent-claude.md`) |
| `C:\Users\ziyil\coding_projects\ai-brain\parent-claude.md` | The real file — edits land here via symlink |
| This plan file | Living checklist + AC contract |

## Checkpoint
- [x] Proposal drafted and presented to user in chat
- [x] User picked slate (B) — recommended
- [x] Plan file written with paired deletion+survival citations
- [x] First-pass error caught: H3 and H4 revised from delete → compress
- [ ] `/coherent-plan` critique run on this file, scoped to survival verification
- [ ] Critique findings addressed (if any)
- [ ] User greenlight received to execute edits
- [ ] Edits applied via `Edit` tool to `C:\Users\ziyil\coding_projects\CLAUDE.md`
- [ ] AC-1 through AC-7 all pass
- [ ] Final verification Read + ELI5 report to user
- [ ] Plan file updated to reflect shipped reality

Last updated: 2026-04-16 (plan drafted, awaiting critique)
