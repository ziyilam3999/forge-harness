# Q0.5/C1 + A1c — Combined Hook Conversion (Shape 4 / Option B)

## Deferred — retroactive-critique hook (BUG-C1-CRITIC-MODE)

**Decision date:** 2026-04-13T23:20 (forge-plan mail, thread `q05-c1`).

AC-02 and the entire retroactive-critique hook path are **deferred to a follow-up PR**. Reason: AC-02 instructs the hook to direct Claude to invoke `forge_evaluate` in `"critic mode"`, but the actual `forge_evaluate` MCP tool schema only exposes `evaluationMode` values `story | coherence | divergence | smoke-test`. There is no `critic` mode. The plan's AC-02 was written conflating "the critic subagent prompt" (an internal implementation detail of evaluate modes) with "a top-level critic evaluationMode" (which does not exist).

**What ships in this PR (`feat/q05-c1-ac-lint-hooks-v2`):**
- ac-lint hook only (`scripts/ac-lint-hook.sh` + 5/5 unit tests)
- `.claude/settings.json` with the ac-lint PostToolUse entry only
- `.github/workflows/ac-lint.yml` deletion (replaced by hook)
- MINOR-5a reverse type-mirror check in `ac-lint.test.ts` (round-1 follow-up from C1-bis)
- AC-09 Part A enforcement-mechanism evidence (the same-turn injection property was validated by accidentally firing the parked retroactive-critique hook during C1-bis work — see PR body for verbatim transcript)

**What is deferred (new PR, plan TBD by forge-plan):**
- `scripts/retroactive-critique-hook.sh` (parked at `.deferred-c1-retroactive/scripts/`)
- `scripts/retroactive-critique-hook.test.sh` (parked, 7/7 last green)
- Rule-file fixture JSONs (parked at `.deferred-c1-retroactive/tests/fixtures/hook-stdin/`)
- `.github/workflows/retroactive-critique.yml` (kept in place — until the replacement hook ships, the CI workflow stub is the only nominal drift detector and deleting it now would create a coverage gap)
- AC-02 (this AC) — see strikethrough below
- AC-09 Part B (was going to test retroactive-critique fire — defer to follow-up)
- BUG-C1-CRITIC-MODE — file as MAJOR in follow-up PR backlog

**Follow-up plan file:** to be drafted by **forge-plan** (NOT swift-henry) at `.ai-workspace/plans/2026-04-14-q05-c1-followup-retroactive-critique-hook.md` (or whichever date forge-plan picks). Will decide between Option B (implement `evaluationMode: "critic"` in `evaluate.ts`, ~100 LOC) and a cleaner alternative.

---



> **Type:** Implementation plan for the combined C1 (retroactive critique) + A1c (ac-lint) conversion from CI workflows to Claude Code `PostToolUse` hooks. Supersedes the previous CI-based shapes for both items.
>
> **Parent plan:** `.ai-workspace/plans/2026-04-12-next-execution-plan.md` lines 234-247 (C1) and 168-185 (A1/A1c).
>
> **Date:** 2026-04-13
> **Author:** forge-plan (planner) → swift-henry (implementer)
> **Architectural decision context:** Three sequential planner errors led here: (1) original C1 plan didn't account for Max-plan billing constraint; (2) first revision proposed a hybrid (S3); (3) second revision (Shape 4) had a wrong hook API schema. User pushed back on hybrid → user picked Option B (combined scope) when the cascade between C1's stub and A1c's preflight gate surfaced. This plan reflects all three corrections.

## ELI5

The repo currently has two checkpoint guards as GitHub Actions: one that lints plan files (`ac-lint.yml`) and one that re-runs the LLM critic against plan files when prompt rules change (`retroactive-critique.yml`, currently a stub). Both want to catch drift between prompt rules and plan files. Both should run automatically without human memory.

Problem: the LLM-based one (C1) needs Anthropic API credit in CI, which costs money — but the user is on Claude Max plan and explicitly does not want extra API-key billing. So we cannot run it as a GitHub Action.

Solution: convert BOTH to Claude Code `PostToolUse` hooks. When you edit a prompt rule file, a hook fires and runs the critic sweep right then in the same Claude turn (free, on Max OAuth). When you edit a plan file, a different hook fires and runs the deterministic ac-lint sweep right then. No CI workflows for either, no API billing, no human-memory dependency. Both kinds of drift get caught at the moment of edit instead of at merge time.

The same architectural rule applies to both: *hooks for edit-time enforcement, GitHub Actions only for cron schedules and remote PR events*. The two CI workflow files (`ac-lint.yml` + `retroactive-critique.yml`) get deleted; one hook config file (`.claude/settings.json`) and two small bash scripts replace them.

## Context

### What exists today on master

| File | Lines | Status | Calls Anthropic API? |
|---|---|---|---|
| `.github/workflows/ac-lint.yml` | 40 | **SHIPPED** — runs `node scripts/run-ac-lint.mjs` advisory-only on every PR. Has a preflight gate at lines 22-28 that requires `retroactive-critique.yml` to exist. | No — pure deterministic JS linter |
| `server/validation/ac-lint.ts` | 176 | **SHIPPED** — full linter implementation. Stays unchanged. | No |
| `scripts/run-ac-lint.mjs` | unknown | **SHIPPED** — invoked by both the CI workflow and (future) the hook script. Stays unchanged. | No |
| `.github/workflows/retroactive-critique.yml` | 18 | **STUB ONLY** — `on: workflow_dispatch`, no automatic triggers, comment says "Q0.5/C1 not yet implemented." Exists ONLY to satisfy ac-lint.yml's preflight gate. | No (it's a no-op) |

### The cascade that drove Option B

Deleting `retroactive-critique.yml` (necessary for C1's hook conversion) breaks `ac-lint.yml`'s preflight gate, which would block every PR thereafter. Patching the preflight (Option A) is feasible but leaves architectural inconsistency: hooks for one drift-detector, CI for another. Option B (this plan) deletes both CI workflows together and ships both as hooks in one PR. Cleaner; one architectural pattern; no stale CI files.

### Verified API claims (literal docs, not subagent guesses)

Per swift-henry's WebFetch of `https://code.claude.com/docs/en/hooks` (T1745 mail), the verified hook schema is:

- **Event:** `PostToolUse`, fires after a tool call succeeds, **same turn** as the tool call (Claude reads the injected context immediately before its next response, not in a future turn)
- **Stdin format:** JSON containing `tool_name` and `tool_input.file_path` for Edit/Write/MultiEdit
- **Matcher syntax:** regex string like `"Edit|Write|MultiEdit"`, **case-sensitive**
- **Response schema (NESTED, not top-level):**
  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "PostToolUse",
      "additionalContext": "directive text Claude reads as a system reminder"
    }
  }
  ```
- **Exit code:** `0` + JSON on stdout = "continue with added context"; `2` = block downstream behavior; non-zero non-2 = non-blocking error
- **Settings file location:** `.claude/settings.json` at project root, committed to repo, project-scoped overrides global

The timing semantic ("same turn") is a structural inference from the docs (PostToolUse fires after a tool call within the current turn → its added context applies within that turn), not a literal doc statement. AC-09 (manual integration test) is the hands-on verification.

## Architecture

### Single-locus PostToolUse hooks

- **One file** for hook config: `.claude/settings.json` with TWO `PostToolUse` hook entries
- **Two bash scripts**, each handling one drift class:
  - `scripts/retroactive-critique-hook.sh` — fires on edits to rule files (critic.ts, planner.ts, ac-subprocess-rules.ts, ac-lint.ts), directs Claude to invoke `forge_evaluate` in critic mode against all plan files
  - `scripts/ac-lint-hook.sh` — fires on edits to plan files (`.ai-workspace/plans/*.json`), runs `node scripts/run-ac-lint.mjs` and emits findings via `additionalContext`
- **Two CI workflow files DELETED:** `.github/workflows/ac-lint.yml` and `.github/workflows/retroactive-critique.yml`
- **No other artifacts:** no hash file, no drift report file, no exemptions file, no new MCP skill, no MCP server changes

### Property boundary (design, not limitation)

Same-turn enforcement is the **strictest possible enforcement boundary the hook API supports.** When a Claude session edits a rule file or a plan file via Edit/Write/MultiEdit, the corresponding hook fires immediately and Claude reads the injected directive before producing its next response. Claude cannot skip the directive without an explicit user `ctrl-c` (a deliberate user choice, not a "forgot to" failure).

Trade-offs (not limitations — these are accepted properties of the design):
- **Mid-task interruption:** editing a rule file as file 3 of a 5-file refactor pauses the refactor for the sweep before continuing. Mitigation: edit rule files at task boundaries, not in the middle of multi-step tasks.
- **Sweep cost on every edit:** every rule edit triggers the LLM sweep (~30s-2min depending on plan count). Mitigation: rule-file edits should be deliberate, not iterative; iterate in scratch files first.
- **Edit-then-context-switch wastes work:** editing a rule file as part of a larger multi-edit sequence triggers a sweep against an incomplete rule state. Mitigation: edit rule files LAST in a task chunk so the sweep runs against the final state.

Property boundary (the one real edge case):
- **Hook is scoped to Claude-mediated edits.** If a rule file or plan file is edited outside an active Claude Code session (vim, VS Code native edit, `sed -i`, manual `git apply`), the hook does not fire. This is rare in our workflow (single-developer, Max-plan, Claude-mediated) and self-correcting (the next Claude-mediated edit to ANY rule or plan file surfaces the drift).

### Architectural rule established by this PR

> **Hooks for edit-time drift-detection on tracked files. GitHub Actions for everything hooks cannot observe — cron schedules, PR/merge events, CI test runners, and any other event type outside the Edit/Write/MultiEdit tool surface.**

This rule applies prospectively: any future drift-detection or validation that needs to fire on file edits should be a Claude Code hook, not a CI workflow. CI workflows remain valid (and necessary) for things hooks cannot observe — daily cron jobs (e.g., `q0-l4-deadline.yml`), PR-merge events (e.g., `q0-l4-anchor-fill.yml`), test runners that must execute regardless of who/what made the commit (e.g., the existing `ci.yml`), and any other surface where the trigger isn't a Claude-mediated file edit.

## Binary Acceptance Criteria

- [ ] **AC-01 — `.claude/settings.json` exists** at the project root (`forge-harness/`), committed to git, with TWO `PostToolUse` hook configurations:
  - Hook 1: matcher `"Edit|Write|MultiEdit"`, command `"bash scripts/retroactive-critique-hook.sh"`
  - Hook 2: matcher `"Edit|Write|MultiEdit"`, command `"bash scripts/ac-lint-hook.sh"`
  - Both configs at the project level (not user-level), so they apply to anyone with the repo cloned and Claude Code installed.
  - JSON validates against the documented Claude Code hooks schema.

- [ ] ~~**AC-02 — `scripts/retroactive-critique-hook.sh` exists**~~ **DEFERRED — see "Deferred — retroactive-critique hook" section above. The directive text references `forge_evaluate` "critic mode" which does not exist as an `evaluationMode` in the actual MCP tool schema. Tracked as BUG-C1-CRITIC-MODE.** Original AC text below for reference only:
- [ ] ~~`scripts/retroactive-critique-hook.sh` exists, is executable (`chmod +x`), uses `set -euo pipefail`, and:~~
  - Reads JSON on stdin (Claude Code passes `tool_name` + `tool_input` as JSON)
  - Extracts `tool_input.file_path`
  - Exits 0 silently if the path does not match the rule-file allowlist (fast path — must be cheap because it runs on every Edit/Write)
  - Rule-file allowlist (hardcoded, exact matches): `server/lib/prompts/critic.ts`, `server/lib/prompts/planner.ts`, `server/lib/prompts/shared/ac-subprocess-rules.ts`, `server/validation/ac-lint.ts`
  - On match: emits the nested `hookSpecificOutput.additionalContext` JSON response on stdout with directive text instructing Claude to invoke `forge_evaluate` in critic mode against every `.ai-workspace/plans/*.json` file before producing its next response
  - Exits 0 after emitting the JSON

- [ ] **AC-03 — `scripts/ac-lint-hook.sh` exists**, is executable, uses `set -euo pipefail`, and:
  - Same stdin reading + path extraction as AC-02
  - Exits 0 silently if `tool_input.file_path` does not match the glob pattern `.ai-workspace/plans/*.json`
  - On match: invokes `node scripts/run-ac-lint.mjs` (the existing deterministic linter) against all plan files, captures stdout/stderr
  - If lint output is non-empty (findings present): emits the nested `hookSpecificOutput.additionalContext` JSON with the lint findings as the directive text, instructing Claude to surface them to the user
  - If lint output is empty (clean): emits nothing or emits a minimal "ac-lint clean" additionalContext (implementer choice — verify what the docs say about empty additionalContext)
  - Exits 0 in both cases

- [ ] **AC-04 — Both hook scripts have unit tests** in `scripts/` (e.g., `retroactive-critique-hook.test.sh` and `ac-lint-hook.test.sh`) that cover:
  - (a) Non-matching path → exit 0 silently, no stdout output
  - (b) Each matching path in the allowlist → emit correct nested JSON shape, exit 0
  - (c) Malformed stdin (truncated JSON, empty stdin) → exit non-zero with clear error on stderr
  - (d) For ac-lint-hook specifically: clean lint run AND dirty lint run, both produce correct output shapes
  - Tests runnable as `bash scripts/retroactive-critique-hook.test.sh` and `bash scripts/ac-lint-hook.test.sh` with exit 0 on pass

- [ ] **AC-05 — `.github/workflows/retroactive-critique.yml` deleted** from the repo. Verify with `test ! -f .github/workflows/retroactive-critique.yml`.

- [ ] **AC-06 — `.github/workflows/ac-lint.yml` deleted** from the repo. Verify with `test ! -f .github/workflows/ac-lint.yml`. **Cascade resolution:** because both the workflow and its preflight target are deleted in the same PR, no preflight gate breakage occurs. Future PRs will not reference either deleted file.

- [ ] **AC-07 — Bootstrap rule sweep** completed and committed in the same PR. Invocation context: from an **active Claude Code session** via the MCP tool `mcp__forge__forge_evaluate` in critic mode (NOT as a CLI command, NOT in a CI runner — the MCP server only spawns from a Claude session). Run against every `.ai-workspace/plans/*.json` file. Any drift findings from the new C1 hook (which would have fired on the next rule-file edit) are pre-emptively detected and either: (a) the affected plan files are updated to resolve the finding, OR (b) the finding is grandfathered with an inline comment in the plan file documenting the rationale. Zero unresolved drift findings before merging.

- [ ] **AC-08 — Bootstrap lint sweep** completed and committed in the same PR: manual `node scripts/run-ac-lint.mjs` invoked against every plan file. Any lint findings handled the same way as AC-07 (resolve or grandfather). Zero unresolved lint findings before merging. **Note:** AC-07 and AC-08 cover the "hook can't observe its own birth" gap — hooks only fire on FUTURE edits, so the existing plan files would never trigger either hook on their own. Bootstrap sweeps catch existing drift one time at install.

- [ ] **AC-09 — Manual integration test** documented in PR body. Two parts:
  - **Part A (rule hook):** edit `server/lib/prompts/critic.ts` with a no-op whitespace change inside an active Claude Code session. Confirm: (i) the `retroactive-critique-hook.sh` fires, (ii) Claude's next text output reflects the injected directive (i.e., it invokes `forge_evaluate` in critic mode before any other action), (iii) the sweep runs to completion in the same turn, (iv) any findings are surfaced inline. Document the observed behavior verbatim in the PR body.
  - **Part B (plan hook):** edit any `.ai-workspace/plans/*.json` file with a no-op whitespace change. Confirm: (i) `ac-lint-hook.sh` fires, (ii) ac-lint runs against all plan files, (iii) findings (or "clean" status) appear in Claude's next response, (iv) Claude does not skip or defer the surfacing. Document verbatim in PR body.
  - **If either Part A or Part B reveals the timing semantic isn't actually same-turn (i.e., the directive doesn't appear until the NEXT turn), STOP and mail back.** This is the load-bearing API claim that hands-on testing validates definitively.

- [ ] **AC-10 — Negative-space (no scope creep)**: the PR diff includes ONLY:
  - Added: `.claude/settings.json`
  - Added: `scripts/retroactive-critique-hook.sh`
  - Added: `scripts/ac-lint-hook.sh`
  - Added: `scripts/retroactive-critique-hook.test.sh`
  - Added: `scripts/ac-lint-hook.test.sh`
  - Added: `tests/fixtures/hook-stdin/*.json` (test fixture files for AC-04 unit tests — at least: `non-matching.json`, one fixture per rule-file allowlist entry, one plan-file fixture, one malformed-stdin fixture)
  - Deleted: `.github/workflows/retroactive-critique.yml`
  - Deleted: `.github/workflows/ac-lint.yml`
  - Modified: any `.ai-workspace/plans/*.json` files updated by AC-07/AC-08 bootstrap sweeps (resolve or grandfather)
  - Modified: `.ai-workspace/plans/2026-04-12-next-execution-plan.md` lines 234-247 (C1 section) and 168-185 (A1/A1c section) — stamped by forge-plan during round-0 review, not by swift-henry directly
  - **No CI workflow files added.** No hash file. No drift report file. No exemptions file. No new MCP skill. No new MCP server modules. No `server/lib/coordinator.ts` changes. No `server/validation/ac-lint.ts` changes (linter logic is unchanged; only the trigger surface moves).
  - `/coherent-plan` flags any draft that violates this AC.

## Test Cases & AC verification

Each AC is binary (pass/fail with no interpretation). Verification commands:

| AC | Verification |
|---|---|
| AC-01 | `test -f .claude/settings.json` exits 0 AND the file contains two PostToolUse hook entries (one matching the rule-file allowlist, one matching plan files). **Implementer note:** the exact `jq` query depends on the literal Claude Code hooks config schema — re-fetch `https://code.claude.com/docs/en/hooks` at implementation time to get the canonical config-file shape, then write a verification command that asserts both hook entries are present. Do NOT guess the schema. |
| AC-02 | `test -x scripts/retroactive-critique-hook.sh` exits 0 AND `bash scripts/retroactive-critique-hook.sh < tests/fixtures/hook-stdin/non-matching.json` exits 0 with no stdout output |
| AC-03 | `test -x scripts/ac-lint-hook.sh` exits 0 AND `bash scripts/ac-lint-hook.sh < tests/fixtures/hook-stdin/non-matching.json` exits 0 with no stdout output |
| AC-04 | `bash scripts/retroactive-critique-hook.test.sh && bash scripts/ac-lint-hook.test.sh` both exit 0 |
| AC-05 | `test ! -f .github/workflows/retroactive-critique.yml` exits 0 |
| AC-06 | `test ! -f .github/workflows/ac-lint.yml` exits 0 |
| AC-07 | PR body documents the bootstrap rule sweep run (invoked from active Claude session via MCP) + zero unresolved findings |
| AC-08 | PR body documents the bootstrap lint sweep run + zero unresolved findings |
| AC-09 | PR body contains verbatim observation of both Part A and Part B in-session integration tests |
| AC-10 | PR diff scoped to the exact file list above; `/coherent-plan` flags violations |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Hook timing semantic is not actually same-turn (subagent inference, not literal docs text) | HIGH | AC-09 hands-on integration test resolves definitively. STOP-and-mail rule applies. |
| ac-lint-hook fires on every plan file edit, including small ones, making editing slow | MEDIUM | Sweep is deterministic (~1-2s for the current plan corpus) — acceptable. If sweep grows slow as plan corpus expands, defer to filtered sweep (single plan file instead of all) in a future iteration. |
| `.claude/settings.json` is committed to repo but other developers (if any) may not have Claude Code installed → hooks don't fire for them | LOW | Single-developer Max-plan workflow today. Multi-contributor scenarios are deferred per the C1 conversation; this risk is the same as the original C1 Shape 4 risk and is accepted. |
| Bootstrap sweeps (AC-07, AC-08) surface a large drift backlog that's hard to triage | LOW | Grandfather aggressively in this PR; defer fixes to follow-up PRs. The point of the bootstrap is to establish a clean baseline, not to clean up history in one shot. |
| Plan checkboxes for A1/A1c stay stale because the implementation is being rewritten, not just rechecked | LOW | forge-plan stamps the master plan revision during round-0 review; A1/A1c get marked as `[shipped via CI, then converted to hook in this PR]` rather than checked. |

## Implementation order (for swift-henry — implementer)

This plan file is owned by **forge-plan (planner)**. swift-henry's job is to **implement against this plan**, not to redraft it. If anything is unclear, ambiguous, or appears wrong, mail forge-plan with the question — do NOT improvise design choices.

1. Read this file end-to-end. If anything is unclear, mail forge-plan BEFORE writing code.
2. Create `.claude/settings.json` with the two hook configs (AC-01)
3. Create `scripts/retroactive-critique-hook.sh` + tests (AC-02, AC-04 partial)
4. Create `scripts/ac-lint-hook.sh` + tests (AC-03, AC-04 complete)
5. Run bootstrap sweeps (AC-07, AC-08), commit any plan file updates
6. Delete the two CI workflow files (AC-05, AC-06)
7. Run manual integration test (AC-09) in active Claude Code session, document in PR body
8. Open PR via `/ship` skill
9. Mail forge-plan when PR is open for round-0 code review (forge-plan spawns a fresh stateless reviewer subagent against the diff)
10. After round-0 PASS, merge

## Checkpoint

- [x] forge-plan: write this plan file (DONE — 2026-04-13T18:00)
- [x] forge-plan: run `/coherent-plan` against this plan (DONE — 4 findings, 3 MAJOR + 1 MINOR, all 4 fixed in-place)
- [x] forge-plan: mail swift-henry with Option B scope + this plan file path + STOP current C1-only draft (DONE — T1815 mail, pushed git mode)
- [x] forge-plan: stamp master plan (`.ai-workspace/plans/2026-04-12-next-execution-plan.md` lines 234-247 + 168-185) with pointer to this plan (DONE — SUPERSEDED notices added at C1 section + A1c bullet)
- [x] forge-plan: open ai-brain PR for F65/F66/F67 anti-pattern KB entries (DONE — PR #244 https://github.com/ziyilam3999/ai-brain/pull/244, three new entries from this session's planner mistakes)
- [x] swift-henry: read this plan file
- [x] swift-henry: AC-01 — settings.json with two hook configs (branch feat/q05-c1-ac-lint-hooks, uses $CLAUDE_PROJECT_DIR idiom)
- [x] swift-henry: AC-02 — retroactive-critique-hook.sh + tests (suffix-match allowlist, node stdin parser)
- [x] swift-henry: AC-03 — ac-lint-hook.sh + tests (glob `.ai-workspace/plans/*.json`, runs node scripts/run-ac-lint.mjs)
- [x] swift-henry: AC-04 — both test scripts pass (retroactive: 7/7 PASS, ac-lint: 5/5 PASS, fixtures in tests/fixtures/hook-stdin/)
- [x] Q0.5/C1-bis PR #176 merged as v0.26.0 — plan-level `lintExempt` schema + bootstrap absorption (244→0 across 8 committed plan files) unblocks AC-07/AC-08
- [x] swift-henry: restore `.claude/settings.json` (ac-lint hook only — retroactive deferred per Option D)
- [x] swift-henry: AC-05 — retroactive-critique.yml kept in place per Option D (deletion deferred to follow-up; CI stub remains as nominal drift detector)
- [x] swift-henry: AC-06 — ac-lint.yml deleted
- [x] swift-henry: AC-07 — bootstrap rule sweep complete (clean baseline via C1-bis absorption)
- [x] swift-henry: AC-08 — bootstrap lint sweep complete (0 findings)
- [x] swift-henry: AC-09 Part A — same-turn additionalContext injection mechanism documented (verbatim system-reminder transcript in PR body); Part B deferred (BUG-C1-CRITIC-MODE)
- [x] swift-henry: AC-10 — negative-space verified, no scope creep (10 in-scope files, zero divergence/generate/coordinate/mcp leakage)
- [x] swift-henry: MINOR-5a — reverse type-mirror check added in ac-lint.test.ts (+6 lines, structurally correct)
- [x] swift-henry: MINOR-5b — polish folded into C1-bis plan doc (separate PR)
- [x] swift-henry: PR #177 opened via /ship, mailed forge-plan for round-0 code review (T1010)
- [x] forge-plan: round-0 code review via fresh stateless subagent (T1020 — VERDICT PASS, 4 non-blocking MINORs)
- [x] swift-henry: round-0 findings — no blockers; 4 MINORs queued into follow-up PR
- [x] PR #177 merged as v0.27.0 — master @ `5e9bcf6c2940986528d18ab4481f37df7aadb369` (T1035 swift-henry mail)
- [x] /ship Stage 5 self-review surfaced 5 enhancements (#178-#182) — overlap with forge-plan's 4 MINORs; all 9 polish items consolidated into Option B follow-up PR
- [x] forge-plan: re-stamp this plan checkpoint to DONE for C1-original scope (this edit)
- [ ] forge-plan: draft `.ai-workspace/plans/2026-04-14-q05-c1-followup-retroactive-critique-hook.md` for Option B + 9 polish items
- [ ] forge-plan: run /coherent-plan on the follow-up plan
- [ ] forge-plan: hand follow-up plan to swift-henry
- [ ] Q0.5 closure tally updated (after follow-up merges)
- [ ] user: review/merge ai-brain PR #244 (F65/F66/F67 KB entries — independent track)

Last updated: 2026-04-14T10:40:00+08:00 — PR #177 merged as v0.27.0 (commit 5e9bcf6). C1-original scope DONE: ac-lint hook live, two CI workflows status (ac-lint deleted, retroactive-critique kept per Option D until replacement ships). C1-deferred scope (retroactive-critique hook + BUG-C1-CRITIC-MODE) now tracked in the follow-up plan being drafted next.

## Q0.5/C1 closure

Q0.5/C1 ships across **two PRs**, closing as of the follow-up merge:

- **PR #177** (C1-original, v0.27.0, merged `5e9bcf6`) — ac-lint hook live; CI workflow parked.
- **PR #183** (C1 follow-up, feat branch `feat/q05-c1-followup-retroactive-critique`, base `ffabe65`) — critic eval mode, 8/9 ac-lint-hook polish items, retroactive-critique hook unparked & wired, CI stub deleted.

**Resolved by the follow-up PR:**
- BUG-C1-CRITIC-MODE — `evaluationMode: "critic"` now exists on `forge_evaluate`; AC-01 through AC-05 satisfied by `server/tools/evaluate.ts` `handleCriticEval` + `evaluate-critic.test.ts` (5/5 green).
- C1-original AC-09 Part B — retroactive-critique hook's same-turn PostToolUse timing validated via AC-13 manual integration test on `server/lib/prompts/critic.ts` (transcript in PR #183 body).
- C1-original Part B deferral — retroactive-critique.yml CI stub deleted (AC-09), parked hook + tests + 4 rule fixtures unparked from `.deferred-c1-retroactive/`, `.claude/settings.json` PostToolUse chain has 2 commands (AC-08).

**Deferrals rolled forward to a future micro-PR:**
- **AC-12 E3 (single-file lint passthrough)** — `scripts/run-ac-lint.mjs` has no CLI arg handling; adding `process.argv[2]` support is a ~15 LOC scope expansion that would push PR #183 past review ceiling and freeze a hook↔CLI contract before the shape is earned. Perf is not load-bearing at the current 9-plan corpus (sub-second full-sweep). Inline deferral marker at `scripts/ac-lint-hook.sh` above the `node scripts/run-ac-lint.mjs` invocation. Revisit when the corpus grows past ~50 plans OR when ac-lint gets expensive per-file.

**Q0.5/C1 status:** DONE pending PR #183 merge. No loose ends beyond the one named deferral above.
