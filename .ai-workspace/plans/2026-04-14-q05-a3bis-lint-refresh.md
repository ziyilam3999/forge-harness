# Q0.5/A3-bis — Dual-trigger lintExempt refresh

**Task #14 (follow-up to #13).** Owner: swift-henry. Unblocked on v0.29.0 per forge-plan round-0 verdict.

## Context

Q0.5/A3 (v0.29.0) tagged per-AC `lintExempt: true` overrides as `reliability: "unverified"` whenever the exemption actually fired. That closed the *labelling* gap. It did **not** close the *staleness* gap: an override granted in week 1 may no longer be warranted in week 12, either because the ac-lint rules were tightened (so the override is now redundant or wrong) or because enough time has elapsed that the original rationale should be re-examined.

A3-bis adds the audit loop: every `lintExempt` (per-AC AND plan-level) is periodically re-validated against the *current* ac-lint rules, with two triggers:

1. **C1c — rules change.** When `AC_LINT_RULES` or `AC_SUBPROCESS_RULES_PROMPT` changes hash, every existing exemption is flagged for re-review on next plan touch.
2. **14-day calendar.** Even if rules are unchanged, any exemption older than 14 days is flagged.

A3-bis also closes the **plan-level scope hole** A3 deferred: plan-level `lintExempt[]` (`server/types/execution-plan.ts:12-17`) is currently pre-filtered at lint time (`server/validation/ac-lint.ts:256-257`) and never reaches the evaluator, so A3's `unverified` tag never applies. A3-bis surfaces it via the audit path instead.

## ELI5

We let people stick "skip this rule" notes on their plans. A3 made sure those notes get a yellow "unchecked" sticker so nobody forgets. A3-bis adds a calendar reminder: every two weeks, or whenever the rules change, we go back through all the yellow stickers and ask "do we still need this?" If a sticker is stale, we put it on a list for the human to look at.

## Files and code anchors

| File | Anchor | Action |
|---|---|---|
| `server/lib/prompts/shared/ac-subprocess-rules.ts` | end of file | ADD — export `getAcLintRulesHash()` returning `sha256(AC_SUBPROCESS_RULES_PROMPT + JSON.stringify(AC_LINT_RULES))`. Pure, cached. |
| `server/types/lint-audit.ts` | NEW | CREATE — `LintAuditEntry { planId, planPath, lastAuditedAt, ruleHash, perAcExemptCount, planLevelExemptCount }` and `LintRefreshReport { triggered, triggerReason: "rule-change" \| "14d-elapsed" \| "none", staleEntries[] }`. |
| `server/lib/lint-audit.ts` | NEW | CREATE — read/write `.ai-workspace/lint-audit/{planSlug}.audit.json` (**committed to git**, NOT gitignored — matches `.ai-workspace/dogfood/` precedent so dogfood loop and downstream `forge_reconcile` consumers can see audit history). Helpers: `loadAudit(planPath)`, `writeAudit(entry)`, `isStale(entry, currentHash, now)` returns trigger reason or null. Phase 2 step 5 must verify `.gitignore` does not list `lint-audit/` and add a sentinel `.gitkeep` so the directory commits cleanly. |
| `server/tools/lint-refresh.ts` | NEW | CREATE — handler for new MCP tool `forge_lint_refresh`. Input: `{ planPath, force? }`. Steps: load plan → load existing audit → compute current hash → check trigger → if triggered, re-lint each exempt AC *without* its exemption and collect findings → write fresh audit → return `LintRefreshReport`. |
| `server/tools/plan.ts` | `documentTier: "update"` branch | MODIFY — at the end of the update path, invoke `runLintRefresh(planPath)` and surface the `LintRefreshReport` on the plan-update response under a new `lintRefresh` field. Non-fatal: refresh failure logs a warning, never blocks the update. |
| `server/index.ts` | tool registration | MODIFY — register `forge_lint_refresh` (also exposed standalone for manual `force: true` invocations). |
| `server/tools/lint-refresh.test.ts` | NEW | CREATE — unit tests for AC-bis-01..09. |
| `server/tools/plan.test.ts` | update-mode test | MODIFY — add AC-bis-12 + AC-bis-13 hook assertions. |

### Why a new tool, not a `forge_reconcile` sub-mode

Explore confirmed `forge_reconcile` dispatches per-story notes (`affectedStories[]`, `affectedPhases[]`). Lint-refresh is plan-wide. Forcing it through reconcile would either synthesise fake `affectedStories` arrays or fork reconcile internally on a new category. Both bend reconcile out of shape. A separate tool keeps reconcile single-purpose. (Matches the standing "avoid hybrids" feedback in MEMORY.md.)

### Trigger mechanism: hooked into `forge_plan(documentTier: "update")`

User decision: A3-bis fires automatically as a side effect of every `forge_plan` update call, in addition to being callable standalone. Rationale: plan updates are the natural moment to re-validate exemptions, the user already touches `forge_plan(update)` whenever the plan or rules change, and a passive-only tool would in practice never be called.

Wiring: at the end of the `documentTier: "update"` branch in `server/tools/plan.ts`, call `runLintRefresh(planPath)` and attach the `LintRefreshReport` to the response under a new `lintRefresh` field. The hook is **non-fatal**: any error from refresh is logged and the update still succeeds. The standalone `forge_lint_refresh` tool remains available for manual invocation with `force: true` (skips the staleness check, always re-lints).

This is a controlled hybrid (two tools, one auto-call site), not the kind of hybrid the MEMORY.md feedback warns against — the failure modes are bounded because the hook is non-fatal and `runLintRefresh` is a pure function over `(planPath, fs, now)`.

### Refresh action: report, do not auto-rewrite

The tool does **not** mutate the plan. It returns a `LintRefreshReport` listing stale entries with their original rationale and the *current* lint findings against each. The human (or a follow-up `forge_reconcile` call) decides whether to drop the exemption, rewrite the rationale, or accept it for another 14 days. Auto-rewriting would silently override author intent — explicit non-goal.

## Test cases & acceptance criteria

All ACs binary.

| AC | Verify |
|---|---|
| **AC-bis-01** | `getAcLintRulesHash()` returns a stable 64-char hex string; calling twice in same process returns identical value. |
| **AC-bis-02** | `isStale(entry, hash, now)` returns `"rule-change"` when stored hash ≠ current hash. |
| **AC-bis-03** | `isStale` returns `"14d-elapsed"` when `now - lastAuditedAt > 14*86400_000ms` AND hash matches. |
| **AC-bis-04** | `isStale` returns `null` when hash matches AND age < 14 days. |
| **AC-bis-05** | `forge_lint_refresh` on a plan with no exemptions returns `triggered: false` and writes a fresh baseline audit. |
| **AC-bis-06** | First-run `forge_lint_refresh` on a plan with 1 per-AC + 1 plan-level exempt returns `triggered: true, reason: "rule-change"` (absent baseline = drift) and writes audit with both counts. |
| **AC-bis-07** | Re-running immediately returns `triggered: false`. |
| **AC-bis-08** | After mutating `lastAuditedAt` to 15 days ago, next call returns `triggered: true, reason: "14d-elapsed"`. |
| **AC-bis-09** | Re-lint of an exempt AC actually re-runs `lintAcCommand` *without* the exemption (mocked, asserts findings reach the report). |
| **AC-bis-10** | `npx vitest run` exit 0, zero regressions. |
| **AC-bis-11** | `git diff --stat master` touches ONLY the files listed above. No drift into reconcile.ts, evaluate.ts, evaluator.ts, coordinate.ts, generator.ts, MEMORY.md. (`plan.ts` IS allowed for the hook.) |
| **AC-bis-12** | A `forge_plan({documentTier: "update"})` call against a plan with ≥1 exemption invokes `runLintRefresh` exactly once and returns a response with a populated `lintRefresh` field. |
| **AC-bis-13** | A `runLintRefresh` thrown error inside the hook is caught: the `forge_plan` update response is unchanged from a no-hook baseline (same success-shape it returns today — exact field name TBD at implementation time, see note below), and the `lintRefresh` field is `{ error: "<message>" }`. |

**Note on AC-bis-13:** Phase 3 step 9 must first read the current `forge_plan(documentTier: "update")` response shape (likely `server/tools/plan.ts`) and pin AC-bis-13's "unchanged baseline" assertion to whatever field/structure is actually returned today (e.g., `status`, `phasePlan`, etc.). Do not invent a new top-level field; only add `lintRefresh` alongside the existing fields.

## Implementation order (binary)

### Phase 1 — Scope confirmation (GATE)

1. Mail forge-plan, thread `q05-a3bis`: this plan link, the open scope question (per-AC + plan-level vs per-AC only), confirm new-tool vs reconcile-sub-mode preference, and confirm the active-hook trigger choice. `reply_expected: true`, `auto_schedule_wakeup: true`, SLA 1500s. **STOP and wait.**

### Phase 2 — Hash + audit primitives

2. Branch: `git checkout master && git pull && git checkout -b feat/q05-a3bis-lint-refresh`
3. Add `getAcLintRulesHash()` to `ac-subprocess-rules.ts`. `tsc --noEmit` clean.
4. Create `server/types/lint-audit.ts` with the two interfaces.
5. Create `server/lib/lint-audit.ts` with `loadAudit`, `writeAudit`, `isStale`.
6. Vitest unit tests for AC-bis-01..04. Green.

### Phase 3 — Tool handler + plan.ts hook

7. Create `server/tools/lint-refresh.ts` with `runLintRefresh(planPath, opts)` core function and MCP handler wrapper, input zod schema, dispatcher.
8. Wire into `server/index.ts` tool registration.
9. Edit `server/tools/plan.ts` `documentTier: "update"` branch: wrap `runLintRefresh(planPath)` in try/catch, attach result (or `{ error }`) to response under `lintRefresh` field.
10. Vitest tests for AC-bis-05..09 (lint-refresh.test.ts) + AC-bis-12..13 (plan.test.ts). Green.

### Phase 4 — Ship

11. `npx vitest run` full suite green.
12. `npm run build` clean.
13. `git diff --stat master` matches AC-bis-11 allowlist.
14. `/ship` (plan-refresh: `no-op`).
15. Mail forge-plan with merge SHA for round-0 review.

## Verification (post-merge)

1. `git checkout master && git pull && npm run build`
2. **Live MCP smoke test** (requires session restart per F54): author a plan with 1 per-AC `lintExempt: true` AC and 1 plan-level `lintExempt[]` entry. Call `forge_plan({documentTier: "update"})` — confirm: (a) response carries `lintRefresh.triggered: true, reason: "rule-change"` (first run), (b) audit JSON written under `.ai-workspace/lint-audit/`, (c) immediately calling `forge_plan(update)` again returns `lintRefresh.triggered: false`.
3. Hand-edit `lastAuditedAt` to 15 days ago, re-call — confirm `lintRefresh.triggered: true, reason: "14d-elapsed"`.
4. **Standalone path:** call `forge_lint_refresh({planPath, force: true})` — confirm refresh always fires regardless of staleness state.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Re-linting per-AC exemptions requires reconstructing the original `lintAcCommand` call shape | MED | Phase 3 step 7 reads how `lintAcCommand` is invoked from `evaluator.ts` (read-only) and reuses the exact call shape inside `runLintRefresh` |
| Hash captures only rules+prompt strings — misses semantic changes in lint pipeline itself | LOW | Documented limitation; refresh is a *prompt* for human review, not an automated gate |
| Plan-slug collision between distinct files sharing a basename | LOW | Slug = `<parentDirName>__<basename(planPath,".md")>` so `phases/phase-01.md` and `archive/phase-01.md` resolve to distinct audit files |
| Hook into `forge_plan(update)` couples two tools | LOW-MED | Hook is non-fatal (try/catch wraps `runLintRefresh`); standalone tool remains the primary interface; plan.ts edit is single-call-site only |
| Hook fires on every `update` even when nothing changed | LOW | `isStale` returns `null` fast when hash matches and age < 14d, so no-op cost is one fs.read + one sha256 |

## Files NOT to touch

- `server/tools/reconcile.ts`, `server/tools/evaluate.ts`, `server/tools/coordinate.ts`, `server/tools/generate.ts`
- (`server/tools/plan.ts` IS in scope — hook insertion only, no other edits)
- `server/lib/evaluator.ts`, `server/lib/generator.ts`
- `server/validation/ac-lint.ts` (refresh *uses* it, does not modify it)
- `MEMORY.md`, `scripts/*`, `.github/workflows/*`

## Checkpoint

- [x] Phase 1 — mail forge-plan scope question, wait (PASS verdict received 2026-04-14T16:25, all 3 decisions approved)
- [x] Phase 2.2 — branch cut (`feat/q05-a3bis-lint-refresh`)
- [x] Phase 2.3 — hash function + tsc clean (`getAcLintRulesHash()` cached, 64-char hex)
- [x] Phase 2.4 — lint-audit types (`LintAuditEntry`, `LintRefreshReport`, `LintRefreshStaleEntry`, `LintRefreshTriggerReason`)
- [x] Phase 2.5 — lint-audit lib (`loadAudit` / `writeAudit` / `isStale` / `computePlanSlug`)
- [x] Phase 2.6 — AC-bis-01..04 tests green (9/9 in `server/lib/lint-audit.test.ts`)
- [x] Phase 3.7 — lint-refresh tool handler + `runLintRefresh` core (accepts in-memory plan override for hook path)
- [x] Phase 3.8 — registration in index.ts (`forge_lint_refresh` as 6th MCP tool)
- [x] Phase 3.9 — plan.ts update-branch hook (non-fatal try/catch, `lintRefresh` field on response, opt-in via `planPath`)
- [x] Phase 3.10 — AC-bis-05..09 + AC-bis-12..13 tests green (5/5 in `lint-refresh.test.ts` + 2/2 in `plan.test.ts`)
- [x] Phase 4.11 — full vitest green (715 local → 720 CI, 0 regressions)
- [x] Phase 4.12 — npm run build clean
- [x] Phase 4.13 — negative-space audit (9 A3-bis files + 1 smoke-test bump, AC-bis-11 allowlist satisfied)
- [x] Phase 4.14 — /ship (PR #197, merge SHA `0f9cf91`, released as v0.30.0, plan-refresh: `no-op`)
  - Ship-review: PASS, 0 bugs, 6 enhancements filed as issues #198–203
  - CI surprise: `server/smoke/mcp-surface.test.ts` hard-coded 5-tool allowlist, bumped to 6 in fix commit `e17e72f` (local vitest excludes `server/smoke/*`, CI includes it)
- [x] Phase 4.15 — round-0 mail to forge-plan (thread `q05-a3bis`, mailbox commit `8484018`, read+archived by her, reply pending)

### Open follow-ups (not part of A3-bis scope — tracked as GH issues)
- [x] #198 E1: force-branch `triggerReason` labelling — closed in polish PR #204
- [x] #199 E2: obsolete-exemption bucket separation — closed in polish PR #204 (`isObsolete` flag)
- [x] #200 E3: cache `lintAcCommand` across overlapping plan-level exempts — closed in polish PR #204
- [x] #201 E4: `path.parse().name` in `computePlanSlug` — closed in polish PR #204
- [x] #202 E5: ESM imports in plan.test.ts lintRefresh block — closed in polish PR #204
- [x] #203 E6: `__resetAcLintRulesHashCache()` helper — closed in polish PR #204
- [x] Round-0 verdict from forge-plan — PASS received 2026-04-14T2025, thread `q05-a3bis` archived
- [x] Retroactive-critique hook follow-up (de-dup + in-session fallback) — filed as #205 (sibling of #192/#193/#194)

Last updated: 2026-04-14T21:15 — A3-bis track CLOSED. v0.30.0 shipped, round-0 PASS, all 6 ship-review enhancements landed in polish PR #204, retroactive-critique follow-up filed as #205. Nothing pending.
