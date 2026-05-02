# Design Constraints — Hard Limits That Cannot Be Broken
<!-- AI-FIRST DOCUMENT: Feed this to the AI agent during protocol planning. -->
<!-- PURPOSE: These are "laws of physics" — measured constraints the new protocol MUST respect. -->
<!-- Violating any of these guarantees failure regardless of how good the rules are. -->

## How to Use This File

You are designing a new AI agent protocol. The constraints below are **non-negotiable** — they are measured properties of AI agents and their platforms that cannot be changed by better rules or cleverer wording. Your protocol must work WITHIN these constraints.

For each constraint:
- CONSTRAINT: The hard limit in one sentence
- WHY IT'S HARD: What makes this a physical constraint, not a preference
- IMPLICATION: What this means for protocol design

---

## File Loading Constraints

### C1 — Enforcement Placement Principle

- **CONSTRAINT:** Rules only work when placed in the file the AI agent actually reads at the target complexity level.
- **WHY IT'S HARD:** AI agents are not aware of files they haven't loaded. A rule in an unloaded file has 0% compliance — not 10%, not 50%, but literally 0%.
- **IMPLICATION:** Before placing any rule, map out which files load at which complexity levels. Place rules in the file that loads for the target scenario.
- **CEILING:** Platform system prompts outrank ALL protocol files. If the platform says "be brief," no protocol file can override that. Design with the platform, not against it.

### C2 — Always-Loaded Token Budget

- **CONSTRAINT:** The main protocol file (copilot-instructions.md) has a practical token budget. Every rule added to it costs tokens on ALL tasks — even trivial ones.
- **WHY IT'S HARD:** Token context window is finite. Loading 5,000 tokens of rules for a "fix typo" task wastes 90%+ of those tokens.
- **IMPLICATION:** The main file should contain only the rules that apply to ALL tasks. Task-specific rules go in conditional files loaded at higher complexity levels. Target: main file ≤500 tokens.

### C4 — Whole-File Loading Only

- **CONSTRAINT:** AI agents load entire files. You cannot instruct an agent to "load lines 1-35 of this file but skip the rest."
- **WHY IT'S HARD:** No AI platform supports section-level file loading. The read mechanism is per-file, not per-section.
- **IMPLICATION:** Content that should sometimes NOT load must be in a separate physical file. Split files by loading condition, not by topic.

### C5 — Links Cause Eager Loading

- **CONSTRAINT:** Markdown links in loaded files cause agents to follow them and load the linked content — even if the linked file was meant to be conditionally loaded.
- **WHY IT'S HARD:** Links are invitations. Agents are trained to follow references to gather context.
- **IMPLICATION:** References to conditionally-loaded files must use plain text ("See PROJECT_DETECTION.md for details"), NOT markdown links (`[see here](PROJECT_DETECTION.md)`).

### C6 — Loading-Tier Cross-Check

- **CONSTRAINT:** For every rule change, verify: "Does the file containing this rule load at the tier where the rule needs to fire?"
- **WHY IT'S HARD:** A perfectly written rule in a file that doesn't load at the right tier has 0% impact.
- **IMPLICATION:** Maintain a loading-tier map. Before implementing any rule, trace: rule → file → loading condition → target task type. If there's a mismatch, the rule is architecturally unreachable.

---

## Platform & Environment Constraints

### C-PLATFORM-1 — Platform System Prompt Hierarchy

- **CONSTRAINT:** The instruction priority hierarchy is: Platform system prompt > copilot-instructions.md/CLAUDE.md > rules files > conversation history.
- **WHY IT'S HARD:** The platform system prompt is injected by the IDE at a higher priority than any user-provided file. The AI agent resolves conflicting instructions by following the highest-priority source.
- **IMPLICATION:** Never design rules that conflict with the platform's system prompt. If VS Code says "keep answers short," don't require 15-line ceremony blocks. Design compact alternatives that work within the platform's style.

### C-PLATFORM-2 — VS Code Copilot Chat vs Claude Code

- **CONSTRAINT:** These two platforms have fundamentally different capabilities:

| Capability | Claude Code | VS Code Copilot Chat |
|-----------|-------------|---------------------|
| System prompt | Minimal, doesn't conflict | "Keep answers short" — conflicts with ceremony |
| Subagents | Independent execution contexts | Read-only research — no execution, no independence |
| Session continuity | `/resume` command + task files | Conversation summary — loses behavioral context |
| Slash commands | `/implement`, `/fix` trigger workflows | No slash command support |
| Gate enforcement | Self-enforced via command workflows | No enforcement mechanism — purely voluntary |

- **IMPLICATION:** A protocol designed for Claude Code will fail in Copilot Chat (and vice versa). Either build platform-specific profiles, or design for the lowest common denominator.

### C-PLATFORM-3 — Conversation Summary Erases Meta-Behavior

- **CONSTRAINT:** When the AI platform summarizes a long conversation, it preserves factual state (file contents, progress, decisions) but erases behavioral patterns (gate discipline, formatting habits, compliance routines).
- **WHY IT'S HARD:** Summarization algorithms optimize for information density, not behavioral persistence. Meta-patterns ("always output OPEN first") are low-information-density and get compressed away.
- **IMPLICATION:** Never rely on conversation history for behavioral compliance. All behavioral rules must be re-loaded from files each turn, not maintained through conversation memory.

### C-PLATFORM-4 — Single Execution Context in Copilot Chat

- **CONSTRAINT:** VS Code Copilot Chat has one execution context. `runSubagent` is read-only (search, read files) — it cannot execute commands, edit files, or make independent decisions.
- **WHY IT'S HARD:** True independence requires separate contexts with no shared memory. One conversation context cannot be both executor and independent evaluator.
- **IMPLICATION:** Multi-role pipelines (executor + evaluator + QA) require either: (a) separate platform sessions, (b) human involvement, or (c) purely mechanical verification (binary command checks). Do not design multi-agent architecures for single-agent environments.

---

## Rule Design Constraints

### C3 — Rules Need Mechanical Verification

- **CONSTRAINT:** If you can't verify a rule from the agent's output (conversation text + file changes + terminal output), the rule effectively doesn't exist.
- **WHY IT'S HARD:** "Think about X before doing Y" is unverifiable. There's no way to audit whether the agent actually performed an internal check.
- **IMPLICATION:** Every rule must have a verification method: (a) output contains a specific pattern (OPEN line, plan block), (b) a file was created/modified, or (c) a terminal command produced expected output. If none of these apply, the rule is aspirational, not enforceable.

### C7 — Scoring Rubric Atomic Pair Updates

- **CONSTRAINT:** When changing scoring criteria at level N, you must also check and update level N+1 for consistency.
- **WHY IT'S HARD:** Contradictions between scoring levels cause evaluators to ignore the lower-level amendment and apply the higher level. This silently nullifies the change.
- **IMPLICATION:** Treat scoring rubric changes as atomic pairs. Never change score 1 without reviewing score 2 and 3 for consistency.

### C8 — Synced vs Local Content Separation

- **CONSTRAINT:** Protocol files that sync across repos must not contain project-specific content. Project-specific content goes in local files.
- **WHY IT'S HARD:** Sync uses newest-wins strategy. If Repo A adds a project-specific entry and Repo B syncs, B gets A's project content — polluting B.
- **IMPLICATION:** Maintain strict separation: synced files (protocol rules, generic patterns) vs local files (project learnings, project-specific config).

### C9 — Plain-Text Stubs for Lazy-Load References

- **CONSTRAINT:** When replacing extracted content with a cross-reference stub, use plain text, NOT markdown links.
- **WHY IT'S HARD:** This is a specific instance of C5. Markdown links cause eager loading, which defeats the purpose of extracting content to a lazy-loaded file.
- **IMPLICATION:** Write: "Full audit workflow in rules/GATES_AUDIT.md" NOT: `[GATES_AUDIT.md](rules/GATES_AUDIT.md)`.

### C-CONTRACT-1 — Output Contracts Are Mandatory, Not Suggestions

- **CONSTRAINT:** Output contracts in step files (export lists, file lists, interface requirements) are mandatory. Every listed item MUST exist in the output. Missing items = automatic FAIL. Additional items beyond the list are allowed.
- **WHY IT'S HARD:** Subagent implementers will "improve" the API design if given creative freedom — substituting different exports, renaming functions, or restructuring interfaces. Downstream consumers (other modules, tests, orchestrator) depend on the exact contracts listed.
- **EVIDENCE:** Hive Mind US-13: step file listed 11 exports, implementer delivered 12 different ones — dropped 4 required exports while adding alternatives. Caused the only failure in 15 stories.
- **IMPLICATION:** Step file OUTPUT sections must include a prominent header: "MANDATORY — Every export below MUST exist. Missing = automatic FAIL." Treat output contracts like API contracts — additions are fine, removals are breaking changes.

### C-ATOMIC-1 — Tracking Files Must Be Written Atomically

- **CONSTRAINT:** Tracking files (mindmap, logs, status) must be written to disk atomically after each state transition, BEFORE spawning the next subagent. In-memory-only updates are lost on context breaks.
- **WHY IT'S HARD:** Context loss (session breaks, token exhaustion) discards in-memory state. If tracking files weren't flushed, they become stale — showing incorrect status for completed work.
- **EVIDENCE:** Hive Mind session break left mindmap showing 3 stories as "in-progress" when code was already on disk. Required manual verification and 7 backfilled log entries.
- **IMPLICATION:** After every status transition: (1) write tracking file to disk, (2) verify write succeeded, (3) then spawn next subagent. Add startup reconciliation: scan files-on-disk vs tracking status.

---

## Token & Scale Constraints

### C-SCALE-1 — Token Budget = Speed Limit

- **CONSTRAINT:** AI context windows are finite. Every token of protocol loaded reduces the tokens available for actual work (code, analysis, user conversation).
- **MEASURED:** Previous protocol: ~70,000 tokens of rules for one developer. Even at QCS 2 (medium complexity), ~5,200+ tokens of protocol overhead.
- **IMPLICATION:** Set an explicit maximum token budget for the protocol. Suggested: ≤2,000 tokens total for the most common task types (QCS 0-2). Budget enforcement should be part of the protocol design process.

### C-SCALE-2 — Cognitive Overhead Limit

- **CONSTRAINT:** At ~40 self-check items, the protocol becomes the primary cognitive load, displacing actual work.
- **MEASURED:** At full complexity, the old protocol required 40+ mental checks per response: OPEN (5), THINK (4), GO (8), TEST (9), SHIP (7), LEARN (7).
- **IMPLICATION:** Limit the total number of checks per response to ≤10 for the most complex tasks, ≤5 for typical tasks. If a check isn't in the top 10 most impactful, it shouldn't exist.

### C-SCALE-3 — Protocol-to-Product Ratio

- **CONSTRAINT:** Protocol work should not exceed product work. 33 sessions on protocol vs 15 on product = protocol has become the product.
- **IMPLICATION:** Track the ratio. If protocol sessions exceed 1:2 vs product sessions, freeze protocol changes and build product. The protocol exists to serve the product, not the other way around.

---

## Quick Constraint Checklist for Rule Design

When designing a new rule, verify:

1. ☐ Which file will this rule live in? (C1)
2. ☐ Does that file load at the target complexity level? (C6)
3. ☐ Is the rule verifiable from output? (C3)
4. ☐ Does it conflict with the platform system prompt? (C-PLATFORM-1)
5. ☐ Does it add to the always-loaded token budget? (C2)
6. ☐ Are there any links to conditional files? (C5, C9)
7. ☐ Is there project-specific content in a synced file? (C8)
8. ☐ Does it push total checks beyond 10? (C-SCALE-2)
9. ☐ Are output contracts marked as mandatory, not suggestions? (C-CONTRACT-1)
10. ☐ Are tracking file writes atomic (disk before next action)? (C-ATOMIC-1)

If any answer is "yes" or "wrong," redesign before implementing.
