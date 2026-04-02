# Harness Roadmap -- Backlog

Parking lot for new ideas that come up between releases. During release planning, pull items from here into the next release plan.

## Format
```
- BL-NNN [Priority] [Release Target?] One-line description -- source/context
```
Release targets: `[R2]`, `[R3]`, `[post-R1]` etc. Omit if not yet triaged.

## Backlog Items

- BL-001 [P5] [R2] **RESOLVED** One PR per story in pipeline -- new `execute-ship.ts` stage with `shipMode: "pr-per-story"`. Per story: branch, commit, push, PR, CI poll. No self-review (2 review layers sufficient). PRs left open; squash-merge all at final `ship` checkpoint. Resolved 2026-03-31.
- BL-002 [P4] [Pre-R2/R2] **RESOLVED** Evaluate which stages/prompts should be skills -- confirmed hybrid prompt model: static identity (ROLE, RULES, few-shot) in SKILL.md files, dynamic context (INPUT, OUTPUT, MEMORY) in `buildPrompt()`. `AGENT_REGISTRY` remains single source of truth; skills are generated via `generateSkills()` build step. ~21 Tier 1 agents convert in R2. Skill packaging (Pre-R2) is prerequisite. Resolved 2026-03-31.
- BL-003 [P4] 3-tier memory model: persistent (brand voice, SOP), per-session (user query, chat history), searchable (knowledge-base, vector DB) -- aligns with R3 memory items (SQL DB, Claude-Mem)
- BL-004 [P6] Cost breakdown by agent and model type in pipeline run -- extend CostTracker to track model field per AgentCostEntry (candidate for R2)
- BL-005 [P2] Dashboard visible from Normalize stage -- show stage progress from pipeline start, not just EXECUTE; use frontend design skill for UI (candidate for R2)
- BL-006 [P2] Computer use + browser use for visual verification -- agents use computer use tool and /browser-use (Chrome extension) during VERIFY to see UI. Refs: [computer-use-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool), [let claude use your computer](https://code.claude.com/docs/en/desktop#let-claude-use-your-computer)
- BL-007 [P1] MCP vendor flexibility -- pipeline should work with any MCP tool provider, not hardcode specific vendors. Declare tool capabilities needed, resolve to available MCP servers at runtime
- BL-008 [P3] Chain-of-thoughts prompting in GAN loop -- extend current SPEC multi-role CoT to GAN pattern: evaluator reasons step-by-step before verdict, fixer reasons through diagnosis before fix. Systematize prompting techniques (temperature, think-first, output constraints, role/persona, few-shot) as skill library
- BL-009 [P5] Multi-instance coordination (cowork pattern) -- Claude Code multi-instance coordination for parallel agent sessions within pipeline. Agents coordinate like coworkers. Ref: Anthropic cowork feature
- BL-010 [P2] Google Stitch integration for AI design generation -- use Stitch's "vibe design" (intent+mood prompts) to generate UI mockups during SPEC/PLAN, feed into visual verification loop. Ref: Google Stitch March 2026 "vibe design" update
- BL-011 [P1] [R2] Complexity-based stage scaling -- detect trivial PRDs (single file, <50 LOC), run "light" pipeline: fewer SPEC agents, no role reports, 1 story. Source: R1 Run 1 diagnosis (RC-2, RC-3)
- BL-012 [P1] [R2] Collapse impl + tests into 1 story by default -- eliminates duplicate EXECUTE waves of 7 agents each. Source: R1 Run 1 diagnosis (RC-3)
- BL-013 [P2] [R2] Skip security role report for non-security PRDs -- gate on keyword detection (auth, credentials, network, API keys). Source: R1 Run 1 diagnosis
- BL-014 [P2] [R2] Reduce SPEC critique cycles for trivial PRDs -- 1 round instead of 2 when complexity is low. Source: R1 Run 1 diagnosis
- BL-015 [P2] [post-R1] Improve first-attempt pass rate -- investigate spec context passed to implementer, both stories failed attempt 1. Needs more dog-food run data. Source: R1 Run 1 diagnosis
- BL-016 [P3] [R2] Skip refactorer for test-only stories -- test files rarely benefit from refactoring in same pass. Source: R1 Run 1 diagnosis
- BL-017 [P3] [R3] Add cost/time budget field to PRD format -- let user signal expected complexity for pipeline self-tuning. Requires PRD schema + pipeline integration. Source: R1 Run 1 diagnosis
- BL-018 [P3] [R2] Log fix-unverified agent costs in cost-log.jsonl -- currently untracked, hard to see full cost of fix cycles. Bundle with BL-004. Source: R1 Run 1 diagnosis
