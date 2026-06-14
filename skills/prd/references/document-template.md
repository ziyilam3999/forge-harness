# Document Template (Phase 2: DRAFT)

This reference is the **canonical PRD structure for forge-harness**. It defines the 10 sections, maps diagnostic answers to each section, and states the drafting rules — no external document is required.

## 10 Sections

1. **Problem Statement** -- from Q1 (Demand Reality) and Q2 (Status Quo) answers
2. **Objective** -- from agreed premises
3. **Requirements** -- REQ-NN format with user stories and acceptance criteria
4. **Non-Functional Requirements** -- constraints without specifying HOW
5. **User Workflow** -- step-by-step from user perspective, no implementation detail
6. **Success Criteria** -- binary pass/fail only
7. **Out of Scope** -- with rationale per exclusion (informed by Q4: Narrowest Wedge)
8. **Future Scope / Roadmap** -- deferred expansions from scope mode go here
9. **Open Questions** -- mark unresolved items with `[NEEDS CLARIFICATION]`
10. **Evidence Base** -- demand evidence from Q1, status quo from Q2, user research from Q3

## Drafting Rules

- Auto-number requirements as REQ-01, REQ-02, etc.
- Every REQ must have a user story and binary acceptance criteria
- Suggest user stories for functional requirements (best-effort -- human should review)
- No HOW sections -- architecture, file organization, CLI commands belong in the execution plan / SPEC
- NFRs constrain without specifying: "Response time < 200ms" is an NFR; "Use Redis" is a SPEC decision
- Include concrete input/output examples in the relevant requirement sections
- Include agreed premises in the Evidence Base section
- If scope mode was EXPAND or SELECTIVE EXPAND, include accepted expansions as requirements and deferred ones in Future Scope

## Session Persistence

Save the draft to `.ai-workspace/prd-draft.md` after completing it. This is best-effort session persistence -- if interrupted, the user can re-invoke `/prd` and point at the draft.
