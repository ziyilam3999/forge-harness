# Hive Mind Knowledge Base
<!-- AI-FIRST DOCUMENT: This is the index. Read this file FIRST, then read the files in order. -->

## Purpose

This is the **design evidence library** for Hive Mind — a living knowledge base that grows via graduation from `memory.md`. It contains everything learned from building AI agent protocol v7.4 through v12.0.0 across 30+ versions, 33+ sessions, and a 15-step infrastructure migration — **plus learnings from the Hive Mind SPEC v1.1 implementation** (15 stories, 89 ACs, 167 tests, manager+subagent execution pattern).

**Who reads this:** The researcher agent (SPEC stage) and the retrospective agent (during graduation events only).
**Who writes this:** The retrospective agent, via the graduation protocol, when stable entries in `memory.md` meet all three criteria: stability (3+ runs), evidence (2+ story IDs), and generalizability.

*Updated March 2026 with Hive Mind manager+subagent execution learnings (P20-P24, F26-F30, C-CONTRACT-1, C-ATOMIC-1).*

## Reading Order

Read these files in order. Each builds on the previous:

| # | File | What It Contains | Tokens (approx) |
|---|------|-----------------|:----------------:|
| 1 | [01-proven-patterns.md](01-proven-patterns.md) | 24 patterns that work, organized by effectiveness tier | ~3,200 |
| 2 | [02-anti-patterns.md](02-anti-patterns.md) | 30 patterns that fail, with root causes and alternatives | ~3,500 |
| 3 | [03-design-constraints.md](03-design-constraints.md) | Hard limits that cannot be broken — platform, token, cognitive | ~2,400 |
| 4 | [04-essential-core.md](04-essential-core.md) | The 5 ideas worth keeping + minimal protocol template | ~1,800 |
| 5 | [05-compliance-mechanics.md](05-compliance-mechanics.md) | The 4-tier enforcement hierarchy — how to make rules work | ~2,400 |
| 6 | [06-process-patterns.md](06-process-patterns.md) | Workflow patterns: planning, execution, session management | ~2,700 |
| 7 | [07-measurement-reality.md](07-measurement-reality.md) | Measured data, self-scoring bias, what numbers to trust | ~2,400 |

**Total: ~17,500 tokens** — includes Hive Mind execution learnings (March 2026).

## Key Takeaways (For Quick Reference)

1. **Enforcement mechanism > rule content.** A mediocre rule with Tier 1 enforcement (100%) beats a perfect rule with Tier 4 enforcement (14%).

2. **5 core ideas deliver 90% of value:** Complexity scaling, plan-before-code, test evidence, anti-phantom verification, cross-session memory.

3. **Token budget must be explicit:** ≤500 tokens for trivial tasks, ≤2,000 for complex. The old protocol loaded ~5,700+ for medium tasks.

4. **Platform system prompt outranks all protocol files.** Design rules that work WITH the platform, not against it.

5. **Simulations ≠ reality.** 98% simulated vs 72% real. Self-scoring inflates by 10-15pp. Measure from real sessions.

6. **Fewer rules, better enforced.** 5 rules at 95% > 12 rules at 72%. Cut anything below 50% compliance.

7. **External artifacts > internal reasoning.** Physical files (plans, step files, terminal output) beat "think about X" every time.

## How to Use These Files

**For the researcher agent (SPEC stage):**
1. Load ALL files (~17,500 tokens)
2. Distill applicable patterns, anti-patterns, and constraints into the DESIGN EVIDENCE section of research-report.md
3. Downstream agents consume evidence via research-report.md — they do NOT read knowledge-base/ directly

**For the retrospective agent (graduation events):**
1. Read knowledge-base/ to dedup — ensure candidate entries don't already exist
2. Assign correct IDs (P25+, F31+, C-NEW-N, etc.)
3. Append graduated entries in the structured format (WHAT / WHY / EVIDENCE / DESIGN IMPLICATION)

**For human review (protocol design):**
1. **Read 04-essential-core.md** to understand what to build around
2. **Read 05-compliance-mechanics.md** to understand how to enforce rules
3. **Read 03-design-constraints.md** to understand what you can't change
4. **Read 01-proven-patterns.md** for specific patterns to adopt
5. **Read 02-anti-patterns.md** before proposing any new mechanism (check it hasn't failed before)
6. **Read 06-process-patterns.md** for workflow design
7. **Read 07-measurement-reality.md** to calibrate expectations and set up measurement

## Graduation Entry Format

New entries added via graduation MUST use this format:
```
### P-NN / F-NN — [Name]
- WHAT: [one sentence]
- WHY IT WORKS/FAILS: [root cause]
- EVIDENCE: [measured result]
- DESIGN IMPLICATION: [how to use this]
```

## Token Budget

Current: ~17,500 tokens. Soft cap: 25,000 tokens. If exceeded, log warning for human review at checkpoint.
