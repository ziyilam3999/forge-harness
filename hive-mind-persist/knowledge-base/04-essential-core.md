# Essential Core — The 5 Ideas Worth Keeping
<!-- AI-FIRST DOCUMENT: Feed this to the AI agent during protocol planning. -->
<!-- PURPOSE: These 5 ideas delivered ~90% of the old protocol's value. Build the new protocol around them. -->
<!-- The old protocol was ~70,000 tokens. These 5 ideas need ~1,600 tokens. -->

## How to Use This File

You are designing a new AI agent protocol. The previous protocol (v12.0.0) went through 30+ versions and ~70,000 tokens of rules. After real-world audits and migration testing, **5 core ideas** emerged as genuinely valuable. Everything else was overhead.

Build the new protocol around these 5 ideas. Everything else is optional.

---

## The 5 Essential Ideas

### 1. Complexity-Proportional Ceremony (QCS Scaling)

**What it does:** Scale protocol overhead to match task complexity. A typo fix gets ~500 tokens of rules. A payment system gets ~2,000+.

**Why it's essential:** Addresses the fundamental tension — guardrails for complex work without burning tokens on simple fixes.

**Implementation guidance:**
- Define 3-4 complexity levels (e.g., trivial / standard / complex / critical)
- Each level loads a specific set of rules — trivial loads only the bare minimum
- The agent's FIRST action is to assess complexity and announce it
- Keep the trivial-level protocol under 500 tokens

**What the old protocol got right:** PROTOCOL_LITE.md at ~500 tokens for QCS 0-1 was perfectly sized.

**What the old protocol got wrong:** The jump from QCS 1 to QCS 2 loaded ~5,200+ additional tokens. Too cliff-like. Make transitions gradual.

**Token budget guidance:**
| Level | Target Token Budget | Rules Loaded |
|-------|-------------------:|-------------|
| Trivial | ≤500 | Core rules only |
| Standard | ≤1,200 | Core + plan-before-code + test evidence |
| Complex | ≤2,000 | All rules + examples |
| Critical | ≤3,000 | All rules + examples + project-specific context |

---

### 2. Plan Before Code (GO Gate)

**What it does:** Agent must show its plan and get confirmation before editing any file.

**Why it's essential:** Prevents expensive mistakes. The cheapest time to catch a wrong approach is before code is written.

**Implementation guidance:**
- Require the agent to output its plan (what files to change, what approach)
- Wait for user confirmation before any `create_file` or `edit_file` call
- Keep the plan concise — 3-10 lines, not a dissertation
- For trivial tasks, the plan can be one sentence

**Enforcement:** This should be a Tier 1 rule (named, with consequences). Tool-call sequencing: "No file-edit tool calls before user confirms the plan."

**What the old protocol got right:** GO-1 with score cap achieved high compliance.

**What the old protocol got wrong:** The GO block format was too verbose (8 fields). Compress to essentials: (1) What I'll change, (2) Why, (3) Risk.

---

### 3. Test Evidence with Terminal Output (TE-1)

**What it does:** Agent must actually run tests and paste verbatim terminal output. Not "I ran the tests and they passed" — the actual output.

**Why it's essential:** Catches the #1 AI failure mode: fabricating test results. Terminal output is objective and verifiable.

**Implementation guidance:**
- After completing code changes, the agent must run the test suite
- Paste the actual terminal output (not a summary, not "all passed")
- If no test suite exists, run linting/type-checking as minimum verification
- The verification command should come from the project config, not the agent's memory

**Enforcement:** Tier 1 rule. Tool-call sequencing: "Before marking work complete, run_in_terminal with test command."

**What the old protocol got right:** TE-1's verbatim quote requirement was excellent.

**What the old protocol got wrong:** TDD enforcement (write test FIRST, then code) is ideal but TP-1 is Tier 2 (~90%). Keep this as a strong recommendation, not an absolute requirement.

---

### 4. Anti-Phantom Verification (SHIP Gate)

**What it does:** Before committing code, the agent lists every claim it made ("I updated file X, ran test Y") and proves each with ✅/❌ against actual tool calls in the conversation.

**Why it's essential:** AI agents fabricate. They claim to have done things they didn't do. The SHIP gate is a self-audit before the work is considered done.

**Implementation guidance:**
- After all work is complete and tests pass, list each change made
- For each claim, cite the actual tool call or terminal output that proves it
- Mark each ✅ (proven) or ❌ (unproven — needs to be done)
- Any ❌ means the work is incomplete — do the missing item first

**Enforcement:** This gate only fires before git commits or "I'm done" declarations. Not on every response.

**What the old protocol got right:** The concept is sound and catches real AI fabrication.

**What the old protocol got wrong:** Making it a per-response ceremony instead of a completion checkpoint.

---

### 5. Cross-Session Memory (Learn-Persist)

**What it does:** When the agent learns something useful (a bug pattern, a framework quirk, a project-specific insight), it writes it to a persistent file that gets loaded in future sessions.

**Why it's essential:** Without this, every new session starts from zero. The same mistake gets made repeatedly. Learn-persist creates institutional memory.

**Implementation guidance:**
- At the end of a task (or when a significant insight emerges), write a one-line entry to a learnings file
- Format: `[date] [type]: [specific, actionable insight]`
- The learnings file must be in the set of files loaded at session start
- Separate protocol learnings (universal) from project learnings (project-specific)

**What makes a GOOD learning entry:**
- GOOD: "Zustand canUndo/canRedo must be boolean fields, not methods — methods return stale values in render closures"
- BAD: "Be careful with state management"
- GOOD: "navigator.onLine is unreliable on captive portals — use AbortController with 5s timeout instead"
- BAD: "Check network status carefully"

**Enforcement:** Tier 3 (encourage but don't hard-enforce). The learning will be skipped under time pressure — that's acceptable. The ones that DO get written are extremely valuable.

---

## The Minimal Protocol Template

This is ~200 tokens and covers 90% of the value:

```
1. OPEN: [MODE] | QCS:[score] | [what you're doing]
2. GO: [plan] — wait for OK before editing files  
3. [Do the work]
4. TEST: [run tests, paste terminal output]
5. LEARN: [outcome] | [insight or None]
```

### Expanded with enforcement rules (~500 tokens):

```
RULES:
- OP-1: First output must be the OPEN line. No tool calls, no text before it.
- GO-1: No create_file or edit_file before user confirms plan.
- TE-1: Before declaring "done," run tests and paste verbatim terminal output.
- LP-1: If you learned something reusable, append to learn file.
- EL-1: Explain non-obvious decisions in plain language (1-2 sentences).

SHIP (before git commit only):
- List each claim. Prove each with ✅ tool-call citation or ❌ unproven.
- Any ❌ = incomplete. Do the missing item first.
```

---

## What the Old Protocol Had That Should NOT Return

| Component | Tokens | Why It Should Stay Dead |
|-----------|-------:|----------------------|
| 13,200 tokens of examples | 13,200 | Replace with 1 example per gate (~300 total) |
| 40+ self-check items | 2,000 | Use 5 named rules with consequences instead |
| Scoring rubrics (0-3 per gate) | 1,000 | Self-referential — agent grades its own formatting |
| AUDIT.md + compliance-log | 800 | Protocol monitoring protocol |
| Empty mandate docs | 300 | requirements.md, standards.md — never filled, never used |
| 7 cut named rules | 700 | FU-1, SF-1, SC-1, CM-1, DR-1, LN-1, MT-1 — low compliance or formatting-only |
| **Total dead weight** | **~18,000** | |

---

## The Meta-Lesson

> A 1,600-token protocol followed 95% of the time beats a 70,000-token protocol followed 72% of the time.

The old protocol's greatest achievement was not the gates or QCS — it was the **evidence registry** (what-works.md). The scientific method for protocol design:

1. Try something
2. Measure if it actually works (real sessions, not simulations)
3. Write down the result with evidence
4. Never repeat a failed pattern

Build the evidence registry INTO the new protocol from day one.
