# Proven Patterns — What Works and Why
<!-- AI-FIRST DOCUMENT: Feed this to the AI agent during protocol planning. -->
<!-- PURPOSE: Every pattern here has measured evidence of success. Build on these. -->

## How to Use This File

You are designing a new AI agent protocol. Every pattern below **actually worked** in real sessions with measured evidence. When choosing how to enforce rules, structure files, or design workflows — prefer patterns from this list. Each pattern includes:
- WHAT: The pattern in one sentence
- WHY IT WORKS: Root cause of success
- EVIDENCE: Measured result
- DESIGN IMPLICATION: How this should shape the new protocol

---

## Tier 1: Highest-Impact Patterns (Build Protocol Around These)

### P1 — Named Rules with Score Caps

- **WHAT:** Give every important rule a short name (e.g., OP-1, GO-1) and attach a mechanical consequence (score cap or gate failure) for violations. Place the rule in the file the AI always reads.
- **WHY IT WORKS:** Named rules are memorable, scannable, and create a specific identity the agent can reference. Score caps create immediate, visible consequences — the agent knows skipping the rule degrades its output score.
- **EVIDENCE:** OP-1 achieved 100% compliance in every real session audited. Rules without names or consequences achieved 14-17%.
- **DESIGN IMPLICATION:** Every rule in the new protocol should have a name and a consequence. If a rule isn't important enough for a name and consequence, it shouldn't be a rule.

### P2 — Tool-Call Sequencing Constraints

- **WHAT:** Instead of telling the agent "you should run tests before writing code" (behavioral intent), constrain which tool can fire first: "The FIRST tool call after GO must be run_in_terminal."
- **WHY IT WORKS:** Tool-call order is mechanically verifiable — you can check from the conversation history which tool was called first. Behavioral intent is unverifiable.
- **EVIDENCE:** A one-word change to TP-1 ("FIRST run_in_terminal call" → "FIRST tool call") delivered +2.45pp substance gain — 12-24x the projected improvement. Second-largest single-version gain in protocol history.
- **DESIGN IMPLICATION:** Express behavioral requirements as tool-call sequencing constraints wherever possible. "Run tests first" → "First tool call must be run_in_terminal." "Show plan before editing" → "No create_file/edit_file before GO confirmation."

### P3 — Always-Loaded Placement

- **WHAT:** Rules must live in the file the AI agent actually reads at the target complexity level. For VS Code Copilot Chat, that's `copilot-instructions.md`. For Claude Code, that's `CLAUDE.md`.
- **WHY IT WORKS:** Rules in files that aren't loaded have 0% compliance — they literally don't exist for the agent.
- **EVIDENCE:** Rules placed in GATES.md had 0% effect at QCS 0-1 because that file isn't loaded for simple tasks. Moving them to copilot-instructions.md made them effective.
- **DESIGN IMPLICATION:** Before adding any rule, answer: "Which file does the agent read for this task type?" Place the rule there. No exceptions.
- **CEILING DISCOVERED:** Platform system prompts outrank all protocol files. VS Code's "keep answers short" overrides rules even in copilot-instructions.md. Design rules that work *with* the platform, not against it.

### P6 — Mechanical Detection Over Judgment

- **WHAT:** Design compliance checks that use pattern-matching ("is there an OPEN line in the response?") rather than judgment ("was the design thoughtful?").
- **WHY IT WORKS:** Mechanical checks produce the same result regardless of who runs them. Judgment calls are subjective and self-biased.
- **EVIDENCE:** FU-1 (scan conversation for prior OPEN line) achieved 100% in every real session. Judgment-based quality assessments showed 10-15pp self-scoring inflation.
- **DESIGN IMPLICATION:** Every compliance rule should be verifiable by a simple pattern-match or command output check. If you can't describe the verification as "if X exists, pass; else fail," the rule is too vague.

### P11 — External Artifacts > Internal Checklists

- **WHAT:** Compliance mechanisms that produce inspectable files (plan files, step files, terminal output) outperform ones that rely on internal reasoning ("think about X before Y").
- **WHY IT WORKS:** External files persist across turns, can be re-read when context degrades, and provide audit evidence. Internal reasoning is ephemeral, unverifiable, and lost after conversation summary.
- **EVIDENCE:** SC-1 (internal pre-flight checklist) had zero measured compliance uplift. SF-1 (step file in tmp/) was auditable and re-readable.
- **DESIGN IMPLICATION:** Never use "mentally confirm X." Always require a file, terminal output, or visible block. If compliance matters, require an artifact.

---

## Tier 2: High-Impact Patterns (Strongly Recommended)

### P4 — Wrong/Right Examples Co-Located with Rules

- **WHAT:** Place a concrete Wrong example and Right example directly next to each rule, not in a separate examples file.
- **WHY IT WORKS:** Agents learn from examples more reliably than from abstract descriptions. Co-location ensures the example is seen when the rule is read.
- **EVIDENCE:** OPEN Wrong/Right examples (v10.19.0) and LEARN Wrong/Right (v10.20.0) both drove sustained compliance uplift.
- **DESIGN IMPLICATION:** Every rule should have one Wrong and one Right example, inline, ≤5 lines each. Keep them short — long examples waste tokens.

### P5 — Dual-Critique Pipeline

- **WHAT:** For any protocol change or complex plan: research → draft → independent critique #1 → correct → independent critique #2 → correct → finalize.
- **WHY IT WORKS:** Critique round 1 catches strategic errors. Critique round 2 catches tactical errors that emerge from the corrected strategy. Self-review finds only ~20% of bugs. Pre-critique stages (Researcher + Justifier) front-load quality by catching unjustified items before critics see the document. Round 2 also serves as a regression check — it validates that Round 1's corrections don't introduce new problems.
- **EVIDENCE:** Caught 27 findings (v10.21.0), 26 findings (v10.22.0). Prevented HIGH-severity bugs from shipping. E2E-bugfix (2026-03-08): 15 organic findings on a real bug-fix plan, 93% application rate (14/15). Round 2 CRITICAL was caused by Round 1 CRITICAL fix.
- **DESIGN IMPLICATION:** Build dual-critique into any workflow that modifies protocol rules or architecture. The critiquer must be independent (separate subagent, no shared context with the planner).

### P12 — ELI5 as Compliance Forcing Function

- **WHAT:** Require the agent to explain decisions in plain language (1-2 sentences, no jargon). Agents that can't explain a decision in ELI5 terms haven't actually made a decision.
- **WHY IT WORKS:** Forces verification of understanding. Prevents cargo-culting — copying a pattern from an example without understanding why it's appropriate.
- **EVIDENCE:** Agents that wrote ELI5 for GO decisions surfaced incorrect assumptions. Agents that skipped ELI5 cargo-culted patterns from examples.
- **DESIGN IMPLICATION:** Require ELI5 explanations for any decision gate (plan choice, architecture decision, workaround). Not for routine execution steps.

### P13 — Compliance Effectiveness Hierarchy (THE Key Discovery)

- **WHAT:** Not all enforcement mechanisms are equal. Four tiers, measured:
  - **Tier 1 (100%):** Named rules + score caps in always-loaded file
  - **Tier 2 (90%+):** Tool-call sequencing constraints, mechanical detection
  - **Tier 3 (70-90%):** Wrong/Right examples, self-check checklists
  - **Tier 4 (<50%):** Behavioral prose, rubric-only changes, consequences in separate files
- **WHY IT WORKS:** Each tier has a different enforcement mechanism. Tier 1-2 are mechanical. Tier 3-4 are voluntary.
- **EVIDENCE:** Reverse-engineering of 10 compliance drivers across v10.19.0-v10.25.0. OP-1 (Tier 1) = 100%. Doc-map prose (Tier 4) = 14%.
- **DESIGN IMPLICATION:** This is the single most important design tool. Every rule in the new protocol should be classified by tier. Target Tier 1-2 for critical rules. Tier 3 supplements. Never rely on Tier 4 alone.

### P14 — Subagent Delegation for Research

- **WHAT:** Delegate multi-file research and cross-cutting analysis to a subagent. The subagent reads 5-10 files in one call and returns comprehensive results.
- **WHY IT WORKS:** Subagents find gaps the user didn't ask about. One subagent call replaces ~15 sequential file reads.
- **EVIDENCE:** Subagent discovered 4 unasked-for findings (isDirty guard gap, missing beforeunload handler, always-mounted side-effect, dead code) in one call.
- **DESIGN IMPLICATION:** Build subagent delegation into research and planning phases. Keep subagents read-only (they can't execute or edit).

### P20 — Manager+Subagent Execution Loop (Implement → UAT → Eval → Fix)

- **WHAT:** For multi-story implementations, use a manager agent loop: pick next story → spawn implementer → spawn UAT runner → spawn evaluator → if fail, spawn fix-suggester → update tracking → repeat.
- **WHY IT WORKS:** Each subagent has a single responsibility and a self-contained step file as input. The structured pipeline creates clear evidence chains (impl-report → uat-report → eval-report → fix-report).
- **EVIDENCE:** 93.75% first-pass success across 15 user stories (89 ACs) in Hive Mind implementation. Only 1 retry needed. **E2E validation (run-02):** 4 stories through full pipeline. 4/4 code correct on first implementation attempt. Manager correctly sequences stories, maintains per-story state, and produces per-story reports. Failures were parser false-negatives, not implementation failures.
- **DESIGN IMPLICATION:** For large implementations (5+ stories), the manager+subagent pattern outperforms sequential single-agent execution. Each subagent gets exactly the context it needs.

### P21 — Fix-Suggest → Retry Loop (Self-Healing)

- **WHAT:** When a story fails UAT/eval, spawn a fix-suggester subagent that produces a structured fix-report (file, line, current code, fix, rationale). Apply fixes, then retry.
- **WHY IT WORKS:** The fix-report format is directly actionable — no interpretation needed. The retry loop is bounded (max 3 attempts) to prevent infinite loops.
- **EVIDENCE:** US-13 (Session Continuity) auto-recovered: evaluator identified 3 blocking issues, fix-suggester produced 7 targeted fixes, second attempt passed all 6 ACs. Zero human intervention.
- **DESIGN IMPLICATION:** Build fix-suggest → retry into any multi-step pipeline. The fix-report format matters: must include exact file, line, current code, and replacement code.

### P22 — JSONL Audit Trail for Manager Decisions

- **WHAT:** The manager agent appends a JSONL entry after every cycle with: cycle number, story ID, verdict (PASS/FAIL), attempts, timestamp, UAT results per AC.
- **WHY IT WORKS:** JSONL is append-only (no corruption from partial writes), machine-parseable, and human-readable. Each entry is a self-contained record.
- **EVIDENCE:** 16 JSONL entries provided full traceability across 2 sessions in Hive Mind. Enabled post-mortem analysis of the US-13 failure and recovery. **E2E validation (run-02):** 19 manager-log entries with all event types (SPEC_COMPLETE, PLAN_COMPLETE, BUILD_COMPLETE, VERIFY_ATTEMPT with parserConfidence + rawExcerpt, COMPLETED, FAILED). Debugging was feasible from the log alone — a significant improvement over run-01's single entry.
- **DESIGN IMPLICATION:** Use JSONL for audit trails. Each entry must be newline-terminated and valid JSON independently. Validate integrity on startup.

---

## Tier 3: Migration-Validated Patterns (Confirmed at Scale)

### P15 — Pre-Written Verification Scripts

- **WHAT:** Write test/verification commands BEFORE execution begins. Every acceptance criterion gets a specific command that produces binary pass/fail output.
- **WHY IT WORKS:** Pre-written verification is mechanical (Tier 2). Command output is objective — the filesystem doesn't lie.
- **EVIDENCE:** 86/86 ACs passed across a 15-step, 6-repo migration. Zero retries. Zero subjective judgment.
- **DESIGN IMPLICATION:** For multi-step work, require verification commands as part of the plan, not as an afterthought.

### P16 — Self-Contained Step Files

- **WHAT:** Each step in a multi-step workflow gets its own file with: Objective, Context, Commands (with code), Expected Output, Rollback. No cross-references to other step files.
- **WHY IT WORKS:** Self-containment eliminates context loss from cross-file navigation. The agent never has to "figure out" what to do — it's all inline.
- **EVIDENCE:** 15 step files executed without scope drift or misinterpretation despite spanning 4 session boundaries.
- **DESIGN IMPLICATION:** For any workflow with 3+ steps, create self-contained step files. "See section X of document Y" is a failure mode.

### P17 — Binary ACs Make Self-Grading Safe

- **WHAT:** When all acceptance criteria are binary (exists/doesn't, count matches/doesn't) and verified by commands, self-grading bias is eliminated.
- **WHY IT WORKS:** Binary outcomes have no room for interpretation. The filesystem output is the same regardless of who runs the command.
- **EVIDENCE:** 86/86 binary ACs passed correctly despite the same agent executing and evaluating.
- **LIMITATION:** This does NOT apply to subjective criteria (code quality, design decisions). For those, self-grading inflates scores by 10-15pp.
- **DESIGN IMPLICATION:** When possible, express requirements as binary testable criteria. "Code is clean" → "Linter passes with 0 errors."

### P18 — Three-View Tracking for Session Survival

- **WHAT:** Maintain three synchronized tracking views: (1) Bird's eye (progress overview), (2) Detailed (each criterion with ✅/⬜), (3) Narrative (what happened and why).
- **WHY IT WORKS:** Each view answers a different question. A new session needs the bird's eye to find position, the detailed view to verify completeness, and the narrative to recover context.
- **EVIDENCE:** 4 session boundaries (token budget interruptions) crossed successfully. Each new session resumed from tracking files.
- **DESIGN IMPLICATION:** For multi-session work, mandate structured tracking files. This is NOT the same as rule duplication (F13) — each view serves a distinct purpose.

### P19 — Idempotent Automation

- **WHAT:** Automation scripts should produce the same result when run twice. Re-running setup should not create duplicates or corrupt state.
- **WHY IT WORKS:** Session interruptions are inevitable. Idempotent scripts eliminate the question "did my last run complete?" — just re-run it.
- **EVIDENCE:** setup.mjs and publish.mjs both verified idempotent across multiple re-runs. Zero corruption.
- **DESIGN IMPLICATION:** All automation in the protocol tooling must be idempotent. Test by running twice.

### P23 — Dependency-Wave Parallelism via Mindmap Graph

- **WHAT:** Group stories into waves by dependency. Stories with no mutual dependencies run in parallel within a wave. Sequential across waves.
- **WHY IT WORKS:** The mindmap dependency graph (JSON with `dependencies` arrays) makes it mechanically verifiable which stories can safely run concurrently.
- **EVIDENCE:** Hive Mind Wave 3 ran 4 stories simultaneously (US-03, US-04, US-06, US-08). Wave 7 ran 2 (US-12, US-13). Zero conflicts.
- **DESIGN IMPLICATION:** For any multi-story workflow, declare dependencies upfront in machine-readable format. Enable the manager to compute parallelization automatically.

### P24 — Three-File Tracking (Mindmap + Log + Report)

- **WHAT:** Maintain three complementary tracking files: (1) mindmap.json (machine-readable status), (2) manager-log.jsonl (decision audit trail), (3) consolidated-report.md (human-readable summary with ELI5).
- **WHY IT WORKS:** Each file serves a different consumer: mindmap for the manager agent (machine), log for post-mortem (auditor), report for the human (user).
- **EVIDENCE:** Survived 1 session break in Hive Mind — manager recovered position from mindmap, backfilled log from file-on-disk verification.
- **LIMITATION:** Stale tracking occurred when mindmap wasn't flushed to disk before context loss. Must write atomically after each status change.
- **DESIGN IMPLICATION:** Combine machine-readable tracking (JSON), append-only audit (JSONL), and human-readable summary (MD). Write all three atomically at each step boundary.

### P25 — Scan for Keywords Anywhere, Not First-Match

- **WHAT:** When parsing agent-written status lines, scan for the target keyword (PASS/FAIL) anywhere in the line rather than capturing only the first word after a label.
- **WHY IT WORKS:** Agents prepend qualifiers, counts, and decorators before keywords. First-match captures qualifiers ("ALL", "13") instead of the actual status.
- **EVIDENCE:** Run-01: emoji prefix broke first-match. Run-02: "ALL PASS" and "13/13 RUNTIME TESTS PASS" broke first-match. Run-04: "Result:" and "Test Status:" synonyms broke keyword matching. Each new PRD surfaces new format variants — expand vocabulary rather than constrain agents.
- **DESIGN IMPLICATION:** Any parser consuming agent-written free-text should scan for known keywords rather than assume positional placement. This is a specific instance of P6 (mechanical detection over judgment) applied to natural-language parsing.

### P26 — Smoke Test Breaks False-Positive Chains

- **WHAT:** After any implementation, run a single literal execution command (e.g., `node -e "require('./dist/module')"`) as a mandatory exit criterion.
- **WHY IT WORKS:** Grep checks verify structure; runtime checks verify execution. 4 consecutive reports (impl, refactor, test, eval) all showed green before one execution test caught the missing .js file.
- **EVIDENCE:** Run-02 US-04: 4 reports passed by text-matching .ts source. One `require()` call would have caught the missing .js immediately.
- **DESIGN IMPLICATION:** Pair every grep-based verification with at least one runtime assertion. The smoke test is the cheapest, highest-value verification step.

### P27 — Tight Scope + Single Responsibility = First-Pass Success

- **WHAT:** Stories scoped to a single file with single responsibility (types, state machine, collection) pass all criteria on first attempt with zero refactoring.
- **WHY IT WORKS:** Smaller scope means fewer moving parts, clearer acceptance criteria, and less room for misinterpretation. Agents produce clean code when requirements are unambiguous and self-contained.
- **EVIDENCE:** Run-03: 3 stories (9, 19, 29 lines), 41/41 tests, 21/21 exit criteria, 100% first-pass, zero refactoring. Run-02: 4/4 code correct. Run-04: 4/4 code correct on first attempt, 47/47 ACs pass, zero code defects. Run-05: 4/4 code correct, 66/66 ACs, 69/69 tests, 4/4 committed. Across 16 stories and 5 runs, 0 required a second implementation pass when scope was tightly controlled.
- **DESIGN IMPLICATION:** Decompose work into the smallest viable stories. A story that touches 1-2 files with clear inputs/outputs will outperform a story that touches 5 files. Invest in spec decomposition quality, not fix-loop capacity.

### P28 — Spec Quality Drives Code Quality (Not Code-Level Instructions)

- **WHAT:** Agent-generated code follows proven engineering patterns (lookup tables, Map collections, spread immutability, runtime guards) without explicit code-style prompting. Quality comes from clear specs, not code-style rules.
- **WHY IT WORKS:** Modern LLMs internalize coding best practices from training data. When the spec clearly defines WHAT to build, the agent applies appropriate HOW patterns autonomously. Adding code-style instructions is redundant overhead.
- **EVIDENCE:** Run-03: All 3 stories independently chose optimal patterns — US-02 used `Record<TaskStatus, TaskStatus[]>` lookup table, US-03 used `Map<string, Task>` for O(1) lookups + order preservation, US-02 used spread operator for immutability. Run-04: US-04 independently chose linear-time regex with named constants, `for...of` for Unicode-safe iteration (US-02). Run-05: US-04 used tokenize-then-rejoin pipeline for case conversion, US-03 used frequency analysis with proper edge-case handling. None of these patterns were specified in step files.
- **DESIGN IMPLICATION:** Invest in SPEC agent quality and step file clarity. Don't add code-style rules to implementation prompts — they waste tokens and constrain agents unnecessarily. Let the spec define WHAT; trust the agent for HOW.

### P29 — Explicit Finalization Step in Orchestrated Workflows

- **WHAT:** After tests pass, treat finalization (git commit + state update) as a mandatory, explicit workflow phase — not an implicit side effect.
- **WHY IT WORKS:** Orchestrators track state via execution-plan.json and git commit status. If no agent executes finalization, the orchestrator re-enters the story on every cycle, wasting full orchestration rounds on already-correct code.
- **EVIDENCE:** Run-04 US-01 and US-04: code correct on attempt 1, all tests passed, but orchestrator re-entered both stories twice (3 attempts each) because no finalization step executed. Both stories' fix-report-2 eventually diagnosed the issue as workflow gap, not code defect.
- **DESIGN IMPLICATION:** Design the pipeline so finalization is a mandatory phase with clear ownership. Either the tester agent triggers it after PASS, or a dedicated finalization agent runs between verify and learn stages.

### P30 — Concrete PRD Examples Prevent Ambiguity

- **WHAT:** Including input/output examples directly in story definitions (e.g., `charFrequency("aab") → { a: 2, b: 1 }`) eliminates ambiguity and produces correct implementations on first pass.
- **WHY IT WORKS:** Concrete examples are unambiguous specifications. The agent doesn't need to interpret intent — it can verify its implementation against the example. This removes the single largest source of first-pass failures: misunderstood requirements.
- **EVIDENCE:** Run-05 US-03: 15/15 ACs passed with no revision. Complex frequency analysis function implemented correctly because the PRD contained exact input/output pairs.
- **DESIGN IMPLICATION:** PRDs should include at least one input/output example per non-trivial function. Examples are cheaper than fix cycles.

### P31 — Report Verdict Placement (First 200 Characters)

- **WHAT:** Place the status indicator (e.g., `Status: ✅ ALL PASS`) in a `## Summary` section immediately after the report title. Pipeline parsers read only a short excerpt (~300 chars) to find the verdict.
- **WHY IT WORKS:** Parsers extract a fixed-length excerpt from reports. If the verdict is buried deep in the report, it falls outside the parser window and the story false-fails regardless of code quality.
- **EVIDENCE:** Run-05 US-04: attempts 1-2 false-failed because verdict was a label-free standalone line (`✅ **ALL TESTS PASSED** (21/21)`) outside the parser window. Attempt 3 self-healed when the agent placed `**Status**: ✅ ALL PASS` near the top.
- **DESIGN IMPLICATION:** Agent prompts should instruct: "Place your PASS/FAIL verdict with a label keyword in the first 200 characters of the report." This is a specific instance of P6 (mechanical detection over judgment).

### P32 — Config-as-Parameter Threading (Not Global Singleton)

- **WHAT:** Load config once at startup, pass as parameter through orchestrator → stages → spawner. No global singleton.
- **WHY IT WORKS:** Explicit dependencies make testing trivial — no hidden global state to reset between tests. Deep merge (`{ ...defaults, ...userOverrides }`) means new agents don't require config file updates.
- **EVIDENCE:** Phase 1 MVP: config threading established as standard pattern across all stages. Every subsequent phase (2, 3) followed it without friction. `getDefaultConfig()` returns a fresh copy to prevent test pollution.
- **DESIGN IMPLICATION:** For any shared state in a pipeline, prefer parameter passing over global access. It's more verbose but eliminates an entire class of test-isolation bugs.

### P33 — vi.mock Inline Factory Pattern (Avoid TDZ)

- **WHAT:** Define mock implementations *inside* the `vi.mock()` factory function, not as `const` declarations above it. Import the module under test *after* `vi.mock()`.
- **WHY IT WORKS:** `vi.mock()` is hoisted above all `const` declarations. Referencing a `const mockImpl` from outside the factory causes "Cannot access before initialization" (temporal dead zone). Inline definitions avoid TDZ entirely.
- **EVIDENCE:** Phase 1: cost ~30min debugging the first occurrence. Once established, all 36 test files follow the pattern with zero TDZ errors.
- **DESIGN IMPLICATION:** Establish mock patterns early and document them in learnings. A single debugging session creates a reusable pattern.

### P34 — Strict Output Contract (Fail Over Silent Corruption)

- **WHAT:** If an agent doesn't create its output file via the Write tool, fail explicitly. Never fall back to writing raw stdout to disk.
- **WHY IT WORKS:** The `--print` fallback mode caused agents to produce raw session JSON instead of markdown. The fallback silently saved this garbage as the output file, corrupting downstream parsing and reports. Loud failure is always better than silent corruption.
- **EVIDENCE:** Phase 2 Tier 3: both stories failed because output files were raw JSON session logs. Parser returned "default" confidence. Phase 3 (RD-12) removed the fallback entirely — explicit failure at spawn is now the correct behavior.
- **DESIGN IMPLICATION:** Never write fallback content to output files. If the agent didn't produce the expected output, that's a spawn failure — retry or escalate.

### P35 — Marker-Based Section Preservation for Hybrid Docs

- **WHAT:** For documents with both human-written and auto-generated sections, use a marker line (e.g., `## Artifact Inventory`) to separate them. Regeneration preserves everything above the marker and replaces everything below.
- **WHY IT WORKS:** Human-written architecture notes, conventions, and navigation survive across pipeline re-runs. Only the machine-generated artifact inventory is refreshed.
- **EVIDENCE:** Phase 3 (ENH-15): MANIFEST.md uses this pattern. `updateManifest()` reads existing file, finds marker, preserves static section, regenerates dynamic section. If marker not found, appends.
- **DESIGN IMPLICATION:** Any hybrid human+generated document should use marker-based preservation. This pattern also applies to README sections, changelogs with manual annotations, etc.

### P36 — Fail-Fast Baseline Guard Before Execution

- **WHAT:** Run build + test commands before the EXECUTE stage begins. If the codebase doesn't build or tests fail, halt immediately with diagnostics.
- **WHY IT WORKS:** Prevents burning agent tokens on a broken codebase. Pre-existing test failures waste retry attempts — the pipeline blames agent code for failures that existed before it started.
- **EVIDENCE:** Phase 3 (FW-02): `runBaselineCheck()` runs configurable build/test commands sequentially. Fails with first 500 chars of output. `--skip-baseline` flag bypasses for known-broken states.
- **DESIGN IMPLICATION:** Any pipeline that modifies code should verify the starting state is clean. This is the "measure before" principle (07-measurement-reality.md) applied to execution.

### P37 — Multi-Agent Pipeline (Split → Parallel → Assemble)

- **WHAT:** Replace a monolithic agent doing N jobs with N focused agents: one produces skeletons, others fill in sections in parallel, then an assembler merges outputs.
- **WHY IT WORKS:** Each agent optimizes for a single concern without context interference. Parallel execution of independent generators reduces wall-clock time. The split naturally maps to model tiers — expensive (Opus) for decomposition, cheaper (Sonnet) for criteria generation.
- **EVIDENCE:** Phase 4 (ENH-07): Synthesizer replaced by planner (Opus, story skeletons) → AC-generators (Sonnet, per-story) → EC-generators (Sonnet, per-story). ACs and ECs run in parallel via `spawnAgentsParallel()`. Step files assembled from cached outputs.
- **DESIGN IMPLICATION:** When a single agent does 3+ distinct jobs, consider splitting. The planner output becomes the contract between stages. Each generator gets exactly the context it needs.

### P38 — Two-Batch Stage with Producer→Consumer Ordering

- **WHAT:** When stage agents have dependencies (agent B needs agent A's output), split into batches: batch 1 runs producers in parallel, batch 2 runs consumers in parallel.
- **WHY IT WORKS:** Producers (code-reviewer, log-summarizer) are independent of each other — run them concurrently. Consumers (reporter, retrospective) need producer outputs — run them after batch 1 completes. This is the simplest scheduling that respects data dependencies.
- **EVIDENCE:** Phase 4 (PRD-05, PRD-06): Report stage restructured from 1 batch to 2 batches. Reporter now sees code review findings and log analysis — previously invisible.
- **DESIGN IMPLICATION:** Before adding agents to a stage, draw the data dependency graph. Independent agents → same batch. Consumer depends on producer → later batch. Never put a consumer in the same batch as its producer.

### P39 — Non-Fatal Enrichment with Corruption Detection

- **WHAT:** Post-processing agents that augment existing artifacts (adding sections, metadata, guidance) should be wrapped in try/catch. If the enricher corrupts the artifact (missing required sections), automatically restore from cached pre-enrichment outputs.
- **WHY IT WORKS:** Enrichment is additive value — nice to have, not critical. If the enricher fails or produces garbage, the original artifact is still complete and correct. Automatic corruption detection (check for required section markers) prevents silent degradation.
- **EVIDENCE:** Phase 4 (ENH-16): Enricher adds Implementation Guidance, Security Requirements, and Edge Cases to step files. If enricher corrupts (missing `## ACCEPTANCE CRITERIA` or `## EXIT CRITERIA`), `assembleStepFile()` rebuilds from cached AC/EC outputs. Warning logged.
- **DESIGN IMPLICATION:** Any post-processing agent that rewrites an existing file should: (1) keep pre-enrichment outputs cached, (2) validate required sections exist after enrichment, (3) restore from cache on corruption. Never let optional enrichment destroy mandatory content.

### P40 — Cross-Phase Context Injection via Role-Report Mapping

- **WHAT:** Planning-phase outputs (role-reports from analyst, architect, reviewer, security, tester) are selectively injected into execution-phase agent prompts via a type-based mapping. Each agent type receives only the role-reports relevant to its job.
- **WHY IT WORKS:** Without injection, execution agents re-derive specialist insights from scratch, wasting tokens and risking missed findings. The mapping is explicit (implementer gets architect+security+analyst; tester gets tester-role+analyst+security) so each agent gets focused context, not everything.
- **EVIDENCE:** Phase 4 (ENH-16): `buildRoleReportContents()` reads role-report files, filters by `getRoleReportsForAgent()` mapping, truncates to 2000 words per report, returns concatenated content. Threaded through all 7 execution agent types via `roleReportContents` field.
- **DESIGN IMPLICATION:** When planning produces specialist analysis, thread it to execution via explicit mapping. Don't dump everything into every agent — filter by relevance. Truncate to prevent context bloat.

### P41 — Windows-Safe Prompt and Path Passing

- **WHAT:** (a) Pipe prompts via stdin, not command-line args. (b) Convert all file paths embedded in prompts to forward slashes before sending to agents. On Windows, backslash paths get stripped or garbled by the Claude CLI's bash context.
- **WHY IT WORKS:** (a) Command-line argument passing goes through cmd.exe, which garbles multi-line strings. Stdin bypasses the shell entirely. (b) The Claude CLI runs agents in a bash-like context where `\` is an escape character, not a path separator. Absolute Windows paths like `C:\Users\...\reports` become `C:Users...reports` (a single garbled folder name) or agents create `.hive-mind/` relative to CWD instead of using the absolute path.
- **EVIDENCE:** Phase 4 Tier 3 (Bug 16): prompt garbled via CLI args → fixed with stdin. Phase 6 Tier 3 (K13/K14): agent reports written to `math-core/.hive-mind/reports/` instead of workspace `.hive-mind/reports/` because backslash paths were stripped. A directory named `C:UsersziyilAppDataLocalTemp...` (entire path with `\` removed) was created in the workspace root. Converting to forward slashes in `buildPrompt()` fixed both.
- **DESIGN IMPLICATION:** Any path embedded in an agent prompt must use forward slashes (`toSlash()`). Any prompt content must go via stdin. These are two facets of the same rule: the Claude CLI runs in a bash context, so all text must be bash-safe.

### P42 — Tool Permission Must Match Output Contract

- **WHAT:** If an agent's output contract requires it to create a file via the Write tool, the Write tool must be in its `allowedTools` list. The prompt saying "use Write" is meaningless if the tool isn't available.
- **WHY IT WORKS:** Prompt instructions are suggestions — tool permissions are enforcement. An agent told to "use Write" without Write in its tool list will complete successfully but produce no output.
- **EVIDENCE:** Phase 4 Tier 3 (Bug 17): All SPEC/PLAN/REPORT agents had `READ_ONLY_TOOLS = ["Read", "Glob", "Grep"]` but were told to Write their output files. Every agent completed (exit 0) but never created the file. Adding Write to all agents fixed the entire pipeline.
- **DESIGN IMPLICATION:** When adding a new output requirement, always verify the agent's tool permission set matches. Tool permissions are the real contract — prompts are documentation.

### P43 — Single Source of Truth for EC Commands

- **WHAT:** Executable verification commands (ECs) must exist in exactly one canonical file. If ECs appear in multiple files, a fix applied to one file won't reach the evaluator reading the other.
- **WHY IT WORKS:** The fixer agent patches whichever file it finds first. The evaluator reads from a specific file. If these are different files containing duplicated commands, fixes never reach the evaluator, causing infinite retry loops.
- **EVIDENCE:** Phase 4 Tier 3 (run-06, US-03): `acceptance-criteria.md` and `US-03-ecs.md` both contained the same EC-10 command. Fixer patched `acceptance-criteria.md`; evaluator read from `US-03-ecs.md`. Bug persisted through 3 attempts (10+ minutes wasted).
- **DESIGN IMPLICATION:** Store ECs in one file (the step file or ecs file). Reference by path, never copy. If consolidation isn't possible, fix agents must be told to patch ALL files containing the command.

### P44 — Loud Failure on Parse Errors (Never Silent Catch)

- **WHAT:** Every catch block that handles a parse error must log a warning with the error message and truncated input. Empty catch blocks hide failures that cascade into harder-to-debug downstream issues.
- **WHY IT WORKS:** When agent output is malformed JSON, an empty catch block silently drops cost data, session IDs, and error context. The caller sees `undefined` but has no way to know why. Adding a `console.warn` with the error and first 200 chars of stdout makes parse failures immediately visible in logs.
- **EVIDENCE:** Phase 4 K2 fix — `shell.ts:136` had an empty catch block. During debugging, missing JSON parse data made it impossible to determine whether agents were returning malformed output or returning nothing.
- **DESIGN IMPLICATION:** Audit all catch blocks in data-parsing code. If a catch block contains only a comment, it's a bug. At minimum: log the error message and a truncated sample of the input.

### P45 — Warn on Missing Data Defaults (Never Silent $0)

- **WHAT:** When a numeric value defaults to 0 because the real data is missing, log a warning. This ensures operators can distinguish "actually zero" from "data unavailable."
- **WHY IT WORKS:** Pipeline cost totals showed artificially low numbers because missing cost data silently defaulted to $0. Adding a warning when `costUsd === undefined` makes the data gap visible without breaking the pipeline.
- **EVIDENCE:** Phase 4 K3 fix — `cost-tracker.ts` silently turned `undefined` cost into `$0`. After adding a warning, operators can see exactly which agents failed to report cost data.
- **DESIGN IMPLICATION:** Any `value ?? 0` or `value ?? ""` pattern on externally-sourced data should log when the fallback is triggered.

### P46 — Test Spawner Parsing Against Real CLI Output

- **WHAT:** Always verify agent output parsing against the actual CLI tool's output format, not an assumed shape. Run the real tool once and capture its output structure before writing the parser.
- **WHY IT WORKS:** External CLI tools change output formats between versions. The claude CLI `--output-format json` returns a JSON array of event objects (init, assistant, result), not a single flat object. The cost field is `total_cost_usd`, not `cost_usd`. Parsing assumed the wrong shape, producing $0 costs for every agent.
- **EVIDENCE:** Phase 5 K6 — `shell.ts` did `JSON.parse(stdout)` expecting `{result, cost_usd, ...}` but got `[{type:"system",...}, {type:"result", total_cost_usd:0.05,...}]`. All cost data was lost until fixed.
- **DESIGN IMPLICATION:** When integrating with external tools, add an integration test that runs the real tool and asserts the parsed output shape. Don't rely on documentation alone.

### P47 — Compliance as Separate Stage (Plan-Adherence Check)

- **WHAT:** Run a dedicated compliance-reviewer agent between BUILD and VERIFY to check that every step file instruction has a corresponding implementation. Separate from functional verification (ACs/ECs).
- **WHY IT WORKS:** ACs/ECs verify "does the code work?" but not "did the agent follow all instructions?" Doc comments, test coverage completeness, and secondary features fall through the AC/EC model. A separate compliance stage catches structural omissions before VERIFY begins.
- **EVIDENCE:** Phase 5 dogfood — ENH-03 review found 5 skipped instructions. After adding compliance stage, US-02 had a compliance gap detected and auto-fixed before reaching VERIFY. 4/4 stories committed with full plan adherence.
- **DESIGN IMPLICATION:** Plan adherence and functional correctness are orthogonal concerns. Keep them in separate stages with separate agents to avoid prompt confusion and enable independent retry logic.

### P48 — Test Gate Conditions Against Actual Upstream Output

- **WHAT:** When one agent's output shapes another agent's gate condition, test the gate against the actual upstream agent's output — not assumed ranges. Gate conditions can become unreachable if the upstream agent's behavior changes.
- **WHY IT WORKS:** In multi-agent pipelines, agents evolve independently. A downstream gate (e.g., "decompose if 3+ sourceFiles") may never trigger if the upstream agent (planner) consistently produces output below the threshold (1 file per story). Testing the gate against real upstream output catches dead-code gates early.
- **EVIDENCE:** FW-01 dogfood — the SIZE-BOUND gate (3+ sourceFiles) never triggered across 5 PRDs because the planner always creates 1-file stories. Removing the gate and letting `complexity: "high"` be the only filter produced useful sub-tasks on the first attempt.
- **DESIGN IMPLICATION:** When adding gates in multi-agent pipelines, verify the gate condition is actually reachable given upstream agent behavior. Prefer semantic gates (complexity level) over numeric gates (file count) when the numeric threshold depends on another agent's decomposition strategy.

### P49 — Phase-Level Compliance Gate (Plan-vs-Implementation Eval)

- **WHAT:** After execution and before smoke tests, spawn a stateless eval agent to verify every item, step, test, and design decision in the phase plan has a corresponding implementation in the codebase. Binary PASS/FAIL per item with file:line evidence.
- **WHY IT WORKS:** Functional tests check "does the code work?" but not "did we build everything the plan says?" A phase can pass 100% of unit tests while missing planned doc comments, planned test files, or planned design decisions that were never assigned to a story. The compliance gate checks the orthogonal axis of plan adherence.
- **EVIDENCE:** Phase 6 compliance gate: 80/80 items PASS. During Phase 5 (ENH-03), a manual review found 5 gaps where code worked but plan instructions were skipped — those gaps were only caught because a human manually compared plan to code. The compliance gate automates this.
- **DESIGN IMPLICATION:** Run every phase, no exceptions. Cost is ~$0.50-2.00 (single Sonnet agent, read-only). Place between EXECUTION and SMOKE TEST GATE — catches missing items before you spend time debugging tests for code that doesn't exist yet. Human reviews FAIL items (fix / defer with rationale / descope).

### P50 — Additive Optional Fields for Schema Evolution

- **WHAT:** When extending a JSON schema, add new fields as optional with sensible defaults. Auto-upgrade existing data at load time. No version bump needed for additive changes.
- **WHY IT WORKS:** Optional fields with auto-upgrade preserve backward compatibility without migration scripts. Existing data loads cleanly (missing fields get defaults), new data uses the extended schema. Differentiating log levels (debug for intentional absence vs warn for misconfiguration) prevents false alarms while keeping real issues visible.
- **EVIDENCE:** Phase 6 added `modules?: Module[]` to ExecutionPlan and `moduleId?: string` to Story. All existing single-repo plans auto-upgraded transparently at load time. Schema version stayed at `2.0.0`. Zero migration needed across 48 test files.
- **DESIGN IMPLICATION:** Prefer additive optional fields over breaking schema changes. Auto-upgrade at the load boundary (not at write time). Use debug-level logging for expected absence and warn-level for genuine misconfiguration (P45).

### P51 — Resolve Relative Paths to Absolute Before Cross-Context Comparison

- **WHAT:** When comparing file paths from different working directory contexts, resolve to absolute paths first. Raw relative path comparison produces false positives across module boundaries.
- **WHY IT WORKS:** Two stories in different modules can both reference `src/index.ts` — these are different files in different directories. Comparing the raw strings would flag them as overlapping and serialize them unnecessarily. Resolving against each story's `moduleCwd` before comparison ensures only true file-level conflicts are detected.
- **EVIDENCE:** Phase 6 `filterNonOverlapping()` was updated to resolve `sourceFiles` to absolute paths using each story's `moduleCwd`. Without this, cross-module stories with identical relative paths would be falsely serialized, defeating parallel execution.
- **DESIGN IMPLICATION:** Any code comparing file paths from multiple contexts (different CWDs, different modules, different repos) must normalize to absolute paths first. Apply this rule uniformly: overlap detection, modified-files computation, and agent input file resolution.

---

## Quick Reference: Pattern → Enforcement Tier

| Pattern | Tier | Compliance |
|---------|:----:|:----------:|
| P1 Named rules + score caps | 1 | 100% |
| P2 Tool-call sequencing | 2 | 90%+ |
| P3 Always-loaded placement | 1 | 100% |
| P4 Wrong/Right examples | 3 | 70-90% |
| P5 Dual-critique pipeline | — | Process |
| P6 Mechanical detection | 2 | 100% |
| P11 External artifacts | 2 | 90%+ |
| P12 ELI5 forcing function | 3 | 70-90% |
| P13 Compliance hierarchy | — | Meta |
| P15 Pre-written verification | 2 | 100% |
| P16 Self-contained step files | 2 | 100% |
| P17 Binary ACs | 2 | 100% |
| P18 Three-view tracking | — | Process |
| P19 Idempotent automation | — | Process |
| P20 Manager+subagent loop | 2 | 93.75% first-pass |
| P21 Fix-suggest → retry | 2 | 100% recovery |
| P22 JSONL audit trail | — | Process |
| P23 Dependency-wave parallelism | — | Process |
| P24 Three-file tracking | — | Process |
| P25 Scan for keywords anywhere | 2 | 100% (projected) |
| P26 Smoke test breaks false-positives | 2 | 100% (projected) |
| P27 Tight scope = first-pass success | — | 100% (11 stories) |
| P28 Spec quality drives code quality | — | Evidence |
| P29 Explicit finalization step | — | Process |
| P30 Concrete PRD examples | — | Evidence |
| P31 Report verdict placement | 2 | 100% (projected) |
| P32 Config-as-parameter threading | — | Process |
| P33 vi.mock inline factory | — | Process |
| P34 Strict output contract | 2 | 100% (enforced) |
| P35 Marker-based section preservation | — | Process |
| P36 Fail-fast baseline guard | 2 | 100% (enforced) |
| P37 Multi-agent pipeline (split→parallel→assemble) | — | Process |
| P38 Two-batch producer→consumer stage | — | Process |
| P39 Non-fatal enrichment + corruption detection | — | Process |
| P40 Cross-phase context injection via role mapping | — | Process |
| P41 Stdin prompt passing (not CLI args) | 1 | 100% (enforced) |
| P42 Tool permission must match output contract | 1 | 100% (enforced) |
| P43 Single source of truth for EC commands | — | Process |
| P44 Loud failure on parse errors | 1 | 100% (enforced) |
| P45 Warn on missing data defaults | 1 | 100% (enforced) |
| P46 Test spawner parsing against real CLI output | — | Process |
| P47 Compliance as separate stage | — | Process |
| P48 Test gate conditions against upstream output | — | Process |
| P49 Phase-level compliance gate | — | Process |
| P50 Additive optional fields for schema evolution | — | Process |
| P51 Resolve relative paths before cross-context comparison | — | Process |

### P52 -- [Graduated from memory.md]
- WHAT: TypeScript projects need tsconfig.json — US-03/US-04 had typecheck failures due to missing tsconfig with `"lib": ["ES2022"]`.
- WHY IT WORKS/FAILS: Observed across multiple stories
- EVIDENCE: Graduated from memory.md (PATTERNS)
- DESIGN IMPLICATION: Apply this pattern/lesson in future work


### P53 -- [Graduated from memory.md]
- WHAT: Agent-generated code follows proven patterns without prompting: lookup tables for state machines (US-02), Map<string,T> for ordered collections (US-03), spread operator for immutability (US-02), runtime validation at API boundaries (US-03). Quality comes from spec clarity, not code-level instructions.
- WHY IT WORKS/FAILS: Observed across multiple stories
- EVIDENCE: Graduated from memory.md (PATTERNS)
- DESIGN IMPLICATION: Apply this pattern/lesson in future work


### P54 -- [Graduated from memory.md]
- WHAT: Explicit finalization (commit + state update) must be a mandatory pipeline phase. Run-04 US-01/US-04 re-entered 2x each because no agent executed finalization. (P29)
- WHY IT WORKS/FAILS: Observed across multiple stories
- EVIDENCE: Graduated from memory.md (PATTERNS)
- DESIGN IMPLICATION: Apply this pattern/lesson in future work

### P55 -- Evidence-gating at 100% compliance eliminates writing-stage regressions
- WHAT: When Drafter and Corrector stages use the `VERIFIED: <evidence>` / `UNVERIFIED` format for every factual claim at exactly 100% compliance, zero regressions occur. At sub-100%, regressions return.
- WHY IT WORKS: The format forces the writer to re-verify each claim at write time, creating a natural double-check that catches contradictions before they enter the document. The compliance rate itself may also signal overall rigor.
- EVIDENCE: R9 (82%) -> 3 regressions. R10 (100%) -> 0. R11R (100%) -> 0. R12 (95%) -> 4 regressions. 4/4 data points. The threshold appears to be exactly 100% -- even 95% correlates with regressions.
- DESIGN IMPLICATION: Make evidence-gating a hard gate in writing-stage prompts, not a measured metric. Prompt should include: "If you cannot provide evidence for any verification claim, STOP and flag it as UNVERIFIED rather than proceeding."

### P56 — Research-First Delegation (Research Agent → Working Agent)

- **WHAT:** For non-trivial tasks, spawn a dedicated research subagent that gathers context (reads files, searches code, maps dependencies) and returns a structured brief. The working agent receives the brief and executes without doing exploration itself.
- **WHY IT WORKS:** Working agent context stays clean — no exploration noise, no dead-end searches, no wasted tokens on files that turn out to be irrelevant. The research agent can be aggressive (read 10+ files) because its context is disposable. The working agent gets only what it needs.
- **EVIDENCE:** forge_generate 8-session implementation: every session prompt began with explicit "Read these files for context" lists assembled by the planning agent. 91/92 ACs passed on first implementation. forge_coordinate sessions plan follows the same pattern. P14 (subagent delegation) measured at 90%+ compliance. P40 (cross-phase context injection) measured and working. Contrast: sessions where agents explored ad-hoc showed higher revision rates and context exhaustion.
- **DESIGN IMPLICATION:** Build research-first into CLAUDE.md as a working principle (§8). Apply to plan mode (Explore agents gather context), implementation (research agents read and summarize), and review (stateless reviewers get clean diffs). Skip for trivial single-file tasks. The research brief is the handoff contract — it must be self-contained.

### P57 — Files Canonical, SQL Derived (Three-Tier Durability) [PROPOSED — not yet built]

- **WHAT:** When building a persistent memory/analysis layer over file-based artifacts, use a three-tier model: T1 (ephemeral per-project files, canonical source, gitignored), T2 (derived SQL index per-user, rebuildable from T1), T3 (durable ratified patterns in git, graduated from T2 via human review). SQL is never the source of truth — files are. DB corruption is a non-event because `rebuild` regenerates everything from T1.
- **WHY IT WORKS:** Avoids the most common database-backed-tool failure mode: divergent state between DB and files. Respects "File over memory" principle (constitution.md). Each tier has a clear role and rebuild rule, which means every downstream decision (where the SQL lives, who queries it, what gets promoted) falls out mechanically once the tiers are defined.
- **EVIDENCE:** Proposed during forge_coordinate planning (2026-04-09). forge-harness `.forge/` is gitignored (verified at `.gitignore:3`) — raw run records are T1 ephemeral local state. `hive-mind-persist/` (P1..P56, git-tracked) is T3 durable shared patterns. The missing T2 (SQL cross-project index) was identified as the gap that prevents cross-project analysis and improvement planning. forge_coordinate's PH-01 decisions (RunRecord extension with storyId/evalVerdict/estimatedCostUsd, tagged discriminated union, graduateFindings) accidentally produce the exact ingestion contract T2 needs — no rework required once the indexer is built. NOT YET VALIDATED IN PRACTICE — evidence will come from the first indexer + `/recall` implementation.
- **DESIGN IMPLICATION:** When a project has file-based state that needs querying at scale, don't migrate to SQL — derive SQL from files. Keep the file format stable (it's the API), make the SQL schema an internal detail (it's the index). The indexer must be idempotent (re-run = same result). Graduation from T2→T3 must require human ratification to prevent pattern inflation. Apply to: forge memory architecture, any future knowledge-base system, any audit/compliance layer.

### P58 — Scope Boundary Rule (Primitive vs Skill) [PROPOSED — not yet stress-tested beyond 8 tools]

- **WHAT:** A reusable decision rule for "should this be a forge primitive or a skill/external tool?" Multi-turn LLM + human approval loops + indeterminate duration + cross-project scope → skill or infrastructure. Mechanical signal aggregation on per-project state in a single shot → forge primitive. Apply the rule first, debate taste second.
- **WHY IT WORKS:** Removes subjective "it feels like it belongs in forge" debates. The boundary maps directly to the Intelligent Clipboard pattern: primitives are read-only brief assemblers ($0, single-shot, stateless); everything that breaks that contract lives outside. Prevents scope creep into forge-harness while keeping the composition architecture clean (session-level orchestration composes skills + primitives).
- **EVIDENCE:** Correctly classified 8 tools without exceptions: `/prd` (skill — interactive, LLM-powered), `/prototype` (skill — multi-turn, visual), `/recall` (skill — LLM-driven retrieval), `/project-index` (skill — on-demand classifier), `forge_plan` (primitive), `forge_generate` (primitive), `forge_evaluate` (primitive), `forge_coordinate` (primitive). Also correctly classified `forge_memory` as NOT a primitive (cross-project scope, LLM-powered relevance ranking). The rule was applied during forge_coordinate's Part 4 config schema triage and memory architecture design (2026-04-09).
- **DESIGN IMPLICATION:** When a new feature request arrives, apply this test before any design work: (1) Does it need multi-turn LLM? (2) Does it need human-in-the-loop? (3) Is duration indeterminate? (4) Does it cross project boundaries? If ANY answer is yes → skill or infrastructure. If ALL are no → forge primitive candidate. The boundary also implies: workflow external, schema internal — skills produce artifacts, forge-harness types define the schema those artifacts must conform to.

