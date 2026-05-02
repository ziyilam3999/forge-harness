# Compliance Mechanics — How to Make Rules Actually Work
<!-- AI-FIRST DOCUMENT: Feed this to the AI agent during protocol planning. -->
<!-- PURPOSE: The enforcement mechanism matters more than the rule content. -->
<!-- This file explains WHY some rules achieve 100% and others achieve 0%. -->

## How to Use This File

You are designing a new AI agent protocol. The #1 lesson from the old protocol: **how you enforce a rule matters more than what the rule says.** A perfectly worded rule with no enforcement achieves 0%. A mediocre rule with mechanical enforcement achieves 90%+.

This file explains the compliance tier system — the single most important discovery from the old protocol.

---

## The Compliance Effectiveness Hierarchy

This is the most important framework in the entire protocol knowledge base. Every rule you design should be classified by tier BEFORE implementation.

### Tier 1 — Named Rules + Score Caps (100% Compliance)

**Mechanism:** The rule has a unique name (e.g., OP-1) and a specific negative consequence for violation (e.g., "If OPEN is missing, all gates capped at 50%").

**Why 100%:** The rule is:
- In the always-loaded file (agent always sees it)
- Named (memorable, scannable, specific)
- Has an immediate, visible consequence (not a penalty in a separate document)

**Example:** OP-1 — "OPEN must be the first output. If missing, all subsequent scores capped at 50%."

**When to use:** For rules that MUST be followed every time. Maximum 5 rules at this tier (cognitive budget).

**Constraint:** Each Tier 1 rule costs tokens on every task. Don't over-use.

---

### Tier 2 — Tool-Call Sequencing + Mechanical Detection (90%+ Compliance)

**Mechanism:** The rule is expressed as a constraint on which tools can be called in what order. Compliance is mechanically verifiable from the tool-call log.

**Why 90%+:** Tool-call order is an observable fact — not a judgment call. The agent either called run_in_terminal before edit_file, or it didn't. No interpretation needed.

**Examples:**
- TP-1: "The FIRST tool call after GO must be run_in_terminal" (forces test-first)
- FU-1: "Scan conversation for prior OPEN line before writing another" (mechanical pattern-match)

**When to use:** For behavioral requirements that can be expressed as tool-call sequences. Very effective for enforcing workflows.

**Constraint:** Only works for behaviors that manifest as observable tool calls.

**Additional example (Hive Mind):**
- **Subagent UAT enforcement:** UAT subagent prompt must include: "Run each UAT command via Bash. Report exact stdout. Code inspection alone is insufficient." Without this explicit constraint, measured UAT command execution rate was 0% — subagents defaulted to code inspection every time.

---

### Tier 3 — Wrong/Right Examples + Checklists (70-90% Compliance)

**Mechanism:** The rule is accompanied by a concrete Wrong example and Right example showing exactly what compliant and non-compliant output looks like. Self-check checklists supplement.

**Why 70-90%:** Examples are powerful learning signals — agents calibrate their output against patterns. But compliance drops under time pressure or after conversation summaries because examples are in supplementary files that may not be re-read.

**Examples:**
- OPEN Wrong/Right: `❌ OPEN: fixing bug` vs `✅ OPEN: IMPLEMENT | QCS:2 | Fix auth redirect loop`
- LEARN Wrong/Right: `❌ LEARN: fixed the bug` vs `✅ LEARN: navigator.onLine unreliable on captive portals — use AbortController timeout`

**When to use:** To supplement Tier 1-2 rules with concrete illustrations. Not sufficient alone for critical rules.

**Constraint:** Examples must be co-located with the rule, not in a separate examples file. Separate files may not load.

---

### Tier 4 — Behavioral Prose (< 50% Compliance)

**Mechanism:** The rule is stated as text: "The agent should update docs after code changes." No name, no consequence, no mechanical check.

**Why < 50%:** No enforcement mechanism. The agent optimizes for completing the user's task — advisory guidelines are the first thing dropped under cognitive load.

**Measured results:**
- 17% compliance for prose rules in real sessions
- 0% compliance across 50 responses in migration session
- 14% compliance for doc-map updates (prose-only)

**When to use:** NEVER as the sole enforcement for anything important. Acceptable for soft guidance that's nice-to-have but not critical.

---

## Rule Design Decision Tree

```
Is this rule critical (must be followed every time)?
├── YES → Tier 1: Named rule + consequence in always-loaded file
│         (max 5 rules at this tier)
├── SOMEWHAT → Can it be expressed as tool-call ordering?
│   ├── YES → Tier 2: Tool-call sequencing constraint
│   └── NO  → Tier 3: Wrong/Right examples co-located with rule
└── NICE-TO-HAVE → Tier 4: Advisory prose (expect <50% compliance)
                   Consider: is this worth the token cost?
```

---

## Enforcement Mechanics — How Each Tier Works

### Tier 1 Mechanics

1. Rule has a 2-4 character name (e.g., OP-1, GO-1)
2. Rule is placed in the main always-loaded file
3. Rule specifies a mechanical consequence: "If [violation detected], then [penalty]"
4. Consequence must be immediate and visible — in the same response, not in a separate audit

**Template:**
```
[RULE-NAME]: [One-sentence rule description].
Consequence: [What happens if violated — score cap, gate failure, etc.]
```

### Tier 2 Mechanics

1. Identify the behavioral requirement ("run tests before declaring done")
2. Express as tool-call constraint ("FIRST tool call must be run_in_terminal after plan approval")
3. Verification is mechanical: check tool-call order in conversation history
4. Consequence: violation caps the relevant gate/score

**Template:**
```
[RULE-NAME]: [Tool constraint]. 
Verify: [How to check — which tool call, what position].
```

### Tier 3 Mechanics

1. Write the rule
2. Write one Wrong example (≤3 lines) showing the violation
3. Write one Right example (≤3 lines) showing compliance
4. Place all three together — rule, wrong, right — in the same file section
5. Optional: add a 1-line self-check item

**Template:**
```
[Rule description]
❌ Wrong: [bad example]
✅ Right: [good example]
```

---

## The Broken Windows Theory of Compliance

**Discovery:** Unenforced rules erode compliance on enforced rules. When agents see some rules routinely ignored, it signals that rule-following is optional.

**Measured:**
- 5 rules at 95% compliance > 12 rules at 72% compliance
- 86pp gap between most-enforced rule (100%) and least-enforced rule (14%)
- When bottom 7 rules were cut, the remaining 5 strengthened

**Implication for new protocol:** Fewer, perfectly-enforced rules beat many loosely-enforced rules. If you add a rule, commit to enforcing it. If you can't enforce it, don't add it.

---

## Platform-Specific Compliance Notes

### VS Code Copilot Chat

- System prompt says "keep answers short" → verbose ceremony will be dropped
- One execution context → no independent evaluation
- Conversation summary loses behavioral patterns → rules must reload from files, not memory
- `runSubagent` is read-only → can't spawn independent evaluators
- **Design for:** compact inline markers, file-based verification, mechanical checks

### Claude Code

- Minimal system prompt → more room for protocol ceremony
- Independent `Task` subagents → genuine multi-agent evaluation possible
- `/resume` command → stronger session continuity
- Slash commands → workflow triggers available
- **Design for:** can use slightly more ceremony, genuine subagent delegation

### Cross-Platform Design

If the protocol must work on both:
- Design rules at the Copilot Chat level (lowest common denominator)
- Add optional ceremony expansions for Claude Code
- Keep all enforcement mechanical (works on both platforms)
- Never rely on conversation memory for compliance (fails on both, but worse on Copilot Chat)

---

## Common Compliance Design Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| "The agent should..." without consequence | Tier 4 = <50% | Add name + consequence (Tier 1) |
| Rule in wrong file | Not loaded = 0% | Check loading tier map |
| Rule says "think about X" | Unverifiable internal reasoning | Require external artifact |
| Long ceremony blocks | Platform says "be brief" | Compact one-line markers |
| Agent grades itself | 10-15pp inflation | Mechanical binary checks |
| Duplicate rules for emphasis | Zero uplift, sync risk | Single source of truth |
| Score rubric without example | Agents don't adopt spontaneously | Add Wrong/Right pair |
| UAT by inspection, not execution | 0% command execution without prompt constraint | Explicit "run via Bash" in subagent prompt |
| Output list as suggestion | Implementer drops required exports | Mark contracts as mandatory |
