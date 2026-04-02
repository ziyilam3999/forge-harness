# Hive Mind Improvement Roadmap v2

## Context
Hive Mind is a PRD-driven orchestrator (v0.16.0) that turns product requirements into working code through a multi-stage AI pipeline. Over 5 research sessions, we analyzed Anthropic's harness design articles, explored 30+ improvement ideas, and identified strategic directions. This document distills that research into a coherent, strategy-focused roadmap.

The raw analysis lives in `docs/harness-improvement-roadmap.md` (1920+ lines). This plan focuses on direction and strategy. Technical details will be handled in implementation.

## What Hive Mind Is Today
- 33 hardcoded agent types, fixed pipeline (NORMALIZE -> SPEC -> PLAN -> EXECUTE -> REPORT)
- Agents spawned via Claude CLI subprocess, no MCP integration
- Binary AC/EC evaluation (shell exit codes), no visual verification
- Flat-file memory (memory.md), rule-based graduation to knowledge base
- 8 basic safeguards (timeouts, retry caps, budget limits)
- No web search, no LSP, no browser testing, no skill system

---

## Strategic Direction: Six Pillars

### Pillar 1: Open the Ecosystem (MCP + Plugins)

**Why:** Hive Mind is an isolated island. MCP is the universal connector adopted by every major AI tool (10,000+ servers). Without it, Hive Mind cannot use databases, GitHub, Figma, Google Workspace, or any external service.

**Strategy:**
- Phase 1: Consume MCP servers -- add `mcpServers` config, pass `--mcp-config` to agent spawning. One change unlocks the entire MCP ecosystem (GitHub, SQLite, Figma, Vercel, Google Workspace, Context7, etc.)
- Phase 2: Expose Hive Mind as an MCP server -- let other tools drive Hive Mind programmatically
- Enable deferred tool loading (`defer_loading`) so multiple MCP servers don't bloat agent context
- Enable LSP plugins for IDE-level code intelligence (type errors in 50ms, jump-to-definition)
- Enable WebSearch/WebFetch for research and fixer agents

**What this unlocks:** Everything in Pillars 2-6 depends on MCP. It's the foundation.

**Feasibility:** HIGH -- Claude CLI already supports `--mcp-config`. This is configuration, not architecture change.

### Pillar 2: Give Agents Eyes (Visual Verification)

**Why:** Hive Mind runs blind for web projects. It executes shell-based tests but never actually sees the UI. Anthropic's harness uses Playwright + evaluator to visually verify output. Claude Code now has a built-in Preview MCP and Chrome extension for browser testing.

**Strategy:**
- Use Preview MCP (headless, built into Claude Code Desktop) for CI/pipeline verification -- agents start dev servers, take screenshots, read console errors
- Use Chrome extension for interactive/subjective design evaluation
- Integrate visual feedback into the GAN loop -- evaluator grades screenshots, fixer gets visual context
- For non-web projects, this pillar is skipped (auto-detected from project type)

**What this unlocks:** Anti-AI-slop for frontend. Figma-aware design pipeline (read design tokens from Figma MCP, compare output against reference frames). Multi-dimensional scorecard gains Design Quality, Originality, Craft dimensions.

**Feasibility:** HIGH -- Preview MCP and Chrome extension are production-ready. Figma MCP is in beta.

### Pillar 3: Simplify with the GAN Pattern

**Why:** Hive Mind has accumulated complexity: COMPLIANCE CHECK, VERIFY loop, SPEC critique chain (5 agents), REPORT double-critique. Many of these are variations of the same pattern: generate -> evaluate -> fix -> repeat. Anthropic's harness proves this pattern works with just two agents in a loop.

**Strategy:**
- Unify all iterative checking into a single reusable GAN loop pattern (parameterized by generator, evaluator, max iterations, stopping criteria)
- Merge COMPLIANCE into VERIFY -- compliance criteria become additional ECs in the existing GAN loop
- Convert SPEC critique from a fixed 5-agent chain to a GAN loop with early exit (saves 1-2 agents when spec is good on first try)
- Add few-shot skepticism to evaluator prompts (Anthropic's key insight: evaluators must be trained to be harsh)
- Add adaptive evals -- after failures, evaluator generates focused criteria targeting the specific failure mode
- Add cost optimizations: differential evaluation (only re-test failures), fail-fast on hard failures, dynamic stopping when score plateaus

**What this unlocks:** Simpler pipeline code, lower cost per run, better quality through iterative refinement.

**Feasibility:** HIGH -- the GAN pattern already exists in VERIFY. This is generalization, not invention.

### Pillar 4: Self-Improving Harness (Learning + Skills)

**Why:** Hive Mind already captures learnings and graduates them to a knowledge base. But graduated learnings are passive text -- they inform prompts but don't change pipeline behavior. The missing piece: convert learnings into executable skills that auto-trigger on future runs.

**Strategy:**
- Integrate Claude-Mem for automatic memory capture (every agent action captured to SQLite, not just explicit learner output)
- Migrate memory from flat files to SQL database via MCP (searchable, filterable, governed)
- Use LLM-driven consolidation (Google's Always On Memory approach) instead of rule-based graduation
- Add SELF-IMPROVE stage after REPORT: analyze failures, identify patterns, use Anthropic's skill-creator to generate skills with built-in evaluation (60/40 train/test split, iterates up to 5 times)
- Skills that pass evaluation auto-deploy to `.claude/skills/` for next run
- Surface learning metrics in scorecard (learnings captured, graduated, skill hit rate)
- Apply context governance: each agent type only retrieves relevant learnings (tester sees nothing, implementer sees patterns, researcher sees everything)

**The self-improvement loop:**
```
Run N: Pipeline fails on pattern X
  -> Learner captures pattern
  -> Graduation promotes to KB
  -> SELF-IMPROVE creates executable skill from pattern
Run N+1: Skill auto-triggers, prevents same failure
  -> Harness is now smarter
```

**Feasibility:** MEDIUM -- skill-creator exists (87k+ GitHub stars). Claude-Mem exists. SQL MCP exists. The integration is new but each piece is proven.

### Pillar 5: Adaptive Pipeline (Scale to the Task)

**Why:** Running 50+ agents for a 2-story task is wasteful. Running 6 agents for a 50-story enterprise project is inadequate. The pipeline should shape itself to the work.

**Strategy:**
- Short-term: Tiered modes (Quick/Standard/Thorough) with auto-detection based on PRD word count, story count, module count. Tiers are sensible defaults with `--quick` and `--thorough` overrides.
- Medium-term: Extract 33 hardcoded agents into `.agent/` YAML definitions (versionable, forkable, customizable per project). Load community skills per project type (frontend-design, owasp-security, etc.)
- Long-term: Staffing agent that reads PRD complexity and dynamically decides which agents to invoke. Pipeline shapes itself instead of following a fixed graph.
- Every stage gets a `shouldRun()` gate -- stages are independently toggleable, stateless, composable

**Feasibility:** HIGH for tiers (just config). MEDIUM for `.agent/` extraction. MEDIUM-HIGH for staffing agent (requires a planning agent, but Hive Mind already has one).

### Pillar 6: Dark Factory + Orchestration Layer

**Why:** Hive Mind is headed toward autonomous code production. The dark factory pattern (specs in, working software out, no humans needed) is the endgame. But Hive Mind shouldn't try to be everything -- bug fixing, security auditing, and migration are fundamentally different workflows.

**Strategy:**
- Hive Mind focuses on being the best dark factory: PRD -> working code
- Add `--autonomous` flag that removes human checkpoints
- Add holdout validation (hidden test scenarios the agent can't game, inspired by StrongDM)
- Add quality gate: pipeline only "ships" if scorecard grade >= B
- Separate orchestration layer above Hive Mind routes tasks to specialized harnesses:
  - Hive Mind (PRD -> code)
  - Bug Fixer (already exists as `bug` command, validated)
  - Enhancer (feature request -> incremental change)
  - Auditor (codebase -> security/quality report)
  - Migrator (old code -> new framework)
- Claude Channels enables mobile checkpoint approval for when humans are still in the loop
- Google Workspace CLI enables enterprise notifications, document management, cross-run dashboards

**Feasibility:** MEDIUM -- dark factory features are incremental. Orchestration layer is new but thin (just a router). Channels is research preview.

---

## Pillar Dependencies

```
Pillar 1 (MCP)  ------>  Everything depends on this
    |
    +---> Pillar 2 (Visual) -- needs Preview MCP, Figma MCP, Chrome
    +---> Pillar 4 (Learning) -- needs SQLite MCP, Claude-Mem
    +---> Pillar 6 (Dark Factory) -- needs GitHub MCP, Workspace MCP, Channels

Pillar 3 (GAN) -------> Independent, can start immediately
Pillar 5 (Adaptive) --> Independent for tiers, needs Pillar 1 for skills
```

## Execution Phases

### Phase 1: Foundation (MCP + Quick Wins)
Open the ecosystem and grab low-hanging fruit.
1. MCP Phase 1 + deferred loading
2. WebSearch/WebFetch for research and fixer agents
3. Context7 MCP for live library docs
4. LSP enablement for code intelligence
5. GAN few-shot skepticism (prompt-only change)

### Phase 2: Quality (Visual + GAN Simplification)
Give agents eyes and simplify the pipeline.
6. Preview MCP for web project verification
7. Merge compliance into VERIFY GAN loop
8. GAN loop as reusable parameterized pattern
9. Multi-dimensional scorecard with Anthropic-style rubric

### Phase 3: Intelligence (Learning + Skills)
Make the harness self-improving.
10. Claude-Mem for automatic memory capture
11. SQL database for structured memory (replace flat files)
12. Skill-Creator SELF-IMPROVE stage
13. Context governance per agent type

### Phase 4: Scale (Adaptive + Dark Factory)
Shape the pipeline to the task and enable autonomy.
14. Tiered modes (Quick/Standard/Thorough)
15. Extract agents to `.agent/` YAML definitions
16. Dark factory mode (--autonomous, holdout validation, quality gate)
17. Channels for mobile checkpoint approval
18. Community skills per project type
19. Figma MCP for design-aware pipeline

---

## Feasibility Summary

| Pillar | Risk | Blockers |
|---|---|---|
| 1. MCP Ecosystem | LOW | Claude CLI already supports `--mcp-config` |
| 2. Visual Verification | LOW | Preview MCP and Chrome extension are production-ready |
| 3. GAN Simplification | LOW | Pattern already exists in VERIFY, just generalize |
| 4. Self-Improving | MEDIUM | Integration of Claude-Mem + skill-creator is new |
| 5. Adaptive Pipeline | MEDIUM | Staffing agent is novel; tiers are straightforward |
| 6. Dark Factory | MEDIUM | Holdout validation is new; orchestration layer is thin |

## What NOT to Build
- Nested GAN loops (cost explodes quadratically)
- NotebookLLM integration (unofficial API, fragile)
- Full Docker sandboxing (overkill for now; command blocklist sufficient)
- Custom vector embedding pipeline (LLM-driven consolidation is simpler and good enough)

## Verification
- After each phase, run a full pipeline on a test PRD and compare scorecard against baseline
- Track cost-per-story trend across phases (should decrease)
- Track first-attempt pass rate trend (should increase)
- Track pipeline duration trend (should stay stable or decrease despite new capabilities)
