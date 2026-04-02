# Hive Mind Harness Improvement -- Release Plan

4 releases to evolve Hive Mind from a fixed pipeline to a self-improving, MCP-connected, visually-aware dark factory. Each release builds on the previous. New ideas go in `roadmap-backlog.md` and get pulled into the next release during planning.

## Reference Docs
- [Roadmap by Pillar](../roadmap-by-pillar.md) -- strategic view (active roadmap)
- [Roadmap by Difference](../roadmap-by-difference.md) -- Anthropic comparison (research context)
- [Raw Research](../harness-improvement-roadmap.md) -- 1920-line analysis
- [Anthropic Comparison](../harness-comparison-anthropic.md) -- 8 key differences
- [Pillar Definitions](../hive-mind-roadmap-v2.md) -- 6 strategic pillars
- [Standalone Projects](roadmap-standalone-projects.md) -- reusable projects/skills not tied to pipeline (Remotion, Stitch, browser automation, etc.)

---

## Release 1: "Open the Pipes"

**Theme:** Connect Hive Mind to the outside world and grab low-hanging fruit.

**Timeline:** 2-3 weeks

**What ships:**
| # | Item | Pillar | Effort | Ref |
|---|---|---|---|---|
| 1 | MCP Phase 1 + deferred loading | P1 | Medium | P1 ss1.1, 1.6 |
| 2 | WebSearch/WebFetch for agents | P1 | Small | P1 ss1.5 |
| 3 | Context7 MCP for live docs | P1 | Small | P1 ss1.4 |
| 4 | GAN few-shot skepticism (prompt change) | P3 | Small | P3 ss3.4 |
| 5 | Merge compliance into VERIFY GAN loop | P3 | Small | P3 ss3.1 |
| 6 | Pipeline timeout + cost velocity alert | P6 | Small | P6 ss6.3 |
| 7 | Clear old .ai-workspace before new run | P6 | Small | -- |

**Why first:** MCP unblocks everything. The rest are small/medium effort, high impact, zero architecture changes.

**Exit criteria:**
- Agents can use MCP servers declared in `.hivemindrc.json`
- Research agent uses WebSearch and Context7
- Compliance stage removed, criteria merged into VERIFY ECs
- Critic prompts include few-shot skepticism examples
- Pipeline has dynamic timeouts (2hr pre-execute, rolling-average during execute, 48hr hard cap) and 2x budget velocity warning
- Old .ai-workspace archived before new pipeline run

**Detailed plan:** [roadmap-release-1.md](roadmap-release-1.md)

---

## Pre-R2: "Wire the Skills"

**Theme:** Prerequisite infrastructure for R2's skill-based architecture.

**Timeline:** 1 week (between R1 completion and R2 start)

**What ships:**
| # | Item | Effort | Ref |
|---|---|---|---|
| 1 | Bundle pipeline skills in npm package + runtime injection | Small | BL-002 |

**Details:**
- Add `skills/` directory to hive-mind repo with pipeline `.md` files + `manifest.json`
- Implement `ensurePipelineSkills(projectRoot)` in `src/skills/installer.ts`
- Called at pipeline start: copies skills into `{projectRoot}/.claude/skills/` with `hive-mind-` prefix
- Version-tracked via `.hive-mind-skills-version` marker file
- Bundled: skeptical-critic, skeptical-evaluator, skeptical-code-reviewer, compliance-ec-rules, future generated agent skills
- NOT bundled: user-facing skills (ship, prd, mailbox, etc.)

**Exit criteria:**
- `npm pack` includes `skills/` directory with all pipeline skill `.md` files
- `ensurePipelineSkills()` copies skills to target project's `.claude/skills/` at pipeline start
- Skill version marker tracks which hive-mind version installed the skills
- Existing pipeline behavior unchanged (backward compatible)

---

## Release 2: "Sharpen the Loop"

**Theme:** Make the GAN loop cheaper, smarter, and safer. Migrate agent prompts to skills.

**Timeline:** 2-3 weeks (after Pre-R2)

**Candidate items:**
| # | Item | Pillar | Effort | Ref |
|---|---|---|---|---|
| 1 | Claude hooks exit code 2 for GAN feedback | P3 | Small | P3 ss3.5 |
| 2 | Differential evaluation (only re-test failures) | P3 | Medium | P3 ss3.6 T3 |
| 3 | Fail-fast evaluator (short-circuit) | P3 | Small | P3 ss3.6 T2 |
| 4 | Dynamic stopping (score_delta check) | P3 | Small | P3 ss3.6 T6 |
| 5 | Memory summarization between waves | P4 | Small | P4 ss4.1 |
| 6 | Multi-dimensional scorecard with rubric | P3 | Medium | P3 ss3.3 |
| 7 | Command blocklist + path-scoped writes | P6 | Small | P6 ss6.4 |
| 8 | Hybrid prompt model: prompts → skills | P4 | Medium | BL-002 |
| 9 | Ship stage: per-story branch/PR/CI | P6 | Medium | BL-001 |
| 10 | Skill run data recording (pipeline agents) | P4 | Small | -- |

**Why second:** Reduces cost per pipeline run by 30-50%. Quality improvements compound with every run after this. Skill migration makes agent behavior editable and measurable.

**New items explained:**
- **Item 8 (Hybrid prompt model):** Split agent prompts into static identity (SKILL.md files generated from `AGENT_REGISTRY`) and dynamic context (`buildPrompt()` handles INPUT, OUTPUT, MEMORY only). ~21 Tier 1 agents convert incrementally via `SKILL_AGENTS` gate in `prompts.ts`. Registry remains single source of truth; skills are derived via `generateSkills()` build step.
- **Item 9 (Ship stage):** New `execute-ship.ts` replaces `execute-commit.ts` when `shipMode: "pr-per-story"`. Per story: branch, commit, push, PR, CI poll. No self-review (VERIFY + REPORT code-reviewer = 2 layers sufficient). PRs left open; squash-merge all at final `ship` checkpoint.
- **Item 10 (Skill run data):** Instrument `spawnAgent()` to record which skills were loaded per agent run. Write to `skill-run-log.jsonl`. REPORT stage generates `skill-effectiveness.md`. Cross-run history accumulates in `{knowledgeDir}/skill-run-history.jsonl` for R3's SELF-IMPROVE.

**Exit criteria:** (to be detailed when R1 nears completion)
- VERIFY only re-tests failed ACs/ECs on retry
- Hooks provide tsc/lint feedback during BUILD without separate agent
- Scorecard grades 7 dimensions with weighted rubric
- Memory.md summarized between waves
- ~21 agent types have SKILL.md files generated from registry
- `shipMode: "pr-per-story"` produces per-story PRs with CI validation
- `skill-run-log.jsonl` captures skills loaded, duration, cost, and success per agent run

---

## Release 3: "Get Smarter"

**Theme:** Make the harness learn from every run and see the UI.

**Timeline:** 3-4 weeks (after R2)

**Candidate items:**
| # | Item | Pillar | Effort | Ref |
|---|---|---|---|---|
| 1 | LSP enablement for code intelligence | P1 | Medium | P1 ss1.3 |
| 2 | Preview MCP for web project verification | P2 | Medium | P2 ss2.5 |
| 3 | Claude-Mem integration (auto memory capture) | P4 | Medium | P4 ss4.6 |
| 4 | SQL database for structured memory | P4 | Medium | P4 ss4.2 |
| 5 | Skill-Creator SELF-IMPROVE stage | P4 | Large | P4 ss4.7 |
| 6 | Context governance per agent type | P4 | Medium | P4 ss4.8 |
| 7 | Surface graduation stats in REPORT | P4 | Small | P4 ss4.2 |

**Why third:** Needs MCP (R1) and stable GAN loops (R2). The learning system is the path to a self-improving harness.

**Exit criteria:** (stub -- detailed during R2)

---

## Release 4: "Scale Up"

**Theme:** Shape the pipeline to the task and enable full autonomy.

**Timeline:** 4-6 weeks (after R3)

**Candidate items:**
| # | Item | Pillar | Effort | Ref |
|---|---|---|---|---|
| 1 | Tiered modes (Quick/Standard/Thorough) | P5 | Medium | P5 ss5.5 |
| 2 | Extract agents to .agent/ YAML definitions | P5 | Medium | P5 ss5.3 |
| 3 | STRATEGIC-ONLY spec rule | P5 | Small | P5 ss5.1 |
| 4 | Dark factory mode (--autonomous, holdout, quality gate) | P6 | Large | P6 ss6.1 |
| 5 | Channels for mobile checkpoint approval | P6 | Medium | P6 ss6.7 |
| 6 | Community skills per project type | P4 | Medium | P4 ss4.5 |
| 7 | Figma MCP for design-aware pipeline | P2 | Large | P2 ss2.3 |
| 8 | Adaptive concurrency based on rate limits | P6 | Medium | P6 ss6.2 |
| 9 | Docker container sandbox for dev agents | P6 | Large | P6 ss6.4 |
| 10 | Staffing agent for dynamic pipeline (capstone) | P5 | Large | P5 ss5.3 |

**Why last:** Largest changes, need the most testing, benefit from everything before them. Staffing agent is the capstone -- it replaces the orchestrator's fixed stage sequence with a dynamic agent graph. Requires tiered mode gates (item 1) to be in place first, so the staffing agent can evolve the gate logic rather than rewrite the orchestrator. Docker sandbox pairs with dark factory mode (item 4) -- untrusted autonomous execution needs container isolation.

**Exit criteria:** (stub -- detailed during R3)

---

## How to Use This Plan

1. **Active release:** Only one release is actively being worked on at a time
2. **One PR per story:** Each story = one PR. No multi-story PRs. Large stories get sub-PRs. Keeps reviews small and revertable.
3. **Skills over hardcoded prompts:** Prompt-based items are `.claude/skills/` files, not hardcoded in `prompts.ts`. Auto-improvable by skill-creator in R3.
4. **New ideas:** Add to [roadmap-backlog.md](roadmap-backlog.md) with one-liner + pillar tag
5. **Release planning:** When current release is ~75% done, detail the next release plan
6. **Items can move:** If an R3 item becomes urgent, pull it into R2. If an R1 item is blocked, push to R2
7. **Retrospective:** After each release, add a retro section to the release plan doc
8. **Validation:** After each release, run a full pipeline on a test PRD and compare scorecard against baseline
9. **Simple scales better:** Use simple algorithms and data structures. Fancy algorithms are slow when N is small -- and N is usually small. Only optimize when profiling proves a bottleneck.

## Deferred (v2+)
Items explicitly deferred beyond R4:
- **RAG standalone MCP server (P4)** -- Build as standalone project (SP-008) after R1. Integrate into pipeline in R3 via `mcpServers` config. See [roadmap-standalone-projects.md](roadmap-standalone-projects.md) SP-008.
- **MCP Phase 2: expose Hive Mind as MCP server (P1)** -- no demand yet; build consumer side first (R1), expose when orchestration layer needs it
- **NotebookLLM-py integration (P6)** -- unofficial API using undocumented Google endpoints, zero production reliability
