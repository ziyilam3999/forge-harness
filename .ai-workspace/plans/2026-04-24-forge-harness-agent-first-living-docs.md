# Plan: forge-harness — agent-first living-docs pipeline (4-phase)

> **Persist target after approval:** copy to `.ai-workspace/plans/2026-04-24-forge-harness-agent-first-living-docs.md` per CLAUDE.md policy. The `~/.claude/plans/` file is ephemeral.

## Context

The user asked for four improvements to forge-harness that, when composed, turn it from a **build-loop harness** into a **documentation-as-code pipeline**. Today forge stops at "did this story's code pass?" — after this change, forge ensures the system's living documentation stays in sync with shipped reality, story by story, with the main agent's context window protected from implementation bloat.

The four improvements form a coupled family:

- **(1) Subagent-first execution** — forge-harness always spawns a fresh subagent for story implementation so the main-agent context stays lean. Currently `forge_generate` returns a brief and the main agent executes inline — any diff / test output / compiler error floods main context and triggers `/compact`.
- **(2) Living technical specification** — after every story's `forge_evaluate` PASS, forge updates `docs/generated/TECHNICAL-SPEC.md` with that story's API contracts, data models, invariants, and test surface. It becomes the single source of truth for automated regression testing and for onboarding new agents. Agent-first (YAML front-matter + structured sections), not prose.
- **(3) /project-index integration** — the `/project-index` skill becomes aware of forge's generated contracts. When `docs/generated/API-CONTRACTS.md` exists, it verifies drift (declared contract vs. current `server/tools/*.ts` Zod schemas) and updates the index entry. When it doesn't, /project-index generates a scaffold. Output is agent-first (tabulated, stable keys).
- **(4) Architecture Decision Records (ADRs)** — during implementation, the subagent records material design decisions as ADR stubs; post-PASS, forge normalizes them into `docs/decisions/ADR-NNNN-*.md` with the Nygard-extended template and rebuilds `docs/decisions/INDEX.md`. Living, cross-linked, one decision per file.

**Why now.** forge has just matured through v0.35.1 (dashboard polish, declaration store, gitSha capture) — the story-completion lifecycle is stable, `writeRunRecord` already fires a post-PASS hook for dashboard re-render, and `trackedCallClaude` is a first-class LLM-call wrapper available to any lib module. The plumbing is ready; these four additions are additive, not invasive. Deferring risks growing main-context pollution on real monday-bot runs (already observed: 3-day rate-limit gap mid-pipeline in v0.35.1 arc — the thinner the main context, the cheaper the resume).

**Research evidence that shaped this plan** (from three parallel Explore agents):
- `server/lib/coordinator.ts:524-525` — `classifyStory` returns `"done"` on PASS; this is the natural spec-update trigger point.
- `server/lib/run-record.ts:145-146` — post-PASS hook already exists (`writeActivity` + `renderDashboard`). Extending it is **one call-site, additive**.
- `server/lib/anthropic.ts:255-306` (`callClaude`) + `server/lib/run-context.ts` (`trackedCallClaude`) — LLM call wrapper with cost tracking, ready to reuse for spec/ADR generation.
- `server/lib/run-record.ts:33-71` — RunRecord tagged union has room for an optional `generatedDocs` field with zero schema-version bump.
- `schema/execution-plan.schema.json`, `schema/eval-report.schema.json` — only 2 of 10 type files have JSON Schema contracts today. Improvement #3's scaffold work fills the gap.
- `server/index.ts` — 8 MCP primitives registered with Zod **literal-object** input schemas (not `.object()` calls), **not directly importable as runtime symbols**. Improvement #3 needs a convention addition: each tool module exports `ToolInputSchemaShape` as a named symbol, so the contract harvester can import rather than AST-parse. (Terminology: this plan uses "primitive" interchangeably with "tool" to match the README; both mean the same thing — a `server.registerTool` call.)
- `~/.claude/skills/delegate/SKILL.md` — the subagent-spawn mechanism (`Agent()` tool invocation with a self-contained brief) is already proven and skill-ready. Improvement #1 reuses it.
- `server/types/generate-result.ts` — `GenerateResult.action` is a discriminator (`"implement"|"fix"|"pass"|"escalate"`) but **has no "how should the caller run this" field**. Adding `callerAction: "execute-inline" | "spawn-subagent-and-await"` is the minimum-surface change.

## ELI5

Imagine forge is a factory that builds software. Today it hands each story's blueprint to you (the main agent), you build it at your own workbench, and your workbench gets cluttered with blueprints, screws, sawdust from every story until you have to sweep it (`/compact`).

Four upgrades:

1. **The factory gives each story to a fresh temp worker (subagent)** and asks you to just review the finished product. Your workbench stays clean all day.
2. **After every story ships, the factory updates a giant "how this building works" manual** — one section per story. By the time the building is done, there's a complete, accurate manual nobody had to write by hand.
3. **The building's floor plan** (our /project-index) now **looks at the manual too** and checks it matches the actual rooms. If it doesn't, it shouts "drift!"
4. **Every time a worker makes a hard choice** ("I put the door on the south wall, not the north, because…") they write a one-page note. The factory files those notes in order so any future worker can read them and understand *why* things are the way they are.

The point: the building is the code, and the **manual, the floor plan, and the decision notes all stay true forever — without a human ever having to write or update them**. And the main agent never has to look at sawdust.

## Goal (invariants that must hold when done)

- **G1.** When `forge_generate` returns `action: "implement"`, its response instructs the caller to spawn a fresh subagent; the main agent's per-story context growth is bounded by ≤ 2 KB UTF-8 byte length (brief summary + verdict), independent of story diff size. Measurement unit is the UTF-8 byte length of the text the `/forge-execute` skill returns to the calling session — counted as `Buffer.byteLength(returnText, "utf8")` or equivalent, not character count or token count.
- **G2.** After every `forge_evaluate` story-mode PASS, `docs/generated/TECHNICAL-SPEC.md` contains a section for that story that is (a) schema-valid, (b) idempotent across re-runs, (c) agent-first (YAML front-matter, named sections, stable keys).
- **G3.** After every `forge_evaluate` story-mode PASS, `docs/decisions/` has either a new ADR file for every material decision the implementing subagent recorded, or an index row noting "no new decisions," and `docs/decisions/INDEX.md` enumerates every ADR with a one-line hook.
- **G4.** Running `/project-index` refreshes `.ai-workspace/PROJECT-INDEX.md` with an API-contracts cross-reference; if `docs/generated/API-CONTRACTS.md` exists and drifts from current `server/tools/*.ts`, the skill records a drift count to `~/.claude/skills/project-index/runs/data.json`.
- **G5.** All four improvements are backward-compatible: existing MCP clients (monday-bot, other consumers) see no breaking changes; every new field is optional; every new file is additive; the new subagent-spawn directive defaults to "execute inline" if the caller's skill version predates support.

## Binary AC (observable from outside the diff)

Phases A/B/C/D map 1:1 to improvements #1/#2/#4/#3 respectively (ordering reshuffled — see "Ordering constraints" below).

### Phase A — subagent-first execution (improvement #1)

- [ ] **AC-A1.** `forge_generate` for a story with `action: "implement"` returns a JSON body containing `callerAction: "spawn-subagent-and-await"` at top level.
  - Verify (executor builds first; `dist/` is gitignored): `npm run build && node -e 'import("./dist/tools/generate.js").then(m => m.handleTool(FIXTURE_ARGS).then(r => process.exit(JSON.parse(r.content[0].text).callerAction === "spawn-subagent-and-await" ? 0 : 1)))'` exits 0, where `FIXTURE_ARGS` is a fixture covering an "implement" action (the executor defines the fixture under `tests/fixtures/forge-generate/implement.json` and reads it via `JSON.parse(fs.readFileSync(...))` — exact shape is the executor's choice provided it produces `action: "implement"`). The reviewer's `scripts/v036-0-living-docs-acceptance.sh` invokes this via the same `npm run build && node -e ...` form.
- [ ] **AC-A2.** A new skill exists at `ai-brain/skills/forge-execute/SKILL.md` (symlinked to `~/.claude/skills/forge-execute/SKILL.md`); `test -L ~/.claude/skills/forge-execute/SKILL.md` exits 0.
- [ ] **AC-A3.** The `/forge-execute <storyId>` skill, given a `callerAction: "spawn-subagent-and-await"` directive, spawns an `Agent` subagent whose prompt is the `GenerationBrief` and whose return is captured in the skill's runs/data.json as `{context_isolation_mode: "fresh", main_context_delta_bytes: <N>}` with `N ≤ 2048`.
- [ ] **AC-A4.** When `callerAction` is absent or `"execute-inline"`, `/forge-execute` falls through to the legacy inline path (backward compat — existing monday-bot runs unaffected).
- [ ] **AC-A5.** `forge_coordinate`'s `PhaseTransitionBrief` gains an optional `recommendedExecutionMode: "subagent" | "inline"` field; when a phase has ≥ 3 open stories the field is `"subagent"`.
- [ ] **AC-A6.** `vitest run server/tools/generate-caller-action.test.ts` — 3 tests green (action=implement→subagent, action=fix→subagent, action=pass→absent).

### Phase B — living technical specification (improvement #2)

- [ ] **AC-B1.** After `forge_evaluate` returns PASS for any story X, file `docs/generated/TECHNICAL-SPEC.md` exists AND contains exactly one heading matching `^## story: <X>` (`grep -c "^## story: X$"` returns `1`).
- [ ] **AC-B2.** Running the same PASS-producing `forge_evaluate` a second time does not duplicate the section (`grep -c` remains `1`); re-run updates the corresponding entry under top-of-file `stories[i].lastUpdated` in the YAML front-matter (per the schema in AC-B3 — there is no per-section front-matter block; `lastUpdated` lives only in the top-of-file front-matter's `stories[]` array, keyed by `id`).
- [ ] **AC-B3.** The full file passes schema validation: `node scripts/validate-tech-spec.mjs docs/generated/TECHNICAL-SPEC.md` exits 0. Schema (new file `schema/technical-spec.schema.json`) requires: front-matter `{schemaVersion, lastUpdated, stories: [{id, lastUpdated, lastGitSha}]}` plus per-story sections `api-contracts` / `data-models` / `invariants` / `test-surface`.
- [ ] **AC-B4.** Each story section lists every API contract touched (any tool whose Zod schema changed, any exported type, any route handler signature). Verified by: `node scripts/spec-contract-coverage.mjs --story X` reports `coverage: 1.0`.
- [ ] **AC-B5.** `scripts/v036-0-living-docs-acceptance.sh` runs AC-B1..B4 end-to-end against a fixture repo and exits 0.
- [ ] **AC-B6.** Doc-gen cost per PASS is recorded in `RunRecord.generatedDocs.genTokens` and in the run's `metrics.estimatedCostUsd`; total across a 13-story phase ≤ $0.80 (budget-guard).

### Phase C — Architecture Decision Records (improvement #4)

- [ ] **AC-C1.** After `forge_evaluate` PASS on story X, either `docs/decisions/ADR-NNNN-*-X.md` exists (for one or more N) OR `docs/decisions/INDEX.md` has a row `| X | no new decisions | <commit-sha> |`.
- [ ] **AC-C2.** Every file matching `docs/decisions/ADR-*.md` passes `node scripts/validate-adr.mjs <path>` (exit 0): requires YAML front-matter `{adr, status, story, date, supersedes?, supersededBy?}` plus sections `## Context`, `## Decision`, `## Consequences`, `## Alternatives considered`.
- [ ] **AC-C3.** `docs/decisions/INDEX.md` lists every ADR file, one row per ADR, with the hook taken from the ADR's front-matter `title:`. `diff <(ls docs/decisions/ADR-*.md | wc -l) <(grep -c '^| ADR-' docs/decisions/INDEX.md)` shows zero rows out of sync.
- [ ] **AC-C4.** Running `forge_evaluate` PASS twice on the same story is fully idempotent: (a) does not create duplicate `ADR-NNNN-*-X.md` files, and (b) does not append a duplicate `| X | no new decisions | <sha> |` row to `INDEX.md` for stories that legitimately had no new decisions. Verified by numbered-ADR uniqueness test plus an INDEX-row dedup test (re-running PASS on a no-decisions story leaves `grep -c "^| X |" INDEX.md` at `1`).
- [ ] **AC-C5.** The `GenerationBrief` handed to the implementing subagent includes a new `adrCapture` section listing "record any decision of the form: <architectural class>" with 4 canonical triggers: (1) new external dependency added to `package.json`, (2) any persisted-data or wire-format schema version bumped (`schema/*.json`, JSONL/JSON record shapes in `.forge/`, MCP-tool input/output Zod surface), (3) new cross-module boundary introduced in `server/` (a module imported across a previously-isolated subtree), (4) bypass or override of an existing established pattern documented in `hive-mind-persist/knowledge-base/01-proven-patterns.md` (P-numbered).
- [ ] **AC-C6.** `vitest run server/lib/adr-extractor.test.ts` — 4 tests green (happy path, no-decisions, duplicate idempotent, front-matter malformed).

### Phase D — /project-index integration (improvement #3)

- [ ] **AC-D1.** Running `/project-index` on forge-harness produces `.ai-workspace/PROJECT-INDEX.md` that contains a Quick Start row with text matching `Understand MCP tool contracts.*docs/generated/API-CONTRACTS\.md`.
- [ ] **AC-D2.** When `docs/generated/API-CONTRACTS.md` is missing, `/project-index` generates a scaffold with exactly one row per registered MCP tool (count matches `server/index.ts`'s `server.registerTool` calls).
- [ ] **AC-D3.** When `docs/generated/API-CONTRACTS.md` exists and a tool's current `ToolInputSchemaShape` differs from the declared contract (field removed, type narrowed), `/project-index` writes `contract_drift_count: N` (N ≥ 1) to `~/.claude/skills/project-index/runs/data.json` for that run.
- [ ] **AC-D4.** The generated `docs/generated/API-CONTRACTS.md` has a top-of-file banner `<!-- agent-first: this document is authored for AI-agent consumption. Stable keys, structured sections, no prose narrative. -->` (enforces the user's "agent-first, not human-first" explicit constraint).
- [ ] **AC-D5.** Each tool in `server/tools/*.ts` exports `ToolInputSchemaShape` as a named symbol (compile-time check: `grep -l "export const ToolInputSchemaShape" server/tools/*.ts | wc -l` equals tool count). This is the contract convention that lets the harvester import rather than AST-parse.
- [ ] **AC-D6.** `vitest run server/tools/contract-convention.test.ts` — 1 test green (for every registered MCP tool, the module exports `ToolInputSchemaShape` and it is **functionally equivalent** to the schema actually used at `server.registerTool` — i.e., the test imports both, runs them through `safeParse` against a fixture set of valid + invalid inputs per tool, and asserts identical accept/reject verdicts. The intent is "single-source-of-truth for each tool's input contract"; the executor may achieve this by importing the named export at the registration site or by structural comparison — either satisfies the AC).

### Cross-phase (wrapper + discipline)

- [ ] **AC-X1.** `scripts/v036-0-living-docs-acceptance.sh` runs AC-A1..A6 + AC-B1..B6 + AC-C1..C6 + AC-D1..D6 in order and exits 0 iff all pass. This is the reviewer's one-shot validation.
- [ ] **AC-X2.** `npm run build` + `vitest run` pass with zero test failures; total test count ≥ current master count (re-measure at delegation time via `vitest run --reporter=verbose 2>&1 | tail -5` against `feat/v036-living-docs`'s base; the v0.35.1 wrapper recorded ~834 as informational, but the AC is delta-based — measure live, don't recall) + new tests from AC-A6 (3) + AC-C6 (4) + AC-D6 (1) = baseline + 8.
- [ ] **AC-X3.** Touched-paths allowlist (cumulative across all four phases): diff confined to `server/**`, `scripts/v036-0-*.sh`, `scripts/validate-tech-spec.mjs`, `scripts/validate-adr.mjs`, `scripts/spec-contract-coverage.mjs`, `schema/technical-spec.schema.json`, `schema/adr.schema.json`, `ai-brain/skills/forge-execute/**`, `ai-brain/skills/project-index/**` (SKILL.md + helper scripts), `docs/generated/.gitkeep`, `docs/decisions/.gitkeep`, `CHANGELOG.md`, `package.json`, `package-lock.json`, the outcome plan (`.ai-workspace/plans/2026-04-24-forge-harness-agent-first-living-docs.md`), the master plan (`.ai-workspace/plans/forge-v036-0-master-plan.json`), the four phase plans (`.ai-workspace/plans/forge-v036-0-phase-{A,B,C,D}.json`), and any ship-fix iteration plans (`.ai-workspace/plans/2026-04-*-ship-fix-[0-9]+.md`). The `/ship` reviewer invokes the wrapper's `--mode=allowlist-check` submode on all changed paths.

## Out of scope

- **Automatic retroactive doc-generation** for stories already shipped before this change. Spec and ADRs start accumulating at the first PASS after the feature lands. However, **manual backfill by the downstream consumer (monday-bot) IS in scope** — see the "Post-release consumer outreach" section below: after v0.36.0 ships, forge-plan mails monday with the new templates, schemas, validators, and her list of already-shipped storyIds so she can fill historical entries herself, avoiding LLM-guessed intent.
- **Rewriting `docs/forge-harness-plan.md`, `docs/forge-coordinate-prd.md`, `docs/forge-generate-prd.md`** — these remain hand-authored source-of-intent PRDs. The generated spec complements them; it does not replace them.
- **Human-friendly doc generation** — the generated artefacts are agent-first by the user's explicit instruction. A human-readable overlay (if ever needed) is a separate product decision.
- **Cross-repo propagation** — only forge-harness itself is updated. monday-bot, cairn, and other consumers pick up the new behaviour when they re-pull forge's MCP server; they require no code change because all new fields are additive-optional.
- **OpenAPI / Swagger** — `API-CONTRACTS.md` is Markdown with stable keys, not formal OpenAPI. OpenAPI is deferred until a consumer requires it (no current consumer does).
- **Mandatory subagent-spawn** — the directive is advisory; the client skill (`/forge-execute`) may run inline if the user overrides (`--inline`). Defaulting to subagent is an improvement, not a regression-maker.
- **Changing forge_plan's document tier system** — the three-tier PRD>Master>Phase pipeline stays intact; generated docs are a fourth tier, downstream of PASS.
- **Replacing /delegate** — /forge-execute is narrower (forge-brief-aware, context-isolation-telemetry-aware). /delegate remains the generic planner→executor handoff.

## Ordering constraints

- **Phase A must land before Phase C** (the ADR-capture brief instructions in AC-C5 are delivered to a subagent; subagent-spawn must work first to land AC-C5 with real-world validation).
- **Phase B can ship in parallel with Phase A.** Post-PASS tech-spec generation is forge-internal; it does not depend on the caller's execution model.
- **Phase D must land last.** It consumes Phase B (tech spec) and Phase C (ADR index) output. Shipping D before B/C would land a skill that references files that don't yet exist.
- **Delivery shape — integration-branch model (resolved 2026-04-25, was hedged in v1).** All four phases land on a single long-lived integration branch `feat/v036-living-docs`. Each phase opens a sub-PR *into that integration branch* (not into master); each sub-PR runs the wrapper's per-phase AC subset and a stateless review, but does **not** invoke `/ship` Stage 7 (no release bump, no tag, no GitHub Release). One final `/ship` from `feat/v036-living-docs` → `master` runs the cumulative AC wrapper, fires Stage 7 once, and cuts **v0.36.0** as a single minor release. Rationale: per-phase `/ship` would cascade through Stage 7 four times, producing four spurious tags (v0.35.3, .4, .5) and four GitHub Releases that must be cleaned up — and the conventional-commit-prefix workaround (`chore(phase-A):` on A/B/C, `feat:` on D) misrepresents the nature of phase commits, since each phase IS a feature. Integration branch keeps the cadence honest. Phase ordering on the integration branch: A → B (parallel with A) → C → D. One master plan (`.ai-workspace/plans/forge-v036-0-master-plan.json`) and four phase plans accompany it.

## Critical files (planner names paths; executor picks edit shape)

### New files (created by executor)

- `server/lib/spec-generator.ts` — post-PASS tech-spec delta-author; builds per-story section from RunRecord + diff + EvalReport; uses `trackedCallClaude` for LLM synthesis.
- `server/lib/adr-extractor.ts` — post-PASS ADR normalizer; reads subagent-written stubs from `.forge/staging/adr/<storyId>/*.md`, canonicalizes into `docs/decisions/ADR-NNNN-*.md`, rebuilds `INDEX.md`.
- `server/lib/contract-harvester.ts` (used by Phase D skill helper, not by server) — imports `ToolInputSchemaShape` from each `server/tools/*.ts`, emits per-tool contract rows.
- `server/tools/generate.ts` — extend return shape with `callerAction` field (Phase A).
- `server/tools/evaluate.ts` — after `writeRunRecord` on PASS, **synchronously invoke** spec-generator + adr-extractor before `forge_evaluate` returns (Phase B + C). Sync is mandated so AC-B1/AC-C1 verification can observe the file *immediately* after the tool response — async would require an unspecified poll window and break the contract that "PASS means docs are current." Cost is bounded by AC-B6's $0.80 / 13-story cap; latency is +20-40s per PASS (one `trackedCallClaude` round-trip for spec, ADR-extractor is deterministic).
- `server/types/generate-result.ts` — add `callerAction?: "execute-inline" | "spawn-subagent-and-await"`.
- `server/types/coordinate-result.ts` — add `recommendedExecutionMode?: "subagent" | "inline"` to `PhaseTransitionBrief`.
- `server/lib/run-record.ts` — extend `RunRecord` with optional `generatedDocs?: {specPath, adrPaths[], genTimestamp, genTokens}`.
- `schema/technical-spec.schema.json` — JSON Schema for `docs/generated/TECHNICAL-SPEC.md`.
- `schema/adr.schema.json` — JSON Schema for each `docs/decisions/ADR-*.md` (front-matter + required sections).
- `scripts/validate-tech-spec.mjs`, `scripts/validate-adr.mjs`, `scripts/spec-contract-coverage.mjs` — external-to-diff validators (enable AC-B3/B4, AC-C2/C3).
- `scripts/v036-0-living-docs-acceptance.sh` — reviewer wrapper (mirrors `scripts/v035-1-dash-acceptance.sh` shape).
- `ai-brain/skills/forge-execute/SKILL.md` — new skill (Phase A); created via `/skill-creator`, never hand-written.
- `ai-brain/skills/forge-execute/evals/*.md` — three eval inputs per SKILL.md convention.
- `ai-brain/skills/project-index/lib/contract-harvester.mjs` (or equivalent helper) — Phase D extension, called by SKILL.md.
- `docs/generated/.gitkeep`, `docs/decisions/.gitkeep` — ensure both dirs are tracked pre-first-PASS.

### Modified files

- All of `server/tools/{coordinate,declare-story,evaluate,generate,lint-refresh,plan,reconcile,status}.ts` — add `export const ToolInputSchemaShape = { ... }` as a named symbol (AC-D5 convention). Additive only; does not change MCP behaviour.
- `ai-brain/skills/project-index/SKILL.md` — extend Stage 2 classification with `contracts` topic; extend Stage 3 generation with three additions: (a) the API-contracts Quick Start row (AC-D1), (b) scaffold emission of `docs/generated/API-CONTRACTS.md` when missing (AC-D2), and (c) drift check writing `contract_drift_count` to `runs/data.json` when the file exists (AC-D3). All three behaviors share the contract-harvester helper from `ai-brain/skills/project-index/lib/`.
- `CHANGELOG.md`, `package.json` — v0.36.0 release bump via `/ship`.

### Files explicitly NOT touched

- `server/lib/coordinator.ts` (classifyStory stays as-is; spec-gen is downstream of `writeRunRecord`, not inside coordinator)
- `server/lib/declaration-store.ts` (singleton stays memory-only)
- `docs/forge-harness-plan.md`, `docs/forge-coordinate-prd.md`, `docs/forge-generate-prd.md` (hand-authored PRDs stay authoritative for intent)
- Existing monday-bot code (backward-compat guarantees make this free)

## Considered alternatives (so the user can redirect)

- **Docs location — `docs/generated/` (chosen) vs `.forge/docs/` (gitignored).** Chose `docs/generated/` because the user's "single source of truth for automated regression testing" goal requires the docs to be part of the repo (else CI has nothing to rely on). Tradeoff: LLM-authored content in PRs. Mitigation: schema-validated, idempotent, machine-generated → review burden is low and reviewers can diff prior generations.
- **Subagent-spawn coupling — forge-server directive (chosen) vs skill-only convention.** Chose the server-side directive because it's testable (AC-A1 observes JSON response), externally verifiable, and monday-bot can act on it mechanically. A skill-only convention drifts when anyone forgets the rule.
- **ADR capture source — subagent-written stubs (chosen) vs evaluator-side LLM diff-reading.** Chose subagent stubs because the subagent knows WHY it chose X over Y (that's the ADR's value); diff-reading reconstructs WHAT changed but only guesses at WHY. Risk: subagent forgets to write stubs. Mitigation: AC-C5 bakes the instruction into the brief; AC-C1 lets "no new decisions" be a valid outcome so the subagent is never pressured to fabricate.
- **API-contracts format — Markdown with stable keys (chosen) vs OpenAPI.** Chose Markdown because no consumer requires OpenAPI today; adopting OpenAPI would force a Swagger toolchain onto every reviewer. Upgrade path preserved: the harvester's output can emit OpenAPI if a future consumer wants it.
- **Version bump — v0.36.0 (chosen) vs v0.35.2.** Chose minor because this introduces new primitives (doc generation), new MCP response fields, and a new skill. A patch bump would under-signal the change.

## Verification procedure (reviewer's one-shot)

Run `bash scripts/v036-0-living-docs-acceptance.sh` from repo root. Expected output:
1. `[PASS] Build — npm run build`
2. `[PASS] AC-A1..AC-A6` (caller-action discriminator + /forge-execute skill + coordinate hint + backward-compat fallthrough)
3. `[PASS] AC-B1..AC-B6` (spec file exists, idempotent, schema-valid, contract-complete, cost-bounded)
4. `[PASS] AC-C1..AC-C6` (ADR files valid, index in sync, idempotent, brief contains adrCapture)
5. `[PASS] AC-D1..AC-D6` (project-index scaffold, drift detection, agent-first banner, tool contract-schema exports)
6. `[PASS] AC-X1..AC-X3` (wrapper green, test count ≥ baseline, touched-paths allowlisted)
7. Final line: `ALL ACCEPTANCE CHECKS PASSED`; exit 0.

Additional manual spot-check (post-merge):
- Run a real monday-bot story end-to-end. Confirm `docs/generated/TECHNICAL-SPEC.md` gains a section, `docs/decisions/` gets an ADR (or a no-new-decisions index row), and main-agent context delta ≤ 2 KB (observed via Claude Code's context meter).

## Post-release consumer outreach (NEW — user-added 2026-04-24)

After v0.36.0 merges and tags, forge-plan sends monday **one mail in a fresh thread named `forge-v036-0-living-docs-rollout-2026-04-24`** with the following payload. (Decision: a fresh thread, not a follow-on to `v034-field-report-2026-04-21`. Rationale: the v0.36.0 outreach is a distinct work-block — new feature surface, new mail type, new SLA — and threading it under the field-report thread would mix product-feedback and rollout-comms concerns. Date suffix `2026-04-24` anchors to plan-draft date; thread name persists regardless of when the mail actually goes out.)

- **Heads-up.** forge v0.36.0 now auto-generates `docs/generated/TECHNICAL-SPEC.md` and `docs/decisions/ADR-*.md` on every `forge_evaluate` story PASS. Subagent spawn is also now the default via `/forge-execute`. All additive; backward-compat with her current monday-bot code.
- **Templates + schemas.** Links to:
  - `schema/technical-spec.schema.json` — the JSON schema the tech spec validates against
  - `schema/adr.schema.json` — the ADR front-matter + section contract
  - A rendered example section for each (copy-paste-fillable), generated by running forge against a trivial fixture story.
- **Validators for her local use.**
  - `scripts/validate-tech-spec.mjs <path>` — exits 0 iff the file conforms
  - `scripts/validate-adr.mjs <path>` — exits 0 iff each ADR conforms
  - She can wire these into her own pre-commit or CI before manual edits land.
- **Her specific backfill list.** An itemized list of monday-bot storyIds that were implemented BEFORE v0.36.0 (derived from her `.forge/runs/` via a small helper I'll provide — grep for PASS RunRecords with `gitSha` present but no `generatedDocs`). Each item gets one line: `US-NN | <git sha> | <PR URL> | <one-line scope recall>`.
- **Explicit instruction.** For each listed storyId she:
  1. Adds a new section to her `docs/generated/TECHNICAL-SPEC.md` under `## story: US-NN` following the schema
  2. Creates one or more `docs/decisions/ADR-NNNN-*.md` files if the story involved architectural decisions she recalls, OR adds a `| US-NN | no new decisions | <sha> |` row to `docs/decisions/INDEX.md`
  3. Runs both validators, commits as `docs(backfill): US-NN living-docs entry`
  4. Opens one PR per ~5 stories (not one monster PR) so review is tractable
- **Why we're asking her, not auto-generating.** Auto-backfill would LLM-guess intent on decisions she actually made months ago — the resulting ADRs would be fiction dressed up as history. She's the authoritative source for her own shipped decisions.
- **What she can skip.** Stories where the implementation was trivial (single-file, no external API, no schema touched) can be backfilled with `no new decisions` + a 1-line spec section. Encourage completeness-over-depth; the point is that every shipped story has an entry, even an empty one.
- **SLA.** `reply_expected: true`, `reply_sla_seconds: 172800` (48h) — not a blocker, just a polite ping so we know she saw it. `auto_schedule_wakeup: true` so forge-plan checks back.

This outreach is **post-release** (after Phase D ships). It is NOT a blocker on v0.36.0's `/ship`. It's the "so consumers don't have a gap in their history" follow-up.

## Checkpoint (living)

- [x] User request received (four improvements, ultrathink).
- [x] Three parallel Explore agents dispatched; research reports consolidated.
- [x] Architectural design decisions locked (docs location, coupling level, ADR source, format, version bump).
- [x] Plan draft written to `~/.claude/plans/piped-sprouting-island.md`.
- [x] User correction applied: monday manual-backfill added as explicit post-release step.
- [x] User approval via `ExitPlanMode` (received pre-/compact 2026-04-25; resumed under "continue tasks").
- [x] Plan copied to `.ai-workspace/plans/2026-04-24-forge-harness-agent-first-living-docs.md` (2026-04-25, byte-identical to ephemeral source).
- [x] `/coherent-plan` critique pass complete (2026-04-25; outcome-plan variant — 9 MAJOR + 6 MINOR findings fixed in place; release-bump strategy rewritten to integration-branch model; AC-X3 allowlist widened; AC-D6 verification rewritten as functional-equivalence; sync spec/ADR generation locked; AC-C4 idempotency extended to no-decisions INDEX rows).
- [ ] Integration branch `feat/v036-living-docs` created off master.
- [ ] Phase A sub-PR opened into `feat/v036-living-docs` (AC-A1..A6 + per-phase wrapper subset; no /ship).
- [ ] Phase B sub-PR opened into `feat/v036-living-docs` (AC-B1..B6 + per-phase wrapper subset; no /ship).
- [ ] Phase C sub-PR opened into `feat/v036-living-docs` (AC-C1..C6 + per-phase wrapper subset; no /ship).
- [ ] Phase D sub-PR opened into `feat/v036-living-docs` (AC-D1..D6 + cumulative AC-X1..X3; no /ship).
- [ ] Final `/ship` from `feat/v036-living-docs` → `master` runs cumulative wrapper, fires Stage 7 once, cuts v0.36.0 minor release with CHANGELOG covering all four phases.
- [ ] **Monday-bot outreach mail sent** — new-thread `forge-v036-0-living-docs-rollout-2026-04-24` with templates, schemas, validators, her backfill-list, and explicit fill-it-yourself instruction. `reply_expected: true`, `reply_sla_seconds: 172800`, `auto_schedule_wakeup: true`.
- [ ] Post-ship: one real monday-bot story run through end-to-end to confirm spec + ADR generation + main-agent context bound holds.
- [ ] Monday acks outreach mail; her first backfill PR opens (tracks her progress but is not gated by us).
- [ ] After 5+ real runs, measure spec-drift rate, ADR-fabrication rate, subagent cost delta; tune prompts.

Last updated: 2026-04-25 — `/coherent-plan` pass complete (9 MAJOR + 6 MINOR fixed in place: integration-branch delivery model, AC-X3 allowlist widened, AC-D6 functional-equivalence rewrite, sync spec/ADR locked, AC-C4 idempotency extended to no-decisions INDEX rows, AC-B2 lastUpdated location pinned to top-front-matter, project-index SKILL.md scope widened to scaffold+drift, AC-A1 verify rewritten with build prefix and fixture clarity, thread-name hedge resolved to fresh thread, checkpoint state synced to reality, terminology + measurement units clarified). Ready for `/delegate` Phase A.

— previous: 2026-04-24 — plan drafted; monday-outreach step added per user correction; awaiting user approval.
