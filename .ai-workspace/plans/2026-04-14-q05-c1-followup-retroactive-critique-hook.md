# Q0.5/C1 Follow-up — Retroactive-Critique Hook (Option B) + ac-lint-hook.sh polish

> **Type:** Implementation plan for the deferred half of Q0.5/C1 — adds `evaluationMode: "critic"` to `forge_evaluate`, unparks the retroactive-critique hook materials, and folds in 9 polish items against `scripts/ac-lint-hook.sh`.
>
> **Parent plan:** `.ai-workspace/plans/2026-04-13-q05-c1-ac-lint-hook-conversion.md` (C1-original, merged as v0.27.0 in PR #177 commit `5e9bcf6`).
>
> **Date:** 2026-04-14
> **Author:** forge-plan (planner) → swift-henry (implementer)
> **Thread:** `q05-c1`

## ELI5

Yesterday we shipped half of a "watch the prompt rules" system — the half that deterministically lints plan files (`scripts/ac-lint-hook.sh`). The other half — re-running the LLM critic against all plan files when someone edits a prompt rule file — got deferred because it tried to call `forge_evaluate` in a `"critic"` mode that does not exist. The `forge_evaluate` MCP tool only knows four modes today (`story`, `coherence`, `divergence`, `smoke-test`). The hook script we wrote points at a fifth one that nobody implemented.

This follow-up does two things at once:

1. **Build the missing mode.** Add `"critic"` as a fifth `evaluationMode` in `server/tools/evaluate.ts`. When called in critic mode, it loads every `.ai-workspace/plans/*.json`, runs the existing critic prompt against each, and returns a single combined findings list. ~100 LOC + tests, mostly plumbing — no new prompts, no new types, just wiring.
2. **Wake up the parked hook.** Move `retroactive-critique-hook.sh` + its tests + its 4 rule-file fixtures out of the gitignored `.deferred-c1-retroactive/` parking dir and into the live tree. Add a second `PostToolUse` entry in `.claude/settings.json` so the hook fires when prompt rule files get edited. Delete the now-redundant `.github/workflows/retroactive-critique.yml` stub.

While we're in `scripts/ac-lint-hook.sh` anyway, fix the 9 polish items that two independent reviewers (forge-plan T1020 round-0 + swift-henry's /ship Stage 5 self-review) flagged — bash error-propagation glitches, a glob that's too loose, a `pwd`-based path fallback that's brittle, and a perf nit (re-lints every plan file on every edit).

When this PR merges, both halves of Q0.5/C1 are live: deterministic plan-file linting AND LLM rule-file critic, both as same-turn `PostToolUse` hooks, both free on Max OAuth, both catching drift at edit time.

## Context

### What shipped in C1-original (PR #177, v0.27.0)

| Artifact | Status |
|---|---|
| `.claude/settings.json` (one PostToolUse entry: ac-lint) | live |
| `scripts/ac-lint-hook.sh` (66 lines) | live, 5/5 unit tests passing |
| `scripts/ac-lint-hook.test.sh` | live |
| `tests/fixtures/hook-stdin/{non-matching,malformed,plan-file}.json` | live |
| `.github/workflows/ac-lint.yml` | DELETED |
| `.github/workflows/retroactive-critique.yml` | KEPT IN PLACE per Option D (deletion deferred to this PR) |
| `server/validation/ac-lint.test.ts` reverse type-mirror check (+6 lines) | live (MINOR-5a) |

### What's parked, awaiting this PR

```
.deferred-c1-retroactive/
├── scripts/
│   ├── retroactive-critique-hook.sh        (last green, untouched since deferral)
│   └── retroactive-critique-hook.test.sh   (7/7 PASS at deferral time)
└── tests/fixtures/hook-stdin/
    ├── rule-ac-lint.json
    ├── rule-ac-subprocess.json
    ├── rule-critic.json
    └── rule-planner.json
```

The parked `retroactive-critique-hook.sh` already encodes the correct rule-file allowlist (`server/lib/prompts/critic.ts`, `planner.ts`, `shared/ac-subprocess-rules.ts`, `server/validation/ac-lint.ts`) and emits `hookSpecificOutput.additionalContext` with the directive text. The thing it gets wrong — the only reason it was parked — is that the directive references `evaluationMode: "critic"`, which doesn't exist on the `forge_evaluate` MCP tool surface yet. Building that mode is the unblock.

### The missing `critic` evaluationMode

Current schema (`server/tools/evaluate.ts:51-58`):

```ts
evaluationMode: z
  .enum(["story", "coherence", "divergence", "smoke-test"])
  ...
```

There is no fifth member. The handler dispatch in `evaluate.ts` (around lines ~180+ for story, ~240+ for coherence, ~350+ for divergence, plus smoke-test) needs a parallel `handleCriticEval` branch.

The semantics for critic mode are well-defined and already exercised in tests:
- Input: a list of plan-file paths (or "all plans under `.ai-workspace/plans/*.json`")
- For each plan: load it, run the existing critic prompt (`server/lib/prompts/critic.ts`) against it, collect findings
- Output: a combined findings array with `{planPath, findings: [...]}` per plan
- Cost tracked through `RunContext` like every other mode (`storyId`/`evalVerdict`/`estimatedCostUsd`/tagged-union pattern from PH-01)

No new prompt files. No new types beyond a small `CriticEvalReport`. The critic prompt already exists; what's missing is the wrapper that loads N plan files and fans out N critic calls.

### Why two reviewers flagged the same 5 things in `ac-lint-hook.sh`

forge-plan's round-0 review (T1020, mailed 2026-04-14) and swift-henry's /ship Stage 5 self-review (commits referenced in T1035) independently surfaced 5 polish items each, with heavy overlap. The intersection covers bash error-propagation patterns and glob anchoring — the kind of thing that's hard to spot in a single read but obvious to two cold readers. Filing them as one consolidated polish pass against the same file is the natural consolidation point.

Fold list — ALL 9 items must be addressed in this PR:

| ID | Source | File:line | Issue | Fix sketch |
|---|---|---|---|---|
| **E1** | #178 (ship review) | `scripts/ac-lint-hook.sh:35` | case-glob `*.ai-workspace/plans/*.json` matches `foo.ai-workspace/plans/bar.json` due to leading `*` | use `.ai-workspace/plans/*.json` or `*/.ai-workspace/plans/*.json` for proper anchoring |
| **E2** | #179 (ship review) | `scripts/ac-lint-hook.sh:48` | `${lint_output// /}` strips spaces only; trailing newline triggers false-dirty | `stripped="${lint_output//[[:space:]]/}"; [[ -z "$stripped" ]]` |
| **E3** | #180 (ship review) | `scripts/ac-lint-hook.sh:44` | full-sweep on every edit doesn't scale past current 9-plan corpus | pass `tool_input.file_path` through, lint only the touched file; reserve full-sweep for CI/bootstrap |
| **E4** | #181 (ship review) | `scripts/ac-lint-hook.sh:42` | `${CLAUDE_PROJECT_DIR:-$(pwd)}` fails if env unset and pwd is wrong | derive root from script location: `root="$(cd "$(dirname "$0")/.." && pwd)"` |
| **E5** | #182 (ship review) | `scripts/ac-lint-hook.sh:33` | `norm="${norm#./}"` is a no-op given leading `*` in case pattern | drop strip OR tighten pattern (ties into E1) |
| **M1** | T1020 (forge-plan round-0) | `scripts/ac-lint-hook.sh:20` | `node -e` `process.exit(2)` from data handler not propagated cleanly via bash command substitution; only works because `set -e` at outer scope catches it | check `$?` explicitly after the command substitution; emit explicit "stdin parse failed" diagnostic |
| **M2** | T1020 (forge-plan round-0) | `scripts/ac-lint-hook.sh:46` | `if ! lint_output=...; then :; fi` swallows linter crashes silently | on non-zero exit from `run-ac-lint.mjs`, emit `additionalContext` with "linter crashed" so the session author sees it |
| **M3** | T1020 (forge-plan round-0) | `scripts/ac-lint-hook.test.sh` test 4 | clean-lint test passes trivially because stub writes nothing — doesn't prove invocation ran | strengthen with a sentinel file-write in the stub; assert the sentinel exists post-run |
| **M4** | T1020 (forge-plan round-0) | `scripts/ac-lint-hook.test.sh` empty-stdin test | `rc != 0 && -n err` race depends on bash pipe behavior | rewrite to use a here-string or explicit `printf "" \|` and assert specific failure mode |

E1+E5 collapse into one fix (anchor the glob). E3 changes the public behavior of the hook from "full sweep" to "single-file lint" — implementer must verify `run-ac-lint.mjs` accepts a single-file argument or extend it to do so. If `run-ac-lint.mjs` does not yet support single-file mode, **stop and mail forge-plan** before extending it — that's a scope expansion that needs a decision.

## Architecture

### One PR, three locus changes

1. **`server/tools/evaluate.ts`** — add `"critic"` to the `evaluationMode` enum, add `handleCriticEval` handler, wire dispatch. Estimated +100 LOC excluding tests.
2. **`scripts/ac-lint-hook.sh`** — apply all 9 polish items. Estimated ~30 LOC delta.
3. **Unpark + wire retroactive-critique hook** — `git mv .deferred-c1-retroactive/scripts/* scripts/`, `git mv .deferred-c1-retroactive/tests/fixtures/hook-stdin/rule-*.json tests/fixtures/hook-stdin/`, add second PostToolUse entry to `.claude/settings.json`, delete `.github/workflows/retroactive-critique.yml`, delete the now-empty `.deferred-c1-retroactive/` directory and its `.gitignore` entry.

### `evaluationMode: "critic"` shape

```ts
// server/tools/evaluate.ts (sketch)
evaluationMode: z
  .enum(["story", "coherence", "divergence", "smoke-test", "critic"])
  ...

// New input field (optional; defaults to glob all plans under .ai-workspace/plans):
planPaths: z
  .array(z.string())
  .optional()
  .describe('Plan file paths to critique. If omitted, critic mode globs `.ai-workspace/plans/*.json`. Required only when caller wants to scope the sweep.'),
```

Handler responsibilities:
- Resolve `planPaths`: explicit list OR glob `.ai-workspace/plans/*.json` from `cwd` (use the `cwd` parameter; respect BUG-DIV-CWD fix from PR #151)
- For each plan: load JSON, validate via existing plan schema, run critic prompt via `trackedCallClaude(ctx, "critic-eval", "critic", ...)`
- Aggregate findings into `{planPath, findings: [...]}[]`
- Build `RunRecord` via the existing tagged-union pattern: `evaluationMode: "critic"`, `criticReport: {...}`, `estimatedCostUsd` populated from the underlying `trackedCallClaude` calls
- Failure mode: if any single plan errors, log it, continue with the rest, surface the error in the report (per coherence-eval pattern at lines ~329-332)

### Hook directive text after the fix

The unparked `retroactive-critique-hook.sh` currently emits a directive like "invoke forge_evaluate in critic mode". Once `evaluationMode: "critic"` exists, that directive is correct as-is. The hook script itself only needs the fixture allowlist updates if the rule file paths drifted (audit on unpark — they likely did NOT drift, since C1-bis didn't touch the prompt files).

### Single-file vs full-sweep lint (E3 design call)

Two viable architectures for the ac-lint hook:

| Mode | Pro | Con |
|---|---|---|
| **Full-sweep on every edit** (current) | catches cross-plan drift introduced by an edit elsewhere | re-lints all 9+ plans on every edit; slow as corpus grows |
| **Single-file lint via `tool_input.file_path` passthrough** | scales linearly with edit count; ~10x faster on large corpus | misses cross-plan rules (e.g., "no two plans may both be marked phase-active") |

**Decision: single-file by default.** Cross-plan rules don't exist in the current `ac-lint.ts` ruleset — verified at C1-bis time, every rule is intra-plan. If a future rule needs cross-plan visibility, that rule's introduction is the moment to revisit (and probably introduces a periodic full-sweep CI job anyway). Implementer: confirm zero cross-plan rules exist in `server/validation/ac-lint.ts` before applying E3 — if any do, **stop and mail forge-plan**. Also confirm `node scripts/run-ac-lint.mjs <single-file-path>` is supported today; if not, halt and mail forge-plan (extending `run-ac-lint.mjs` is a scope decision, not an implementer judgment call).

### What is explicitly NOT in scope

- No changes to the critic prompt itself (`server/lib/prompts/critic.ts`)
- No new MCP skill or tool surface beyond the `critic` enum value
- No `forge_coordinate` changes
- No `forge_generate` changes
- No `forge_plan` changes
- No new GitHub Actions workflows
- No changes to the existing `forge_evaluate` modes (story / coherence / divergence / smoke-test)
- No `MEMORY.md` or auto-memory edits
- No changes to `.gitignore` other than removing the `.deferred-c1-retroactive/` line
- No version bump beyond what `/ship` does automatically

`/coherent-plan` and the round-0 reviewer enforce this scope boundary.

## Binary Acceptance Criteria

- [ ] **AC-01 — `evaluationMode: "critic"` exists in the schema.**
  `grep -n '"critic"' server/tools/evaluate.ts` returns at least one match in the `z.enum(...)` line. The enum reads exactly: `["story", "coherence", "divergence", "smoke-test", "critic"]`.

- [ ] **AC-02 — Critic handler dispatch wired.**
  Calling `forge_evaluate` with `evaluationMode: "critic"` does NOT return the "unknown mode" or generic error path. A unit test exercises the dispatch with a minimal valid plan and asserts the handler executes (mocking `trackedCallClaude` is acceptable for the dispatch test).

- [ ] **AC-03 — Critic handler loads and critiques N plans.**
  Unit test in `server/tools/evaluate.test.ts` (or new `evaluate-critic.test.ts`): given two valid plan JSON fixtures, critic mode returns a report with `criticReport.results.length === 2`, each entry has a `planPath` and `findings` array, and `estimatedCostUsd > 0`. `trackedCallClaude` is mocked to return a deterministic critique payload.

- [ ] **AC-04 — Critic handler tolerates per-plan failures.**
  Unit test: given two plans where the second fails to parse, critic mode returns `criticReport.results.length === 2` where the second entry has a populated `error` field, the first entry has populated `findings`, and the overall mode does not throw.

- [ ] **AC-05 — Cost tracking matches the existing tagged-union shape.**
  The returned `RunRecord` includes `evaluationMode: "critic"`, `criticReport: {...}`, and `estimatedCostUsd` populated from the sum of mocked `trackedCallClaude` call costs. PH-01 RunRecord pattern (storyId/evalVerdict/estimatedCostUsd/tagged-union/graduateFindings) is followed; no fields are added to `RunRecord` outside the tagged union.

- [ ] **AC-06 — `scripts/retroactive-critique-hook.sh` is unparked, executable, and live.**
  `test -x scripts/retroactive-critique-hook.sh` exits 0. `test ! -e .deferred-c1-retroactive/scripts/retroactive-critique-hook.sh` exits 0. The hook reads stdin, exits 0 silently on non-matching paths, and emits the correct nested `hookSpecificOutput.additionalContext` JSON on rule-file matches. Rule-file allowlist (verified against current master): `server/lib/prompts/critic.ts`, `server/lib/prompts/planner.ts`, `server/lib/prompts/shared/ac-subprocess-rules.ts`, `server/validation/ac-lint.ts`.

- [ ] **AC-07 — Retroactive-critique hook tests pass.**
  `bash scripts/retroactive-critique-hook.test.sh` exits 0 with all subtests passing (the parked baseline was 7/7; the same count or higher must pass after unpark + any directive-text update for the now-real `critic` mode).

- [ ] **AC-08 — `.claude/settings.json` invokes BOTH hook scripts on Edit/Write/MultiEdit.**
  Both shapes are valid under the Claude Code hooks schema and the implementer may choose either:
  - **Shape A (two matcher entries):** PostToolUse contains two entries, each with `matcher: "Edit|Write|MultiEdit"` and one `hooks: [{type: "command", command: ...}]` entry — one for ac-lint, one for retroactive-critique.
  - **Shape B (one matcher entry, two commands):** PostToolUse contains one entry with `matcher: "Edit|Write|MultiEdit"` and `hooks: [{ac-lint command}, {retroactive-critique command}]`.
  Both retroactive-critique commands invoke `bash "$CLAUDE_PROJECT_DIR/scripts/retroactive-critique-hook.sh"`. The ac-lint command from C1-original is preserved verbatim. JSON validates against the documented schema. Verification: `jq '[.hooks.PostToolUse[] | .hooks[]?] | length' .claude/settings.json` returns `2` regardless of which shape is chosen (this counts total hook commands across all matcher entries).

- [ ] **AC-09 — `.github/workflows/retroactive-critique.yml` deleted.**
  `test ! -f .github/workflows/retroactive-critique.yml` exits 0. The CI workflow stub is gone; the hook is now the sole drift detector for prompt-rule edits.

- [ ] **AC-10 — `.deferred-c1-retroactive/` directory removed.**
  `test ! -e .deferred-c1-retroactive` exits 0. The corresponding line in `.gitignore` is also removed. No parked artifacts remain anywhere in the tree.

- [ ] **AC-11 — Rule-file fixtures unparked.**
  `test -f tests/fixtures/hook-stdin/rule-critic.json && test -f tests/fixtures/hook-stdin/rule-planner.json && test -f tests/fixtures/hook-stdin/rule-ac-subprocess.json && test -f tests/fixtures/hook-stdin/rule-ac-lint.json` exits 0. All 4 fixtures match the rule-file allowlist in AC-06.

- [ ] **AC-12 — All 9 ac-lint-hook.sh polish items applied (E1, E2, E3, E4, E5, M1, M2, M3, M4).**
  - **E1+E5:** the case pattern in `scripts/ac-lint-hook.sh` no longer has a leading-`*` anchor and no `./` strip. `grep -E 'case .* in' scripts/ac-lint-hook.sh` shows the corrected pattern.
  - **E2:** `grep -F '${lint_output//[[:space:]]/}' scripts/ac-lint-hook.sh` returns a match (or equivalent all-whitespace strip).
  - **E3:** the hook lints only the touched file (passes `tool_input.file_path` through to `run-ac-lint.mjs`). Verified by inspection AND by a unit test that asserts `run-ac-lint.mjs` is invoked with a single-file argument when the hook fires on a plan-file edit. **PRECONDITION:** `run-ac-lint.mjs` must accept a single-file path argument; if it does not, implementer halts and mails forge-plan before extending it (scope expansion gate).
  - **E4:** `grep -F 'CLAUDE_PROJECT_DIR' scripts/ac-lint-hook.sh` returns no fallback to `$(pwd)`; instead, the script derives root from `$(cd "$(dirname "$0")/.." && pwd)`.
  - **M1:** `grep -nE 'set -e|process\.exit\(2\)' scripts/ac-lint-hook.sh` shows an explicit `$?` check after the `node -e` command substitution, with a clear "stdin parse failed" stderr diagnostic on failure.
  - **M2:** the linter call site no longer uses `if ! lint_output=...; then :; fi`. On non-zero exit from `run-ac-lint.mjs`, the hook emits a `additionalContext` JSON that includes the literal substring `"linter crashed"` (or equivalent) so the session author sees it.
  - **M3:** `scripts/ac-lint-hook.test.sh` test 4 (clean lint) writes a sentinel file in the stub and asserts the sentinel exists post-run. The test no longer passes vacuously.
  - **M4:** `scripts/ac-lint-hook.test.sh` empty-stdin test uses a deterministic input shape (here-string or explicit `printf "" |`) and asserts a specific failure mode, not a generic `rc != 0`.

- [ ] **AC-13 — Manual integration test of the retroactive-critique hook in PR body.**
  In an active Claude Code session, edit `server/lib/prompts/critic.ts` with a no-op whitespace change. Confirm verbatim in PR body: (i) `retroactive-critique-hook.sh` fires, (ii) Claude's next text output reflects the injected directive (it invokes `forge_evaluate` in critic mode against all plan files), (iii) the critic sweep runs to completion in the same turn, (iv) findings (or "clean") are surfaced inline. This is the AC-09 Part B that was deferred from C1-original.

- [ ] **AC-14 — Negative-space (no scope creep).**
  PR diff includes ONLY:
  - Modified: `server/tools/evaluate.ts` (+~100 LOC for critic mode)
  - Added: `server/tools/evaluate-critic.test.ts` OR additions to existing `evaluate.test.ts`
  - Modified: `scripts/ac-lint-hook.sh` (~30 LOC delta for E1-E5 + M1-M2)
  - Modified: `scripts/ac-lint-hook.test.sh` (M3 + M4 test strengthening)
  - Added: `scripts/retroactive-critique-hook.sh` (unparked from `.deferred-c1-retroactive/`)
  - Added: `scripts/retroactive-critique-hook.test.sh` (unparked)
  - Added: `tests/fixtures/hook-stdin/rule-{critic,planner,ac-subprocess,ac-lint}.json` (unparked)
  - Modified: `.claude/settings.json` (+1 PostToolUse entry)
  - Deleted: `.github/workflows/retroactive-critique.yml`
  - Modified: `.gitignore` (remove `.deferred-c1-retroactive/` line)
  - Modified: `.ai-workspace/plans/2026-04-13-q05-c1-ac-lint-hook-conversion.md` (final stamp closing thread `q05-c1`). **Note:** the C1-original plan was already re-stamped by forge-plan in a prior commit on master (the post-merge checkpoint update). swift-henry's PR diff against master will show only the final-closure delta on top of that prior re-stamp, not a full rewrite.
  - Optional: `scripts/run-ac-lint.mjs` IF single-file support requires extension (gated by AC-12 E3 precondition + forge-plan approval)
  - **No** changes to `server/validation/ac-lint.ts`, `server/lib/prompts/*`, `server/tools/{coordinate,generate,plan}.ts`, MCP server modules, or any divergence/coherence/story/smoke-test eval code paths.
  - **No** new GitHub Actions.
  - **No** new MCP skill.
  - `/coherent-plan` flags any draft that violates this AC.

## Test Cases & AC verification

Each AC is binary (pass/fail with no interpretation). Verification commands:

| AC | Verification command |
|---|---|
| AC-01 | `grep -n '"critic"' server/tools/evaluate.ts` returns ≥1 match in the `z.enum` line |
| AC-02 | `npx vitest run server/tools/evaluate-critic.test.ts -t dispatch` exits 0 |
| AC-03 | `npx vitest run server/tools/evaluate-critic.test.ts -t "two plans"` exits 0 |
| AC-04 | `npx vitest run server/tools/evaluate-critic.test.ts -t "per-plan failure"` exits 0 |
| AC-05 | `npx vitest run server/tools/evaluate-critic.test.ts -t "RunRecord shape"` exits 0 |
| AC-06 | `test -x scripts/retroactive-critique-hook.sh && test ! -e .deferred-c1-retroactive/scripts/retroactive-critique-hook.sh` exits 0 |
| AC-07 | `bash scripts/retroactive-critique-hook.test.sh` exits 0 |
| AC-08 | `jq '[.hooks.PostToolUse[] \| .hooks[]?] \| length' .claude/settings.json` returns `2` (counts total hook commands across all matcher entries — works for both Shape A and Shape B) |
| AC-09 | `test ! -f .github/workflows/retroactive-critique.yml` exits 0 |
| AC-10 | `test ! -e .deferred-c1-retroactive && ! grep -q '.deferred-c1-retroactive' .gitignore` exits 0 |
| AC-11 | `for f in rule-critic rule-planner rule-ac-subprocess rule-ac-lint; do test -f "tests/fixtures/hook-stdin/$f.json" \|\| exit 1; done` exits 0 |
| AC-12 | `bash scripts/ac-lint-hook.test.sh` exits 0 AND inspection confirms each of E1-E5 + M1-M4 per the per-item verification in the AC body |
| AC-13 | PR body contains verbatim observation transcript of the manual integration test |
| AC-14 | PR diff scoped to the exact file list above; `/coherent-plan` flags violations |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `run-ac-lint.mjs` does not support single-file mode and extending it expands scope | MEDIUM | AC-12 E3 precondition gate: implementer halts and mails forge-plan before extending. forge-plan decides between (a) extend in-scope, (b) defer E3 to a later PR. |
| critic mode handler accidentally pattern-matches against coherence handler instead of staying minimal (~100 LOC bloats) | MEDIUM | AC-14 negative-space + round-0 reviewer's diff scope check. If LOC > 200, round-0 flags it. |
| `trackedCallClaude` mocking in tests doesn't match real cost shape and AC-05 passes vacuously | LOW | Use the same mock pattern as `evaluate.test.ts` coherence-eval tests (PH-01 already established this). |
| Unparked hook directive text still references a wrong field name now that critic mode exists | LOW | AC-13 manual integration test catches it (live invocation against the real MCP tool). |
| Cross-plan ac-lint rules exist after all and E3 silently disables them | MEDIUM | AC-12 E3 precondition: implementer audits `server/validation/ac-lint.ts` for any cross-plan rule before applying E3; halts and mails forge-plan if any exist. |
| Manual integration test (AC-13) reveals the same-turn timing semantic doesn't hold for the rule-file hook even though it held for the plan-file hook | LOW (already validated structurally) | STOP-and-mail rule applies. C1-original AC-09 Part A established the mechanism; AC-13 is the second-instance confirmation. |
| `.claude/settings.json` second entry misformats the JSON and breaks the live ac-lint hook on the same machine running the implementation | LOW | Implementer runs `jq '.' .claude/settings.json` before committing; broken JSON makes both hooks silently no-op, which the AC-13 manual test would catch immediately. |

## Implementation order (for swift-henry — implementer)

This plan file is owned by **forge-plan (planner)**. swift-henry's job is to implement against this plan, NOT to redraft it. If anything is unclear, ambiguous, or appears wrong, mail forge-plan in thread `q05-c1` BEFORE writing code.

1. Read this file end-to-end. If anything is unclear, mail forge-plan.
2. **Audit gate for E3:** read `server/validation/ac-lint.ts` and grep for any rule that inspects more than one plan at a time. If any exist, STOP and mail forge-plan. Otherwise proceed.
3. **Audit gate for run-ac-lint.mjs:** check whether `node scripts/run-ac-lint.mjs <single-file>` is already supported. If not, STOP and mail forge-plan. Otherwise proceed.
4. Branch off latest master: `git checkout master && git pull && git checkout -b feat/q05-c1-followup-retroactive-critique`
5. **evaluate.ts critic mode** (AC-01, AC-02, AC-03, AC-04, AC-05):
   a. Add `"critic"` to the `evaluationMode` enum
   b. Add `planPaths` optional input field
   c. Add `handleCriticEval` handler (load plans → fan out critic calls → aggregate → RunRecord)
   d. Wire dispatch in the main handler switch
   e. Add tests in `evaluate-critic.test.ts` (or extend `evaluate.test.ts`)
   f. `npx vitest run` clean
6. **ac-lint-hook.sh polish** (AC-12):
   a. Apply E1+E5 (anchor the glob, drop `./` strip)
   b. Apply E2 (all-whitespace strip)
   c. Apply E4 (script-location-derived root)
   d. Apply M1 (explicit `$?` check after `node -e`)
   e. Apply M2 (linter-crashed additionalContext on non-zero exit)
   f. Apply E3 (single-file lint passthrough) — ONLY after Step 2/3 audit gates passed
   g. Update `ac-lint-hook.test.sh` for M3 (sentinel) and M4 (deterministic empty-stdin)
   h. `bash scripts/ac-lint-hook.test.sh` clean
7. **Unpark retroactive-critique materials** (AC-06, AC-07, AC-10, AC-11):
   a. `git mv .deferred-c1-retroactive/scripts/retroactive-critique-hook.sh scripts/`
   b. `git mv .deferred-c1-retroactive/scripts/retroactive-critique-hook.test.sh scripts/`
   c. `git mv .deferred-c1-retroactive/tests/fixtures/hook-stdin/rule-*.json tests/fixtures/hook-stdin/`
   d. `rmdir .deferred-c1-retroactive/scripts .deferred-c1-retroactive/tests/fixtures/hook-stdin .deferred-c1-retroactive/tests/fixtures .deferred-c1-retroactive/tests .deferred-c1-retroactive`
   e. Edit `.gitignore` to remove the `.deferred-c1-retroactive/` line
   f. Audit unparked hook script: confirm rule-file allowlist still matches current master paths; if any drifted (e.g., `critic.ts` was moved), update the allowlist before running tests
   g. Audit unparked hook directive text: confirm it references `evaluationMode: "critic"` exactly as the new schema expects
   h. Apply the same E4 hardening to `retroactive-critique-hook.sh` that AC-12 applies to `ac-lint-hook.sh`: replace any `${CLAUDE_PROJECT_DIR:-$(pwd)}` fallback with `root="$(cd "$(dirname "$0")/.." && pwd)"`. Both hooks should use the same path-resolution idiom for consistency.
   i. `bash scripts/retroactive-critique-hook.test.sh` clean (target ≥7/7)
8. **Wire .claude/settings.json second entry** (AC-08):
   a. Add second PostToolUse entry mirroring the ac-lint entry's shape
   b. `jq '.' .claude/settings.json` validates
9. **Delete the CI stub** (AC-09): `git rm .github/workflows/retroactive-critique.yml`
10. **Manual integration test** (AC-13):
    a. In an active Claude Code session, make a no-op whitespace edit to `server/lib/prompts/critic.ts`
    b. Capture verbatim: did the hook fire? did Claude invoke `forge_evaluate` critic mode? did the sweep complete? were findings surfaced?
    c. Paste transcript into PR body
11. **Negative-space scope check** (AC-14): `git diff --stat master` matches the file list in AC-14 exactly
12. **Final stamp on parent plan**: edit `.ai-workspace/plans/2026-04-13-q05-c1-ac-lint-hook-conversion.md` to mark the deferred section RESOLVED and link this PR
13. Open PR via `/ship` skill (full pipeline, including Stage 5 self-review)
14. Mail forge-plan in thread `q05-c1` for round-0 code review (forge-plan spawns a fresh stateless Agent subagent against the diff)
15. Address any round-0 findings (none expected to be CRITICAL/MAJOR if AC-14 holds)
16. Merge

## Checkpoint

- [x] forge-plan: receive swift-henry T1035 merge notification (PR #177 → v0.27.0, commit 5e9bcf6)
- [x] forge-plan: re-stamp C1-original plan checkpoint to DONE (`.ai-workspace/plans/2026-04-13-q05-c1-ac-lint-hook-conversion.md`)
- [x] forge-plan: fetch GH issues #178-#182 details for fold list
- [x] forge-plan: inspect `.deferred-c1-retroactive/` parking dir contents
- [x] forge-plan: inspect `server/tools/evaluate.ts` evaluationMode enum + handler shape
- [x] forge-plan: draft this follow-up plan file
- [x] forge-plan: run `/coherent-plan` against this plan file (1 MAJOR + 3 MINOR, all 4 fixed in-place)
- [ ] forge-plan: commit + push the C1-original plan re-stamp + this follow-up plan file to forge-harness master (separate from swift-henry's PR)
- [ ] forge-plan: mail swift-henry with this plan path + thread `q05-c1` continuation + audit gate reminders (Step 2 + Step 3)
- [ ] swift-henry: read this plan file
- [ ] swift-henry: Step 2 audit gate (cross-plan ac-lint rules)
- [ ] swift-henry: Step 3 audit gate (run-ac-lint.mjs single-file support)
- [ ] swift-henry: AC-01 — critic enum value added
- [ ] swift-henry: AC-02 — critic dispatch wired
- [ ] swift-henry: AC-03 — critic handler critiques N plans (test passes)
- [ ] swift-henry: AC-04 — per-plan failure tolerance (test passes)
- [ ] swift-henry: AC-05 — RunRecord cost-tracking shape (test passes)
- [ ] swift-henry: AC-06 — retroactive-critique-hook.sh unparked + executable
- [ ] swift-henry: AC-07 — retroactive-critique-hook.test.sh ≥7/7 PASS
- [ ] swift-henry: AC-08 — .claude/settings.json second PostToolUse entry
- [ ] swift-henry: AC-09 — retroactive-critique.yml deleted
- [ ] swift-henry: AC-10 — .deferred-c1-retroactive/ directory + .gitignore line removed
- [ ] swift-henry: AC-11 — 4 rule-file fixtures unparked
- [ ] swift-henry: AC-12 — all 9 ac-lint-hook.sh polish items applied
- [ ] swift-henry: AC-13 — manual integration test transcript in PR body
- [ ] swift-henry: AC-14 — negative-space verified
- [ ] swift-henry: PR opened via /ship, mailed forge-plan in thread q05-c1 for round-0
- [ ] forge-plan: round-0 code review via fresh stateless subagent
- [ ] swift-henry: address any round-0 findings
- [ ] PR merged
- [ ] forge-plan: stamp parent plan with thread closure, update Q0.5 closure tally

Last updated: 2026-04-14T10:42:00+08:00 — initial draft. Awaiting /coherent-plan pass before mailing swift-henry.
