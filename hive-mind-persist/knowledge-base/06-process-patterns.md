# Process Patterns — Workflows That Work at Scale
<!-- AI-FIRST DOCUMENT: Feed this to the AI agent during protocol planning. -->
<!-- PURPOSE: Proven workflow patterns for planning, executing, and maintaining protocol-governed work. -->

## How to Use This File

You are designing a new AI agent protocol. This file covers **process patterns** — how to plan work, execute multi-step tasks, handle session interruptions, and maintain quality over time. These patterns are distinct from rules (what the agent must do) — they're about how the overall workflow operates.

---

## Planning Patterns

### Plan-File-First

- **WHAT:** Before starting any complex task, create a physical plan file (e.g., `tmp/<task-slug>-plan.md`) with objectives, steps, and verification criteria.
- **WHY:** The plan file serves as: (1) a binding reference preventing scope drift, (2) a rollback source for exact replacement texts, (3) a context anchor the agent can re-read when it loses track.
- **WHEN:** Any task with 3+ steps or QCS 2+. Skip for trivial tasks.
- **KEY INSIGHT:** The plan file must be a physical file, not an in-conversation plan. Physical files persist across turns and session boundaries. Conversation-only plans are lost after summary.

### Self-Contained Step Files

- **WHAT:** For multi-step workflows, create one file per step. Each file includes: Objective, Context, Commands (with code), Expected Output, Rollback, Dependencies.
- **WHY:** Agents lose context in long sessions. A step file that includes everything inline eliminates the need to cross-reference other files. "See section X of document Y" is a failure mode.
- **TEMPLATE:**
```markdown
# Step N: [Title]
<!-- Dependencies: Steps [X, Y] must complete first -->

## Objective
[One sentence: what this step accomplishes]

## Actions
[Numbered actions with exact commands]

## Expected Output
[What success looks like — specific files, counts, states]

## Verification
[PowerShell/bash commands that produce binary pass/fail]

## Rollback
[How to undo this step if it fails]
```

### Pre-Written Verification Scripts

- **WHAT:** Write the test/verification commands BEFORE execution. Each acceptance criterion gets a specific command.
- **WHY:** Pre-written commands are mechanical (Tier 2 enforcement). Post-hoc verification invites interpretation. Command output is objective.
- **FORMAT:** For each criterion: `[AC-ID]: [Description] → Command: [exact command] → Expected: [binary result]`

### Dependency Ordering with Rollback Points

- **WHAT:** Steps have explicit dependency chains declared in headers. Each step is independently valuable — the system is functional after any step, just not yet complete.
- **WHY:** Creates natural pause points. If interrupted, the system is in a known-good state. Recovery resumes from the last completed step, not from scratch.

---

## Execution Patterns

### TDD Enforcement (Test-First Development)

- **WHAT:** The first tool call after plan approval should be to run existing tests (baseline). Then write failing test. Then implement. Then verify.
- **FLOW:** `run tests (baseline)` → `write failing test` → `implement code` → `run tests (verify)`
- **ENFORCEMENT:** Tool-call sequencing: "First tool call after GO must be run_in_terminal."
- **REALITY CHECK:** TDD is ideal but achieves ~90% compliance (Tier 2). Strict enforcement (capping score for violations) works. But sometimes agents write code first — this is a known gap. Make it a strong default, not an absolute mandate.
- **MINIMUM ALTERNATIVE:** If TDD isn't natural for the task, at minimum require running tests AFTER code changes with terminal output pasted.

### Dual-Critique Pipeline

- **WHAT:** For any protocol change or architectural plan: research → draft → independent critique #1 → correct → independent critique #2 → correct → finalize.
- **WHY:** Critique round 1 catches strategic errors. Critique round 2 catches tactical errors that emerge from the corrected strategy. Self-review finds only ~20% of bugs.
- **WHEN:** Any architectural change, protocol modification, or plan with 5+ steps. Not needed for simple code changes.
- **CRITICAL:** The critiquer must be independent — a separate subagent with no shared context with the planner. Self-critique finds ~20% of bugs; independent critique finds ~80%.
- **PRE-CRITIQUE FRONT-LOADING:** Before the first critic sees the document, run a Researcher (cross-references knowledge base) and a Justifier (flags unjustified claims). This lets critics focus on deeper structural and implementation issues rather than surface gaps. Evidence: e2e-bugfix Researcher + Justifier caught 4 unjustified items and 10 recommendations before critics.
- **ROUND 2 AS REGRESSION CHECK:** The second critique validates that Round 1's corrections don't introduce new problems. Evidence: e2e-bugfix Round 2 CRITICAL (return type breaking callers) was caused by Round 1 CRITICAL fix (adding confidence signal).

### Backup-Before-Destroy

- **WHAT:** Before any destructive batch operation (deleting files, renaming directories, overwriting configs), create a full backup first.
- **WHY:** Destructive operations are irreversible. Backups are cheap. The backup-then-destroy pattern has zero data loss across all tested scenarios.
- **GENERALIZATION:** This is the GO gate principle ("plan before code") applied to destructive operations: "backup before destroy."

### Snapshot-Before-Cleanup (Git Checkpoint)

- **WHAT:** Before cleaning up files, commit the current state as a git checkpoint. This is stronger than a filesystem backup because it enables comparison (git diff), not just restoration.
- **WHY:** You can `git diff <checkpoint>..HEAD` to see exactly what changed after cleanup. A flat backup only tells you what was there before, not what changed.

### Manager+Subagent Execution Loop

- **WHAT:** For multi-story implementations: manager picks next ready story (dependencies met) → spawns implementer (gets step file) → spawns UAT runner (read-only, checks ACs) → spawns evaluator (holistic verdict) → if fail, spawns fix-suggester → updates tracking → repeat.
- **WHY:** Each subagent has single responsibility with self-contained context. The structured pipeline creates clear evidence chains. The manager handles only orchestration — no implementation.
- **EVIDENCE:** 93.75% first-pass success across 15 stories (89 ACs) in Hive Mind. Only 1 retry needed. Self-healing loop caught and fixed the failure automatically.
- **KEY INSIGHT:** The step file quality drives first-pass success. When step files include verbatim spec excerpts + algorithms + ACs, implementer subagents rarely miss requirements.
- **ARCHIVE PER-ATTEMPT ARTIFACTS:** Eval reports (and test reports) should be archived per-attempt (e.g., `eval-report-{attempt}.md`) rather than overwritten. When post-mortem needs to trace which attempt's parse failed, only the final version is available if reports are overwritten. (Discovered run-02: US-01 eval reports from attempts 1 and 2 were overwritten — couldn't trace why parser matched on attempt 3 but not 1-2.) **Validated run-03:** Bug 10 fix implemented `copyFileSync` archiving — 6 per-attempt archives created (test-report-1.md + eval-report-1.md × 3 stories). All accessible for post-mortem.

### Mandatory Re-UAT After Fix

- **WHAT:** After applying a fix-report, the full cycle must be re-run: fix → re-UAT → re-eval. Never: fix → compile → done.
- **WHY:** Compilation success proves type correctness, not functional correctness. The original failure conditions may not be resolved by a fix that merely compiles.
- **EVIDENCE:** Hive Mind US-13 fix verified by compilation only, not full AC re-run. The fix was correct, but this was luck — not process.
- **ENFORCEMENT:** Protocol rule: "After fix-report is applied, re-spawn UAT runner against ALL ACs."

### Verification Depth Rules

- **WHAT:** Define upfront which stories get which verification stages: 3-stage (impl+uat+eval) for high complexity, 2-stage (impl+uat) for medium, 1-stage (impl only) for low. Never skip UAT for high-complexity stories.
- **WHY:** Without explicit rules, verification depth becomes ad-hoc — driven by context pressure rather than risk assessment. This creates blind spots.
- **EVIDENCE:** Only 40% (6/15) of Hive Mind stories got full 3-stage evaluation. 33% (5/15) got impl-report only. The stage-skipping was ad-hoc.

### Config Threading (Load Once → Pass as Parameter)

- **WHAT:** Load config from file once at startup. Pass the config object as a parameter through orchestrator → stages → spawner. No global singletons, no module-level state.
- **WHY:** Explicit dependencies make testing trivial — inject test config directly. Deep merge for partial overrides (`{ ...defaults, ...userOverrides }`) means adding new agents/features doesn't require config file updates. `getDefaultConfig()` returns a fresh copy to prevent cross-test pollution.
- **EVIDENCE:** Phase 1 MVP established the pattern. Phases 2 and 3 added new config fields (backoff, budget, baseline commands, silent mode) with zero friction because the threading was already in place.

### Multi-Agent Pipeline (Split → Parallel → Assemble)

- **WHAT:** Replace a monolithic agent doing N distinct jobs with N focused agents: one produces skeletons/structure, others fill in sections in parallel, then outputs are assembled into the final artifact.
- **WHY:** Each agent optimizes for a single concern. Parallel generators reduce wall-clock time. Natural model-tier mapping — expensive models for decomposition, cheaper for criteria generation.
- **WHEN:** Any single agent doing 3+ distinct jobs. Signals: agent prompt is very long, output quality varies across sections, or you want different model tiers for different subtasks.
- **EVIDENCE:** Phase 4 (ENH-07): Synthesizer → planner (Opus) + AC-generators (Sonnet, parallel) + EC-generators (Sonnet, parallel) + assembler. Each generator gets a skeleton + spec as input, produces one section.
- **KEY INSIGHT:** The planner's output (story skeletons) is the contract between stages. Keep skeletons minimal — just enough for generators to do their job without re-reading the full spec.

### Two-Batch Stage with Producer→Consumer Ordering

- **WHAT:** When agents in a stage have data dependencies, split into batches. Batch 1: independent producers run in parallel. Batch 2: consumers that need batch 1 outputs run in parallel.
- **WHY:** Maximizes parallelism within dependency constraints. Simple to reason about — draw the data flow, identify the boundary.
- **WHEN:** A stage has agents where some produce artifacts that others consume. If all agents are independent, one batch suffices.
- **EVIDENCE:** Phase 4 (PRD-05, PRD-06): Report stage batch 1 = code-reviewer + log-summarizer (parallel, independent). Batch 2 = reporter + retrospective (parallel, consume batch 1 outputs).

### Non-Fatal Enrichment with Corruption Detection

- **WHAT:** Post-processing agents that augment artifacts should be wrapped in try/catch. After enrichment, validate required sections still exist. If corrupted, restore from cached pre-enrichment outputs.
- **WHY:** Enrichment is additive — optional value on top of mandatory content. The enricher rewrites the file in-place, risking corruption. Validation + cache restore makes enrichment safe.
- **WHEN:** Any agent that rewrites an existing artifact to add sections (implementation guidance, security notes, edge cases).
- **EVIDENCE:** Phase 4 (ENH-16): Enricher adds 3 sections to step files. If `## ACCEPTANCE CRITERIA` or `## EXIT CRITERIA` go missing, `assembleStepFile()` rebuilds from cached AC/EC outputs.

### Cross-Phase Context Injection

- **WHAT:** Thread planning-phase specialist outputs (role-reports) into execution-phase agent prompts via an explicit type-based mapping. Each agent type receives only relevant role-reports, truncated to a word budget.
- **WHY:** Without injection, execution agents re-derive specialist insights from scratch. The mapping prevents context bloat by filtering — implementer gets architect+security+analyst, not all 5 reports.
- **WHEN:** When planning produces specialist analysis consumed during execution. The mapping should be explicit and documented, not implicit.
- **EVIDENCE:** Phase 4 (ENH-16): `buildRoleReportContents()` filters role-reports by `getRoleReportsForAgent()` mapping, truncates to 2000 words per report, returns concatenated content for all 7 execution agent types.

### Budget Enforcement (Accumulate → Check → Throw on Breach)

- **WHAT:** CostTracker accumulates per-story, per-agent-type costs with timestamps. `enforceBudget()` checks cumulative spend against the configured cap and throws `HiveMindError` if breached.
- **WHY:** Simple accumulator (not singleton) instantiated at approve-plan checkpoint and passed through the execute loop. O(n) query pattern — no indexing needed at pipeline scale. Budget enforcement as a thrown error integrates naturally with the existing error recovery (RD-02) pattern.
- **EVIDENCE:** Phase 3 (RD-05): 8 tests covering accumulation, budget enforcement, and summary generation. Live cost data from Phase 2 Tier 3: ~$0.10 for full SPEC+PLAN+EXECUTE+REPORT run.

---

## Session Management Patterns

### Three-View Tracking

- **WHAT:** Maintain three synchronized tracking views for multi-session work:
  1. **Bird's eye** — Quick status: step number, status emoji, progress %
  2. **Detailed** — Each criterion with ✅/⬜ checkbox
  3. **Narrative** — What happened, decisions made, context for recovery
- **WHY:** Each view answers a different question. A new session needs bird's eye for position, detailed for verification, narrative for context.
- **UPDATE FREQUENCY:** Update all three at each step boundary (not mid-step). Atomic updates prevent desync.
- **NOTE:** This is NOT the same as rule duplication (anti-pattern F13). Each view serves a distinct purpose.

### Session Boundary Recovery

- **WHAT:** When resuming after a session interruption (token budget, VS Code restart), the agent must:
  1. Read the tracking files to determine current position
  2. Read the completed output files to verify prior step results
  3. Continue from the first incomplete step
- **WHY:** Conversation summaries preserve facts but lose behavioral context. Tracking files are the reliable recovery source.
- **REQUIREMENT:** All tracking and output files must be self-describing — they include their own context (step number, timestamp, agent ID, status).

### Idempotent Automation

- **WHAT:** All automation scripts must produce the same result when run twice. Re-running setup should not create duplicates or corrupt state.
- **WHY:** Session interruptions make it uncertain whether a previous run completed. Idempotent scripts eliminate this uncertainty.
- **TEST:** Run every automation script twice during development. The second run should produce identical state to the first.

### Agent ID System for Audit Trails

- **WHAT:** Tag every action with an Agent ID: `<ROLE>-<STEP>-<ATTEMPT>` (e.g., EXE-03-1 = Executor, Step 3, Attempt 1).
- **WHY:** Creates a traceable audit trail. Output files include the Agent ID in filename and header. Any action can be traced to its step, role, and attempt.
- **SIMPLIFICATION:** In single-agent environments (Copilot Chat), the role is always the same agent. The Agent ID still provides value for step tracking and attempt counting. Drop multi-role pretense.

### Atomic Tracking Writes

- **WHAT:** Write tracking files (mindmap, logs, status reports) to disk immediately after each state transition. On startup, reconcile files-on-disk vs tracking status.
- **WHY:** Context loss (session breaks, token exhaustion) discards in-memory state. If tracking files weren't flushed before the break, they become stale.
- **EVIDENCE:** Hive Mind session break caused 3 stale entries — mindmap showed "in-progress" for stories with completed code on disk. Required manual verification and 7 backfilled log entries.
- **RULE:** After every status transition: write to disk → verify → then spawn next action. Never rely on in-memory-only tracking.

---

## Quality Patterns

### Evidence Registry (Scientific Method for Protocol)

- **WHAT:** Maintain a registry of what was tried, what happened, and whether it worked — with measured evidence. No unsupported claims.
- **FORMAT:** Separate tables for Proven Patterns, Failed Patterns, and Constraints. Each entry cites a version number, audit finding, or measured result.
- **WHY:** Prevents re-inventing failed patterns. The old protocol's evidence registry (what-works.md) was its most valuable artifact — worth more than all 70,000 tokens of rules combined.
- **UPDATE RULE:** After every protocol change or real-session audit, add an entry with evidence.

### Real-Session Audits Over Simulations

- **WHAT:** Measure protocol compliance from actual work sessions, not simulated scenarios.
- **WHY:** Simulations scored 98% compliance. Real sessions scored 72%. A 26pp gap. Simulations test formatting ability; real sessions test actual behavior under task pressure.
- **HOW:** Periodically review a real work session transcript. Count: how many rules were followed? Which were skipped? What was the task context? Record findings.

### Broken Windows Prevention

- **WHAT:** Fewer rules at higher compliance beats more rules at lower compliance.
- **MEASURE:** Track compliance per rule. Rules below 50% compliance should be: (a) elevated to Tier 1-2 enforcement, or (b) removed entirely.
- **WHY:** Visibly unenforced rules teach the agent that rule-following is optional. This erodes compliance on adjacent rules. Cutting dead rules strengthens surviving ones.

---

## Workflow Process Checklist (For Protocol Designers)

When designing a new workflow:

1. ☐ Can each step be expressed as a self-contained step file?
2. ☐ Does each step have binary verification criteria with commands?
3. ☐ Are steps dependency-ordered with explicit declarations?
4. ☐ Is the system functional after every step (no half-broken states)?
5. ☐ Is there a backup/snapshot before any destructive step?
6. ☐ Are automation scripts idempotent?
7. ☐ Is there three-view tracking for multi-session work?
8. ☐ Has the workflow been tested with at least one session interrupt?
9. ☐ Are tracking writes atomic (disk before next action)?
10. ☐ Is there a re-UAT requirement after fixes?
11. ☐ Are verification depth rules defined by complexity level?

### PP1 -- [Graduated from memory.md]
- WHAT: Fixer agents sometimes create phantom test files — hardcoded copies of functions instead of importing from source. Learning reports for US-03 and US-04 both flagged this independently. (run-02)
- WHY IT WORKS/FAILS: Observed across multiple stories
- EVIDENCE: Graduated from memory.md (DISCOVERIES)
- DESIGN IMPLICATION: Apply this pattern/lesson in future work


### PP2 -- [Graduated from memory.md]
- WHAT: Source correctness vs test infrastructure are independent failure modes — feature code was correct but tests couldn't reach it. Debug test harness first before modifying source. (US-03, US-04)
- WHY IT WORKS/FAILS: Observed across multiple stories
- EVIDENCE: Graduated from memory.md (DISCOVERIES)
- DESIGN IMPLICATION: Apply this pattern/lesson in future work


### PP3 -- [Graduated from memory.md]
- WHAT: Zero-dependency implementations eliminate friction. Run-04 US-02/US-03/US-04: no npm install, no version conflicts, pure TypeScript compiled and tested immediately. Default to zero-dependency for utility functions.
- WHY IT WORKS/FAILS: Observed across multiple stories
- EVIDENCE: Graduated from memory.md (DISCOVERIES)
- DESIGN IMPLICATION: Apply this pattern/lesson in future work

