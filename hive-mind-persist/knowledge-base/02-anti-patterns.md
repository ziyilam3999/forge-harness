# Anti-Patterns — What Fails and Why
<!-- AI-FIRST DOCUMENT: Feed this to the AI agent during protocol planning. -->
<!-- PURPOSE: Every pattern here FAILED with measured evidence. Do not repeat these. -->
<!-- If you find yourself proposing something similar to an entry below, STOP and redesign. -->

## How to Use This File

You are designing a new AI agent protocol. Every anti-pattern below was tried, measured, and **confirmed to fail**. Before proposing any rule or mechanism, scan this list. If your proposal matches an anti-pattern, you must either:
1. Explain why your context is fundamentally different, OR
2. Redesign to avoid the failure mode

Each entry includes:
- WHAT: The anti-pattern in one sentence
- WHY IT FAILS: Root cause
- EVIDENCE: Measured failure
- AVOID BY: What to do instead

---

## Critical Anti-Patterns (Will Definitely Fail — Highest Priority to Avoid)

### F2 — Behavioral Prose Without Consequences

- **WHAT:** Rules phrased as "the agent should do X" without any mechanical consequence for non-compliance.
- **WHY IT FAILS:** Agents optimize for completing the user's task. Rules without consequences are overhead with no enforcement.
- **EVIDENCE:** 17% real-world compliance for prose rules. 0% in the 50-response migration session.
- **AVOID BY:** Every rule needs a named identifier and a mechanical consequence (score cap, gate failure, or output requirement). If you can't define a consequence, the rule is advisory — label it explicitly as optional.

### F9 + F18 — Self-Scoring / Self-Grading Bias

- **WHAT:** Allowing the agent to score its own compliance. The agent that wrote the code also grades it.
- **WHY IT FAILS:** Conflict of interest. The agent has implicit incentive to report high compliance. Self-knowledge of expected outputs primes correct-looking responses.
- **EVIDENCE:** 64pp gap between simulation scores (83%) and real-session audit (19%). Self-assessment inflates by 10-15pp. 26pp gap between simulated compliance (98%) and real compliance (72%).
- **AVOID BY:** Use binary mechanical checks (command output) for verification. For subjective quality, use human spot-checks or independent subagent evaluation. Never trust the executor to grade its own work on subjective criteria.
- **EXCEPTION:** Binary ACs + mechanical verification = self-grading is acceptable (P17). File exists? Count matches? Command output correct? These are objective.

### F23 — Platform System Prompt Overrides Protocol

- **WHAT:** Protocol rules can be overridden by the AI platform's built-in system prompt. VS Code's "keep answers short" directive overrides verbose gate ceremony requirements.
- **WHY IT FAILS:** The instruction priority hierarchy is: Platform system prompt > user-provided instructions > rules files. Protocol rules operate at a lower priority level and lose every conflict.
- **EVIDENCE:** 0/50 responses followed any protocol gate in VS Code Copilot Chat, despite rules being in copilot-instructions.md. The "keep answers short" directive won every conflict.
- **AVOID BY:** Design rules that work WITH the platform, not against it. If the platform wants brevity, make rules brief. Don't require 15-line ceremony blocks when the platform says "1-3 sentences." Design compact, inline markers instead of verbose blocks.

### F19 — Conversation Summary Erases Behavioral Context

- **WHAT:** When the AI platform summarizes long conversation history, factual state is preserved but behavioral habits (gate discipline, formatting patterns) are lost.
- **WHY IT FAILS:** Summarization compresses content intelligently but doesn't preserve meta-behavioral patterns. The agent doesn't "remember" how it was formatting responses.
- **EVIDENCE:** Post-summary responses had zero gates across 4 session boundaries in the migration. Agent reverted to raw execution mode each time.
- **AVOID BY:** Don't rely on conversation memory for compliance. Instead: (1) put rules in always-loaded files that get re-read each turn, (2) use external tracking files that persist independently of conversation state, (3) design rules that trigger from file content, not conversation history.

---

## Structural Anti-Patterns (Protocol Design Failures)

### F1 — Rules in Wrong File for Target QCS Tier

- **WHAT:** Adding a rule to a file that isn't loaded at the complexity level where the rule needs to fire.
- **WHY IT FAILS:** Rules in unloaded files have 0% compliance — they don't exist for the agent at that complexity level.
- **EVIDENCE:** Rules in GATES.md had 0% effect at QCS 0-1 because that file only loads at QCS 2+.
- **AVOID BY:** For every rule, answer: "At which complexity level does this need to fire?" → "Which file is loaded at that level?" Place the rule in that file.

### F5 — Loading-Tier Mismatch

- **WHAT:** Implementing a change in a file that loads at tier X, but the target behavior is at tier Y where that file doesn't load.
- **WHY IT FAILS:** The change is architecturally unreachable — like posting a sign inside a room nobody enters.
- **EVIDENCE:** LP Bootstrap added to GATES.md (QCS 2+), but target scenario ran at QCS 0-1 where GATES.md never loads.
- **AVOID BY:** Cross-check: "Does my target file load at the target complexity tier?" Test this before implementing.

### F6 — Section-Level Conditional Loading

- **WHAT:** Trying to load only part of a file: "load lines 1-35 but skip lines 36-88."
- **WHY IT FAILS:** AI agents load whole files. No mechanism supports partial-file reads at instruction time.
- **EVIDENCE:** Attempted with STYLES.md. Agents loaded the entire file regardless of annotations.
- **AVOID BY:** If content should be conditionally loaded, it must be in separate physical files.

### F7 — Cross-References Defeating Conditional Loading

- **WHAT:** An always-loaded file contains links to conditionally-loaded files. Agents follow the links, loading everything.
- **WHY IT FAILS:** Markdown links are invitations to read. Agents treat them as references to follow.
- **EVIDENCE:** COMMANDS.md linked to COMMANDS.flutter.md — agents loaded it regardless of conditional annotations.
- **AVOID BY:** Use plain-text references, not markdown links: "Project-specific commands loaded automatically per PROJECT_DETECTION.md." Never hyperlink to conditional files from always-loaded files.

### F13 — Content Duplication Across Files

- **WHAT:** Copying the same rules into multiple files hoping agents notice them more.
- **WHY IT FAILS:** Zero compliance uplift from duplication. Creates sync divergence when one copy is updated but not the other. Wastes tokens.
- **EVIDENCE:** SESSION.md duplicated turn-health rules from GATES.md. Zero uplift, ~80 wasted tokens.
- **AVOID BY:** Single source of truth with cross-reference stubs (plain text, not links).

### F14 — Always-Loading Rarely-Triggered Content

- **WHAT:** Bundling content that triggers rarely (audit workflows, advanced examples) into files that load on every task.
- **WHY IT FAILS:** Token cost is proportional to load frequency, not trigger frequency. Content loaded 100% of the time but triggered 10% wastes 90% of its token cost.
- **EVIDENCE:** Post-Hoc Audit (~520 tokens) loaded at QCS 2+ but triggered only under specific conditions.
- **AVOID BY:** Lazy-load: extract to separate files with plain-text stubs. Load only when the trigger condition is met.

### F26 — UAT as Code Inspection Instead of Command Execution

- **WHAT:** Designing executable UAT commands (shell one-liners that output PASS/FAIL) but having the UAT subagent do manual code review instead of running them.
- **WHY IT FAILS:** Code inspection can miss runtime errors, import failures, and integration bugs that only manifest when the code actually runs.
- **EVIDENCE:** 0% UAT command execution rate in Hive Mind implementation — all 89 ACs were verified by code inspection, not by running the shell commands. The commands were designed for execution but the subagent defaulted to code review.
- **AVOID BY:** UAT subagent prompt must explicitly state: "Run each UAT command via Bash. Report exact stdout. Code inspection alone is insufficient."

### F27 — Output Contract Treated as Suggestion

- **WHAT:** Step files list specific required exports/files in their OUTPUT section, but the implementer treats them as suggestions and "improves" the API by substituting different exports.
- **WHY IT FAILS:** Downstream consumers depend on the exact exports listed. Substituting different ones breaks integration points that only surface later.
- **EVIDENCE:** US-13: step file listed 11 exports, implementer delivered 12 different ones — dropped 4 required exports while adding granular `add*` methods. Caused the only failure in 15 stories.
- **AVOID BY:** Mark output contracts as mandatory: "MANDATORY EXPORTS — Every export below MUST exist. Missing = automatic FAIL. Additional exports are allowed."

---

## Behavioral Anti-Patterns (Agent Behavior Failures)

### F8 — Rubric-Only Changes Without Examples

- **WHAT:** Changing scoring criteria without providing concrete examples of the new expected behavior.
- **WHY IT FAILS:** Agents don't spontaneously adopt new behaviors from abstract criteria. They need to see what "right" looks like.
- **EVIDENCE:** Plan File rubric change: R1 +0.17pp (optimistic), R2 -0.27pp (penalty for missing). Net ~+0.04pp.
- **AVOID BY:** Every rubric change must include a Wrong/Right example pair showing the new behavior.

### F11 — Internal Reasoning Checklists

- **WHAT:** Rules that say "before doing X, mentally confirm Y and Z." No observable output.
- **WHY IT FAILS:** Produces no artifact. Cannot be audited, scored, or verified. The agent may or may not actually perform the check — you'll never know.
- **EVIDENCE:** SC-1 (pre-flight mental checklist) had zero measured compliance uplift.
- **AVOID BY:** Replace with external artifacts. "Create a plan file with fields X, Y, Z" instead of "think about X, Y, Z."

### F12 — Response Footers/Suffixes for Context Retention

- **WHAT:** Adding gate lists or checklists at the end of responses to remind the agent what to do next.
- **WHY IT FAILS:** Post-hoc — by the time the footer is written, all decisions are already made. Ephemeral — vanishes after conversation summary.
- **EVIDENCE:** Both Strategy A (OPEN suffix) and Strategy B (footer block) evaluated and rejected.
- **AVOID BY:** Use persistent external files (step files, tracking files) that survive across turns.

### F20 — Verbose Gate Ceremony vs Brevity Directive

- **WHAT:** Requiring multi-line ceremony blocks (OPEN + THINK + GO + TEST + LEARN = 5-15 lines) when the platform says "keep it short."
- **WHY IT FAILS:** Contradictory instructions. Agent resolves by following the higher-priority instruction (platform system prompt).
- **EVIDENCE:** 0/50 responses included any gate block across an entire migration session in VS Code Copilot Chat.
- **AVOID BY:** Design compact protocol markers. One-line gates. Inline annotations. Work with the platform's communication style, not against it.

### F21 — Todo Lists as Verification Substitute

- **WHAT:** Using todo/task tracking tools as proof of work completion. Agent marks tasks "done" without actually doing them.
- **WHY IT FAILS:** Ticking a box produces a completion signal without verification. There's no mechanism to confirm the work was actually performed.
- **EVIDENCE:** "Type-check & tests" marked complete without running any commands. User caught the premature completion.
- **AVOID BY:** Verification must be independent of status tracking. "Mark done" should require pasting terminal output or command result as evidence.

### F24 — Multi-Agent Pipeline in Single-Agent Environment

- **WHAT:** Designing roles (Executor, UAT Runner, Evaluator, Fix Advisor) when only one agent context exists.
- **WHY IT FAILS:** Role-playing is not independence. The same agent that wrote the code will rubber-stamp its own evaluation. Ceremony erodes over time — full role entries → abbreviated → dropped.
- **EVIDENCE:** EVL role degraded from full entries (Steps 1-5) to dropped entirely (Steps 12-15) in a 15-step migration.
- **AVOID BY:** If the platform has one execution context, design for one agent. Use binary mechanical checks instead of role-based evaluation. For genuine independence, involve a human spot-check.

### F25 — Relying on Conversation Memory for Compliance

- **WHAT:** Assuming the agent will maintain behavioral patterns throughout a long conversation or across session boundaries.
- **WHY IT FAILS:** Conversation summaries preserve facts but erase behavioral meta-patterns. Each new session starts with raw execution mode.
- **EVIDENCE:** Gate compliance dropped to 0% after each of 4 session boundaries in the migration.
- **AVOID BY:** Anchor compliance in persistent files, not conversation memory. Re-load behavioral expectations from files every turn.

### F28 — Skipping Re-UAT After Fix

- **WHAT:** After applying a fix-report, verifying only via compilation (tsc) or grep instead of re-running the full UAT cycle.
- **WHY IT FAILS:** Compilation success proves type correctness, not functional correctness. The original failure conditions may not be resolved.
- **EVIDENCE:** US-13 fix applied 7 patches, verified only by `tsc --noEmit` + grep for export names. No full UAT re-run. The fix happened to be correct, but this was luck — not process.
- **AVOID BY:** Protocol rule: "After fix-report is applied, re-spawn UAT runner against ALL ACs. Compilation pass alone is insufficient."

### F29 — Inconsistent Verification Depth (Ad-Hoc Stage Skipping)

- **WHAT:** Running full 3-stage verification (impl+uat+eval) for some stories but only 1-stage (impl only) for others, with no clear rule for when to abbreviate.
- **WHY IT FAILS:** Creates blind spots. Stories that skip UAT/eval may have latent defects that surface later as integration failures.
- **EVIDENCE:** Only 40% (6/15) of Hive Mind stories got full 3-stage evaluation. 33% (5/15) got impl-report only. The stage-skipping appeared to be driven by context pressure, not explicit criteria.
- **AVOID BY:** Define explicit skip criteria upfront: e.g., "3-stage required for complexity=high; 2-stage for medium; 1-stage for low."

### F30 — In-Memory Tracking Without Atomic Disk Writes

- **WHAT:** Updating tracking state (mindmap, logs) in-memory but not flushing to disk before spawning the next subagent or before context can be lost.
- **WHY IT FAILS:** Context loss (session breaks, token exhaustion) discards in-memory state. Tracking files become stale — showing "in-progress" for stories that are actually complete.
- **EVIDENCE:** After a session break in Hive Mind, mindmap showed US-05/09/10 as "in-progress" despite code being on disk. Required manual verification and 7 backfilled log entries.
- **AVOID BY:** Write tracking files to disk atomically after each status transition, before spawning the next subagent. On startup, reconcile files-on-disk vs tracking status.

---

## Protocol Meta Anti-Patterns (Process Failures)

### F4 — Incremental Tuning Past Diminishing Returns

- **WHAT:** Continuing to tweak parameters when measurements show near-zero net movement.
- **WHY IT FAILS:** Parameter volatility exceeds net movement — changes are noise, not signal.
- **EVIDENCE:** v10.0-v10.2: 0.57pp gate-level swings compressed to -0.03pp net across 3 versions.
- **AVOID BY:** Set decision gates: "2 consecutive versions with <0.03pp net movement = stop tuning, pivot to architectural change."

### F10 — Single-Pass Improvement

- **WHAT:** Making protocol changes with only self-review, no independent critique.
- **WHY IT FAILS:** Self-review finds ~20% of bugs. The author has blind spots about their own design.
- **EVIDENCE:** Pre-v10.21.0 changes routinely had critical flaws caught in later audits.
- **AVOID BY:** Always use at least one independent critique round. Two rounds catch both strategic and tactical errors.

### F15 — Optimization Claims Without Token Measurement

- **WHAT:** Planning token reductions without measuring actual file sizes and loading paths.
- **WHY IT FAILS:** Unmeasured claims are fictional. The causal chain is: file exists → file referenced → file loaded → tokens consumed. Break at any link = zero savings.
- **EVIDENCE:** "-56% reduction" claim invalidated when the target file was discovered to not load at the relevant tier.
- **AVOID BY:** Build an empirical token inventory before proposing any optimization. Measure, don't estimate.

### Protocol Creep (Not Numbered — Meta-Pattern)

- **WHAT:** The protocol grows faster than the product it serves. Protocol evolution sessions outnumber product development sessions.
- **WHY IT FAILS:** The protocol becomes the primary project. 33 sessions on protocol vs 15 on the app.
- **EVIDENCE:** Protocol grew from ~500 tokens to ~70,000 tokens across 30+ versions. Real compliance peaked at 72%, not 98%.
- **AVOID BY:** Set a hard token budget for the entire protocol. Track the ratio of protocol sessions to product sessions. If it exceeds 1:2, stop protocol work and build product.

### F31 — Return-Type Changes Without Caller Audit

- **WHAT:** Changing a function's return type without documenting and updating all call sites.
- **WHY IT FAILS:** Every caller that assigns or compares the return value breaks. The fix for one bug creates cascading failures.
- **EVIDENCE:** E2E-bugfix: Round 1 CRITICAL fixed `parseReportStatus` by changing return type. Round 2 CRITICAL found 3 callers + tests that would break.
- **AVOID BY:** List every call site with the required change. Actually grep — don't defer to implementer.

### F32 — Hollow "Grep for Others" Advice

- **WHAT:** Plan says "grep for other instances" without performing the grep and listing results.
- **WHY IT FAILS:** Creates illusion of thoroughness while deferring actual work. Implementers may skip it.
- **EVIDENCE:** E2E-bugfix Bug 2: "grep for stale-read patterns" without listing files. Critic-1 flagged; corrector added concrete checklist.
- **AVOID BY:** If the plan says "grep for X," include the results or exact command + expected count.

### F33 — Ambiguous File Locations in Plans

- **WHAT:** Plan specifies fix should go in "file-A and/or file-B" instead of one location.
- **WHY IT FAILS:** Ambiguity forces implementer to guess. Wrong choice = fix in wrong code path.
- **EVIDENCE:** E2E-bugfix Bug 5: "report-stage.ts and/or execute-learn.ts" → resolved to report-stage.ts only.
- **AVOID BY:** Research phase determines exact location. One file, not a menu.

### F34 — First-Word Regex on Agent Free-Text

- **WHAT:** Using a regex that captures only the first `\w+` after a label to determine status from agent-written text.
- **WHY IT FAILS:** Agents add qualifiers, counts, emojis, and decorators before the actual keyword. The first word is often not the status keyword.
- **EVIDENCE:** Run-01: `✅ PASS` → captured `PASS` (lucky, emoji skipped). Run-02: `✅ ALL PASS` → captured `ALL` (not in keyword list → false FAIL). `13/13 RUNTIME TESTS PASS` → captured `13` (not in keyword list → false FAIL). 2 of 4 stories false-failed.
- **AVOID BY:** Scan for the LAST occurrence of a known keyword (PASS/FAIL/PASSED/FAILED) in the line. Or require structured output format (## STATUS: PASS) and fall back to keyword scanning.

### F35 — All-or-Nothing Verify with No Recovery Path

- **WHAT:** Verify loop runs max N attempts, then permanently marks the story as failed. No human-in-the-loop, no "parser is uncertain — pause and ask", no way to override.
- **WHY IT FAILS:** When the failure is a parser bug (not a code bug), the fix pipeline wastes attempts trying to "fix" correct code. After max attempts, the story is permanently marked failed despite being correct.
- **EVIDENCE:** Run-02: US-03 and US-04 had correct code and passing tests on all 3 attempts. Parser misread all 3 times. Stories permanently marked failed. No recovery without manual intervention.
- **AVOID BY:** When parser confidence is "default" (no keyword matched), don't auto-mark as FAIL. Instead: log a warning, present the raw report to the orchestrator, and optionally pause for human review. Distinguish "verified FAIL" from "unable to determine."

### F36 — Grep-Only Eval Criteria

- **WHAT:** Evaluation exit criteria that only check for text patterns (e.g., `grep "export class TaskList"`) without runtime verification.
- **WHY IT FAILS:** A grep match for `export class TaskList` in a .ts file doesn't prove the class works at runtime. Missing compiled output, import errors, and syntax issues are invisible to grep.
- **EVIDENCE:** Run-02: US-03 and US-04 eval reports passed all exit criteria by matching .ts source text. Neither executed code. Both had runtime failures (missing .js, phantom tests).
- **AVOID BY:** Pair every grep check with a runtime assertion. At minimum: `node -e "require('./module')"` to prove the module loads.

### F37 — Phantom Test Files

- **WHAT:** Test files that define inline copies of the function under test instead of importing from the real source module.
- **WHY IT FAILS:** These tests pass even if the real source is deleted. They test a hardcoded copy, not the actual implementation.
- **EVIDENCE:** Run-02 US-03: `test-transition-simple.js` and `test-valid-transitions.js` defined inline copies of `transition()` instead of importing from `src/task.ts`. Both flagged independently by learning reports.
- **AVOID BY:** Before accepting test results, verify all test files contain `require()` or `import` pointing to the real source path. Reject results from files without real imports.

### F38 — Fabricated Test Output

- **WHAT:** Test agents record synthesized output strings (e.g., `TSCPASS`) instead of capturing actual command output (which may be empty on success).
- **WHY IT FAILS:** Fabricated output undermines report trust. If the output wasn't captured from a real command, the report doesn't prove anything was executed.
- **EVIDENCE:** Run-04 US-01 test-report-2: recorded `TSCPASS` as stdout from `npx tsc --noEmit`, but `tsc` produces no stdout on success — only exit code 0. The string was invented.
- **AVOID BY:** Test agents must capture actual command output. If a command succeeds silently, write `(no output, exit code 0)`. Never synthesize output strings.

### F39 — Redundant Re-Testing of Unchanged Code

- **WHAT:** Running the same tests against unchanged code across multiple verify attempts, expecting different results.
- **WHY IT FAILS:** Same code + same tests = same results. Re-testing provides no new information and wastes full orchestration cycles.
- **EVIDENCE:** Run-04 US-01: Tests ran identically across 3 attempts because implementation was never modified. All 3 produced 4/4 PASS. The failure was a parser bug, not a code bug — but the pipeline kept retrying implementation/test cycles.
- **AVOID BY:** Track whether source files changed between attempts. If unchanged and test results are available, skip to finalization or escalate to human review instead of retrying.

### F40 — Misattributing Pipeline Failures to Code

- **WHAT:** When the pipeline reports FAIL, assuming the implementation code is broken and attempting to fix it — without first checking pipeline logs to see what the parser actually read.
- **WHY IT FAILS:** Parser bugs and report format issues cause false FAILs. If the code is correct but the parser misread the report, "fixing" the code wastes an entire fix cycle and changes nothing.
- **EVIDENCE:** Run-05 US-04 attempt 1: fix attempt reviewed `src/convert.ts` (which was correct, 25/25 tests passing) and declared "no action needed" — missing the actual blocker (label-free verdict format in the report). The code was never the problem; the report format was.
- **AVOID BY:** When pipeline says FAIL but tests say PASS, check `manager-log.jsonl` first to see what excerpt the parser actually read. Diagnose the pipeline before diagnosing the code.

### F41 — Fallback Write of Raw Stdout to Output File

- **WHAT:** When an agent fails to create its output file (via Write tool), the spawner falls back to writing raw `stdout` content to disk as the output file.
- **WHY IT FAILS:** With `--print` + `--output-format json`, stdout contains the full session conversation as JSON — not the expected markdown report. Downstream parsers can't extract status from JSON blobs → default to FAIL. The fallback silently converts a spawn failure into corrupted data.
- **EVIDENCE:** Phase 2 Tier 3: both stories produced raw JSON session logs as output files. Parser correctly returned "default" confidence. Haiku agents especially prone — respond conversationally instead of using Write tool.
- **AVOID BY:** Remove the fallback entirely (P34). If the output file doesn't exist after spawn, return failure immediately. A loud failure is always better than silent data corruption.

### F42 — Prompt as Command-Line Arg on Windows

- **WHAT:** Passing multi-line agent prompts as positional arguments to `spawn()` on Windows with `shell: true`.
- **WHY IT FAILS:** On Windows, `spawn("cmd", args, { shell: true })` constructs a cmd.exe command line that interprets `#`, newlines, and other special characters. Multi-line prompts are garbled — the agent receives only fragments (e.g., just `##` from `## ROLE\nYou are...`).
- **EVIDENCE:** Phase 4 Tier 3 (Bug 16): Agent's thinking showed "The user sent an empty message (just '##')." The entire prompt was lost. Exit code 0 but no work done.
- **AVOID BY:** Pipe the prompt via stdin (`child.stdin.write(prompt); child.stdin.end()`). Stdin bypasses the shell entirely (P41).

### F43 — Tool Permission Gap (Prompt Says "Use X" But X Not Allowed)

- **WHAT:** Agent prompt instructs "You MUST use the Write tool" but the agent's `allowedTools` list doesn't include Write.
- **WHY IT FAILS:** The prompt is a suggestion; the tool permission list is enforcement. The agent completes normally (exit 0) but can't use the required tool. The output file is never created, triggering the strict output contract failure.
- **EVIDENCE:** Phase 4 Tier 3 (Bug 17): 26 agent types had `READ_ONLY_TOOLS = ["Read", "Glob", "Grep"]` but were told to use Write. Every spawned agent failed to produce output.
- **AVOID BY:** Audit tool permissions whenever changing the output contract. If an agent must write a file, Write must be in its tool list (P42).

### F44 — Duplicate EC Sources Across Files

- **WHAT:** The same executable verification command appears in multiple files (e.g., `acceptance-criteria.md` and `US-XX-ecs.md`). When a fixer patches one file, the evaluator reads from the other.
- **WHY IT FAILS:** Fixer agents search for the failing command and patch the first file they find. The evaluator reads from a specific file (step file or ecs file). If these are different files, the fix never reaches the evaluator. All retries fail identically.
- **EVIDENCE:** Phase 4 Tier 3 (run-06, US-03): Fixer patched `acceptance-criteria.md:106`; evaluator read from `US-03-ecs.md:57`. Same grep -c bug persisted through 3 attempts, wasting 10+ minutes.
- **AVOID BY:** Store ECs in exactly one canonical file (P43). Reference by path, never copy.

### F45 — Empty Catch Block on Parse Error

- **WHAT:** `try { JSON.parse(stdout) } catch { /* comment only */ }` — parse error is silently swallowed.
- **WHY IT FAILS:** When agent output isn't valid JSON, the catch block hides the failure. Downstream code sees `undefined` but has no diagnostic information. Cost data, session IDs, and error context are lost. Debugging becomes "why is this undefined?" instead of "the agent returned HTML instead of JSON."
- **EVIDENCE:** Phase 4 K2: `shell.ts:136` had `catch { // JSON parse failed }`. During Phase 4 debugging, this made it impossible to determine whether agents were returning malformed output or returning nothing at all.
- **AVOID BY:** Every catch block must either (a) log the error + truncated input, (b) throw a new error, or (c) return a sentinel value that clearly indicates failure (P44).

### F46 — Silent Numeric Default When Data Is Missing

- **WHAT:** `costUsd ?? 0` or `durationMs ?? 0` without logging that the data was missing.
- **WHY IT FAILS:** Pipeline cost totals show artificially low numbers. Operators can't distinguish "agent actually cost $0" from "cost data was unavailable." Budget decisions are made on incomplete data.
- **EVIDENCE:** Phase 4 K3: `cost-tracker.ts` silently turned `undefined` cost into `$0`. Total pipeline cost showed $X but multiple agents had unreported costs.
- **AVOID BY:** Log a warning when using a default value for externally-sourced numeric data (P45). The fallback itself is fine — the silence around it is the bug.

### F47 — Assumed JSON Shape From External Tools

- **WHAT:** Parsing external CLI tool output by assuming a flat JSON object without testing against real output.
- **WHY IT FAILS:** The claude CLI `--output-format json` returns an array of event objects `[{type:"system",...}, {type:"assistant",...}, {type:"result", total_cost_usd:0.05,...}]`, not a single `{result, cost_usd}` object. Field names also differ (`total_cost_usd` vs `cost_usd`). Parsing the wrong shape produces silent data loss.
- **EVIDENCE:** Phase 5 K6: `shell.ts` parsed `JSON.parse(stdout)` as `Record<string, unknown>` and checked `parsed.cost_usd`. The array parse succeeded (arrays are valid JSON), but `cost_usd` on an array is `undefined`, so all costs defaulted to $0.
- **AVOID BY:** Run the real CLI tool once and capture its output shape. Write an integration test that asserts field extraction from the actual format (P46).

### F48 — Unconditional Per-Attempt Archiving

- **WHAT:** Archiving every retry attempt's output file regardless of whether retries actually occurred.
- **WHY IT FAILS:** On first-pass success, archives are identical copies of the main report file (`test-report-1.md` = `test-report.md`). This wastes disk space and clutters report directories, making it harder to distinguish stories that retried from those that passed cleanly.
- **EVIDENCE:** Phase 5 dogfood: US-02 and US-03 passed on first attempt but still had `test-report-1.md` and `eval-report-1.md` as redundant copies.
- **AVOID BY:** Only archive when `attempt > 1`. The main report file already contains the first attempt's output. Archive numbered copies only when retries create divergent content.

### F49 — Dual-Level Enforcement of Same Rule

- **WHAT:** Enforcing the same constraint as both a hard code check (gate in pipeline code) and an agent prompt rule, creating hidden coupling.
- **WHY IT FAILS:** When the code gate is modified (e.g., for testing or policy change), the agent still follows the old rule from its prompt and refuses to act. The two enforcement levels are not in sync, and the agent's refusal appears as "working correctly" but produces no useful output. This makes dogfood testing harder and creates confusion about which level is authoritative.
- **EVIDENCE:** FW-01 dogfood — SIZE-BOUND was enforced as `if (story.sourceFiles.length < 3) return []` in plan-stage.ts AND as a prompt rule "Only decompose if story has 3+ sourceFiles." Lowering the code gate to 1 still produced empty sub-tasks because the agent followed its prompt rule.
- **AVOID BY:** Enforce constraints at exactly one level. Use code gates for hard invariants (e.g., empty sourceFiles). Use prompt rules for behavioral guidance (e.g., how to split). If both levels must exist, the code gate should be strictly looser than the agent rule (superset), never the same condition.

### F50 — Exact String Match on LLM-Generated Section Headings

- **WHAT:** Using `content.includes("## Modules")` or similar exact string matches to detect sections in LLM-generated documents (SPEC, reports). Breaks when the LLM varies the heading.
- **WHY IT FAILS:** LLM heading format variance is high and irreducible. The same semantic section appears as `## Modules`, `## 2. Module Inventory`, `## Module Architecture`, `## Module Structure`, `## 3. Module Specifications` across runs. Exact match catches at most one variant.
- **EVIDENCE:** Phase 6 Tier 3 dogfood — 7 runs produced 5+ different heading formats for the modules section. K8 (parser), K9 (planner prompt), K10 (never called) all traced to exact string matching. Each fix required broadening the match pattern.
- **AVOID BY:** Use regex with common variants: `^## (?:\d+\.\s*)?Module`. When the section contains a table, also sniff table column names (e.g., require `path` and `role` columns) to disambiguate from similarly-named sections with different content. Never use `.includes("## ExactHeading")` for LLM output.

---

## Quick Scan: Failure Mode → Root Cause

| If You're Proposing... | Check Anti-Pattern | Root Cause |
|------------------------|-------------------|------------|
| A rule without a consequence | F2 | No enforcement = 17% compliance |
| A rule in a separate file | F1, F5 | May not load at target tier |
| Partial file loading | F6 | Agents load whole files |
| Links to conditional files | F7 | Links defeat lazy-loading |
| Internal "think about X" | F11 | No artifact = no verification |
| Verbose ceremony blocks | F20 | Platform brevity overrides |
| Agent self-evaluation | F9, F18 | 10-15pp inflation |
| Duplicating rules in multiple files | F13 | No uplift, sync risk |
| Scoring rubric without examples | F8 | Agents need to see "right" |
| Multi-agent roles in one context | F24 | Role-playing ≠ independence |
| Subagent delegation without execution enforcement | F26, F27 | Inspection ≠ execution; suggestion ≠ contract |
| Fix → compile → done (skipping re-UAT) | F28 | Compilation ≠ functional correctness |
| Skipping verification stages without criteria | F29 | Ad-hoc = blind spots |
| In-memory tracking without disk flush | F30 | Context loss = stale tracking |
| Changing return types in a fix plan | F31 | Callers break silently |
| "Grep for other instances" without results | F32 | Advice ≠ action |
| "File A and/or file B" | F33 | Ambiguity ≠ specification |
| First-word regex on agent output | F34 | First word ≠ status keyword |
| Max-attempts → permanent fail, no override | F35 | Parser bug ≠ code bug |
| Grep-only eval criteria | F36 | Grep ≠ runtime verification |
| Test files with inline function copies | F37 | Phantom tests ≠ real tests |
| Fabricated test output strings | F38 | Invented output ≠ proof |
| Re-testing unchanged code | F39 | Same input = same output |
| Fixing code when pipeline says FAIL but tests PASS | F40 | Parser bug ≠ code bug |
| Fallback-writing raw stdout to output file | F41 | Silent corruption > loud failure |
| Passing prompt as CLI arg on Windows | F42 | cmd.exe garbles multi-line strings |
| Prompt says "use Write" but Write not in allowedTools | F43 | Prompt ≠ enforcement |
| Same EC in multiple files, fixer patches wrong one | F44 | Duplicate source = infinite retry |
| Empty catch block on parse error | F45 | Silent failure = invisible bugs |
| Silent numeric default when data missing | F46 | $0 ≠ "data unavailable" |
| Assuming JSON shape from external CLI | F47 | Array ≠ object, field names differ |
| Archiving every attempt unconditionally | F48 | Identical copies on first-pass success |
| Enforcing same rule at code + prompt level | F49 | Hidden coupling, can't test independently |
| Exact string match on LLM heading | F50 | LLM heading variance is high and irreducible |

### F51 -- [Graduated from memory.md]
- WHAT: Grep-only eval criteria create false positives — eval reports passed by matching text patterns in .ts source, never executed code. Pair every grep check with a runtime assertion. (US-03, US-04)
- WHY IT WORKS/FAILS: Observed across multiple stories
- EVIDENCE: Graduated from memory.md (MISTAKES)
- DESIGN IMPLICATION: Apply this pattern/lesson in future work


### F52 -- [Graduated from memory.md]
- WHAT: Fix-1 agents trusted grep-only eval without runtime verification — declared "NO FIXES REQUIRED" without running the actual test suite. Fix agents must execute test commands independently. (US-03, US-04)
- WHY IT WORKS/FAILS: Observed across multiple stories
- EVIDENCE: Graduated from memory.md (MISTAKES)
- DESIGN IMPLICATION: Apply this pattern/lesson in future work

