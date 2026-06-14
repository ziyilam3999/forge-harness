# Quality Checklist (Phase 3: VALIDATE)

Run these checks on the draft and present results to the human. All checks are advisory -- the human reviewer is the real quality gate.

## Checks

| Check | Rule | Severity |
|-------|------|----------|
| All 10 sections present | Template completeness | FAIL |
| No placeholder text (`[TODO]`, `TBD`) | Content completeness | FAIL |
| Success criteria are binary | Flag words: "reasonable", "appropriate", "good", "proper", "adequate", "sufficient", "acceptable" | WARN |
| Requirements have IDs | REQ-NN format | FAIL |
| Each REQ has acceptance criteria | Formal requirement structure | WARN |
| Out of Scope is non-empty | Explicit boundaries | WARN |
| No HOW sections | See examples below | WARN |
| Open Questions flagged | `[NEEDS CLARIFICATION]` markers | INFO |
| Concrete examples present | At least one input/output example per key requirement | WARN |

## HOW Section Examples

**Flag (implementation detail):**
- "Use PostgreSQL with a normalized schema."
- "Store logs in `/var/log/app/` using JSON format."

**Don't flag (requirement):**
- "Data must persist across restarts."
- "System must provide queryable audit logs."

## Override Behavior

All severity levels are advisory:
- FAIL-severity issues produce a prominent warning but do not block export
- The user can acknowledge and proceed
- WARN and INFO issues are displayed for awareness

## Compliance Reality Check

These checks are advisory prose rules executed by the same agent that drafted the PRD:
- F2 (Behavioral Prose Without Consequences): prose rules achieve 17% compliance without mechanical enforcement
- F9 (Self-Scoring Bias): self-assessment inflates by 10-15pp

The primary quality improvement comes from the guided DISCOVER interview. This checklist serves as a reminder for the human reviewer -- not a substitute for human review.

## Presentation

Present results as a summary table with pass/fail status for each check. Group by severity (FAIL first, then WARN, then INFO).
