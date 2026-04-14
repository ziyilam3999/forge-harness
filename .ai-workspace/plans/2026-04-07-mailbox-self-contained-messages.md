# Plan: Improve Mailbox Skill Self-Contained Message Guidance

## Context
The mailbox skill says messages should be "self-contained" (L204, L335) but provides no structured guidance at the point of composition (L185-187 is just: "compose based on conversation context"). In practice, agents sometimes send thin messages ("I made some improvements", "see the PR") that force the receiver to ask follow-ups. The user observed that a well-crafted message should include PR URLs, audit results, metrics, design decisions, and previews — and wants this level of completeness to be the default behavior.

**KB grounding:** This aligns with proven patterns from the hive-mind knowledge base:
- **P16 (Self-Contained Step Files)** — each unit of work gets its own file with Objective, Context, Commands, Expected Output, Rollback. No cross-references. Source: `hive-mind-persist/knowledge-base/01-proven-patterns.md`
- **P22 (JSONL Audit Trail)** — each entry is a self-contained record with all context inline
- **Anti-pattern F7 (Cross-References Defeating Conditional Loading)** — references to external context ("as discussed", "see the PR") break when the receiver doesn't share that context. Source: `hive-mind-persist/knowledge-base/02-anti-patterns.md`
- **Process pattern** — "Agents lose context in long sessions. A step file that includes everything inline eliminates the need to cross-reference other files." Source: `hive-mind-persist/knowledge-base/06-process-patterns.md`

## ELI5
When one Claude agent sends a message to another, the receiver knows nothing about what the sender was doing. Right now the skill just says "include context" but doesn't say *what* context. We're adding a checklist at the exact moment the agent composes the message, so it always includes the right things — like a packing list before a trip.

## Change

**File:** `C:/Users/ziyil/coding_projects/ai-brain/skills/mailbox/SKILL.md`

### Edit 1: Replace L185-187 with compose checklist (+23 lines net)

Replace:
```
3. Determine message content:
   - If user provided content inline: use it
   - Otherwise: compose based on conversation context (what has been done, current state, what the receiver needs to know)
```

With:
```
3. Determine message content:
   - If user provided content inline: use it
   - Otherwise: compose using the checklist below

   **Compose checklist — mentally simulate: "The receiver has zero context from my
   conversation. What do they need to understand and act without asking follow-ups?"**

   Include every applicable item:

   | Category | Include |
   |----------|---------|
   | **Identity** | What project/repo, what branch, what PR (URL if exists) |
   | **Action done** | What you completed — concrete results, not just "I looked into it" |
   | **Evidence** | Metrics, test results, audit scores, error messages — paste actual values |
   | **Decisions** | Design choices made and *why*, alternatives rejected |
   | **Artifacts** | URLs (PRs, deploys, previews), file paths changed, commands to run |
   | **Current state** | What is working now, what is not, any blockers |
   | **Ask / Next step** | Exactly what you need from the receiver, or what they should do next |

   **Anti-patterns (from KB F7, F11, F13):**
   - "I made some improvements" → say *what* improvements with *what* effect
   - "There were a few issues" → list each issue with its resolution
   - "See the PR" → include key changes inline; receiver may not have repo access yet
   - "As discussed" / "as mentioned" → never reference prior conversation; inline all context
   - Vague status without counts → use mechanical clarity: "3/5 tests pass", "PASS", "12 files"
   - Sending a status without metrics when metrics exist in your conversation
```

### Edit 2: Update L204 comment to cross-reference checklist (0 net lines)

Replace:
```
   {message body -- self-contained, includes all context the receiver needs}
```

With:
```
   {message body -- use the compose checklist above; receiver has zero context}
```

## Line Budget
- Lines removed: 3 (L185-187) + 1 (L204)
- Lines added: 26 + 1
- Net addition: **+23 lines**
- New total: ~405/500 lines (current: 382, safe)

## Why This Design
1. **Single insertion point** — the checklist lives at the exact moment the agent composes, not scattered across the file
2. **KB-grounded** — anti-patterns and principles trace directly to proven patterns P16/P22 and anti-patterns F7/F11/F13 from the hive-mind knowledge base
3. **Table format** — scannable, token-efficient, Claude responds well to tabular instructions
4. **Anti-patterns with KB citations** — concrete bad→good examples grounded in documented failure modes. "Mechanical clarity" principle (counts, verdicts) comes from the audit trail pattern P22
5. **"Mental simulation" prompt** — shifts the agent from "what do I want to say" to "what does the receiver need"
6. **No changes to handoff** — handoffs already have rich structured YAML fields; the gap is freeform `send` messages
7. **No changes to Important Rules (L335)** — the principle is already correct; we're operationalizing it at the action point

## Out of Scope (Future)
- **Eval updates**: `skills/mailbox/evals/evals.json` already tests for self-containment (L8: "no references to 'as discussed'") but could be strengthened to test for checklist category coverage. Deferred to a separate improvement.

## Test Cases & AC
- [ ] **TC1**: L185-187 replaced with compose checklist block — `grep -c "Compose checklist" SKILL.md` returns 1
- [ ] **TC2**: L204 updated to reference checklist — `grep "use the compose checklist above" SKILL.md` matches
- [ ] **TC3**: SKILL.md body under 500 lines — `wc -l SKILL.md` minus frontmatter < 500
- [ ] **TC4**: Skill passes validation — `PYTHONIOENCODING=utf-8 python ~/.claude/skills/skill-creator/scripts/quick_validate.py` returns "Skill is valid!"
- [ ] **TC5**: Anti-patterns section present with KB references — `grep -c "Anti-patterns (from KB" SKILL.md` returns 1
- [ ] **TC6**: All 7 checklist categories present — `grep -cE "Identity|Action done|Evidence|Decisions|Artifacts|Current state|Ask / Next step" SKILL.md` returns 7
- [ ] **TC7**: "Mechanical clarity" anti-pattern present — `grep "mechanical clarity" SKILL.md` matches
- [ ] **TC8**: "As discussed" anti-pattern present — `grep "As discussed" SKILL.md` matches

## Checkpoint
- [x] Edit 1: Replace L185-187 with compose checklist (KB-grounded)
- [x] Edit 2: Update L204 comment
- [x] Validate skill (405 lines, "Skill is valid!", all 8 TCs pass)
- [x] Run skill-evolve audit (see below)
- [x] Ship from ai-brain — PR: https://github.com/ziyilam3999/ai-brain/pull/188

Last updated: 2026-04-07T20:50:00+08:00
