---
plan: AI-model un-hardcoding — DECISION plan (pick the shape, then implement)
status: DRAFT (pre-reviewer-chain)
authors: forge-plan
date: 2026-05-08
asked_by: operator (2026-05-08T13:30Z, after F6/v0.40.5 merge; expanded 13:50Z with obsolescence + dual-model questions; expanded again 14:00Z with config-file ask)
supersedes: .ai-workspace/_quarantine-superseded-plans-20260508/2026-05-08-forge-model-env-override.md (v1 single-option plan; locked at 4-0 ship-it but operator added obsolescence + dual-model + config-file scope before /delegate)
---

## ELI5

We need to un-hardcode the Claude model name in forge-harness. The operator raised three follow-up concerns that reshape the design:

1. **Obsolescence** — what if `claude-sonnet-4-6` (today's hardcoded default) gets deprecated? Today: every forge call would 404-crash until someone restarts the MCP after editing source code. Bad UX.
2. **Dual-model routing** — what if some stages should use sonnet/opus (hard reasoning) and others should use haiku (cheap classifier work)?
3. **Config file** — should config live in environment variables, in a `forge.config.json` file, or both?

This plan does NOT pick a single implementation. It lays out **five candidate option-bundles**, asks the four-reviewer chain to vote on which one wins, and surfaces the verdict to the operator for ratification. After ratification, a separate implementation plan ships in v0.40.6.

Think of this as a "tournament bracket" round before the implementation round.

## Execution model

**Two-phase plan.**

- **Phase 1 — DECISION (this plan).** File the option-bundle comparison; run /auto-flow Stage 1 four-reviewer chain (P1 stateless / P2 comparative / P3 cairn-grounded / P4 mechanical-sweep); each reviewer picks a winner with concrete rationale. Tally verdicts. Show-and-wait for operator ratification.
- **Phase 2 — IMPLEMENTATION (separate plan, written after operator ratifies).** File a new Plan-First plan tightly scoped to the chosen winner; re-run the four-reviewer chain on the implementation specifics (the option-comparison work above is reviewer-validated, so Phase 2's chain only audits implementation correctness, not architectural choice); show-and-wait; dispatch implementer; ship in v0.40.6; mail macbook-monday for smoke test.

**Why two phases.** The original v1 plan (single-option `FORGE_MODEL` env var) reached 4-0 ship-it before the operator raised obsolescence + dual-model + config-file. Re-doing v1 with three new dimensions of scope folded in would produce a plan with 5 nested architectural choices that the reviewer chain can't cleanly vote on (the chain reviews coherence, not multi-axis choice). Splitting decision-from-implementation gives reviewers a focused vote, then a focused implementation review.

## Why we're picking, not just shipping v1

The operator's three follow-up questions each invalidate a v1 assumption:

1. **v1 assumed in-code default ("claude-sonnet-4-6") is durable.** Operator: "any AI model will be obsolete one day." → v1 plan's reliance on a hardcoded fallback breaks the day Anthropic deprecates that name.
2. **v1 assumed one model fits all stages.** Operator: "what if dual models — sonnet/opus for hard, haiku for easy?" → v1 has no path to per-stage routing without a v2 redesign.
3. **v1 chose env vars without considering config files.** Operator: "suggest AI model in config file too." → config-file shape was rejected in v1 as overkill for one knob; operator wants it on the table.

All three questions are forward-looking design concerns, not regressions. The right move is a fresh decision pass that weighs them up-front rather than shipping v1 and then reshaping in v0.40.7 / v0.40.8.

## The five candidate options

Each option includes **A1 (obsolescence-aware loud failure)** because all five reviewers and the operator implicitly agreed on that — operator confirmed in chat. So A1 is non-optional and identical across all five. The variance is in how the model is *configured* (B0 / B1 / B2 / C / B1+C).

### Common to all options: A1 — obsolescence-aware loud failure

When the Anthropic API returns `404 model_not_found`, `callClaude` catches it and re-throws with operator-actionable guidance:

> Anthropic API rejected model "<modelId>" — likely deprecated. Set `FORGE_MODEL` (or update `forge.config.json` if Option C/ε) to a current model. Forge-harness ships an in-code default that is bumped each release; current available Claude models: https://docs.anthropic.com/en/docs/about-claude/models

No retry. Single typed warning emit. ~10 LOC change. Same loud-failure pattern (P44 + P45) F6 used.

### Option α — A1 + B0 (defer dual-model)

**Shape:** v1 plan + A1. Single `FORGE_MODEL` env var. No per-stage routing. File issue #547 to add per-stage routing as a v0.40.7 follow-up.

- **PR size:** ~2 files (anthropic.ts + cost.ts) + ~10 LOC for A1. Smallest blast radius.
- **Operator UX:** `FORGE_MODEL=claude-opus-4-6` → opus for everything. Restart MCP to apply.
- **Pro:** Ships fastest; v1 was already 4-0 ship-it; A1 is additive.
- **Con:** No path for dual-model today; per-stage routing waits for v0.40.7.
- **When right:** operator's per-stage need is "nice to have" not "must have"; ship cheap, iterate.

### Option β — A1 + B1 (per-stage env vars)

**Shape:** Single `FORGE_MODEL` env var as global default + per-stage overrides: `FORGE_MODEL_PLANNER`, `FORGE_MODEL_CRITIC`, `FORGE_MODEL_CORRECTOR`, `FORGE_MODEL_COHERENCE_EVALUATOR`, `FORGE_MODEL_SPEC_GENERATOR` (5 stages already tagged via `trackedCallClaude(ctx, _, stageName, _)`).

- **PR size:** ~3 files (anthropic.ts + cost.ts + run-context.ts to thread the stage name into model resolution). Plus ~6 env vars.
- **Resolution order:** per-call `model:` > `FORGE_MODEL_<STAGE>` > `FORGE_MODEL` > in-code default.
- **Operator UX:** `FORGE_MODEL=claude-sonnet-4-6 FORGE_MODEL_SPEC_GENERATOR=claude-haiku-4-5` → sonnet everywhere except spec-gen runs on haiku. Restart MCP to apply.
- **Pro:** Dual-model works on day one; infrastructure exists (`stageName` already plumbed); cleanest backward-compat (operators using only `FORGE_MODEL` see no change).
- **Con:** FORGE_* family grows from 5 → 11 env vars. Operator must remember stage names. No good shape for "stage X uses Y" without setting an env var.
- **When right:** operator wants granular routing today AND prefers env-var idiom (12-factor-ish).

### Option γ — A1 + B2 (tier env vars)

**Shape:** Single `FORGE_MODEL` global + two tier overrides: `FORGE_MODEL_HARD` and `FORGE_MODEL_EASY`. Plan declares which stage is which tier (e.g. all 5 current stages = HARD; future lint/classifier stages = EASY).

- **PR size:** ~3 files. 3 env vars total (`FORGE_MODEL` + 2 tiers).
- **Operator UX:** `FORGE_MODEL_EASY=claude-haiku-4-5 FORGE_MODEL_HARD=claude-opus-4-6` → tier-routed.
- **Pro:** Fewer env vars than β. Conceptually simple ("hard or easy").
- **Con:** **Forge today has zero EASY stages.** All 5 current `trackedCallClaude` sites are reasoning-heavy. The HARD/EASY split has no current customer; introducing it pre-emptively risks (a) miscategorization (someone marks spec-gen "easy" later because it feels lighter, then quality drops), (b) future surprise when a new stage doesn't fit cleanly into one of two buckets.
- **When right:** operator believes EASY stages will exist soon AND is OK with binary categorization.

### Option δ — A1 + C (config file only, no env var)

**Shape:** New `forge.config.json` (or `.forge.config.json`) at project root. Schema:

```json
{
  "model": "claude-sonnet-4-6",
  "perStage": {
    "planner": "claude-opus-4-6",
    "spec-generator": "claude-haiku-4-5"
  }
}
```

- **PR size:** ~5 files (anthropic.ts + cost.ts + new `forge-config.ts` parser + Zod schema in run-record.ts + 1 test file). New file format.
- **Resolution order:** per-call `model:` > config-file `perStage[stageName]` > config-file `model` > in-code default. **No env-var path.**
- **Operator UX:** edit `forge.config.json` in the repo root, restart MCP. No environment-variable management.
- **Pro:** Composes cleanly with future config knobs (per-stage maxTokens, per-stage temperature, retry policy, etc.). Versioned-with-the-repo (committable). Discoverable (single file vs scattered env vars).
- **Con:** New file format means schema migration burden when forge accumulates more options. Operator can't override per-shell-session (needs file edit + commit/uncommit dance). Doesn't respect the FORGE_* convention that 5 sibling vars already follow.
- **When right:** forge will accumulate 5+ config knobs (we're at 5 today + 1 if we add MODEL = 6, near the threshold) AND repo-versioned config is desired (CI runners pick it up automatically).

### Option ε — A1 + B1 + C (hybrid: env vars layered over config file)

**Shape:** Optional `forge.config.json` (Option C) + env-var overrides (Option B1). Either works alone; both together give precedence to env vars (operator-shell wins over committed config).

- **PR size:** ~6 files (everything from δ + env-var resolution layer from β). Largest blast radius of all five options.
- **Resolution order:** per-call `model:` > `FORGE_MODEL_<STAGE>` > `FORGE_MODEL` > config-file `perStage[stageName]` > config-file `model` > in-code default. Six layers.
- **Operator UX:** committable team-default in `forge.config.json`; per-developer override via `FORGE_MODEL_<STAGE>` env vars in shell.
- **Pro:** Most flexible. Industry-standard pattern (Vite, Vitest, ESLint, Prettier all do env-vars-on-top-of-config-file).
- **Con:** Six-level resolution is a UX cliff. Operators must understand precedence. Debug surface is large ("why is forge using haiku here? ... because FORGE_MODEL_SPEC_GENERATOR is set in your shell from 3 days ago"). Schema + env-var validation has to stay coherent across two surfaces.
- **When right:** team uses CI + per-developer overrides simultaneously AND has the discipline for multi-layer config debugging.

## Comparison matrix

| Axis | α (B0) | β (B1) | γ (B2) | δ (C) | ε (B1+C) |
|---|---|---|---|---|---|
| Files touched | 2 | 3 | 3 | 5 | 6 |
| New env vars | 1 | 6 | 3 | 0 | 6 |
| New file formats | 0 | 0 | 0 | 1 | 1 |
| Resolution layers | 3 | 4 | 4 | 4 | 6 |
| Dual-model day-1? | No | Yes | Yes | Yes | Yes |
| EASY stage exists? | n/a | n/a | **No** | n/a | n/a |
| FORGE_* family count after | 5 | 10 | 7 | 4 | 10 |
| Backward-compat (no-op when unset) | Yes | Yes | Yes | Yes | Yes |
| Industry-pattern fit | high | high | medium | medium | very high |
| Team-default committable? | No | No | No | **Yes** | **Yes** |
| Operator debug complexity | low | medium | low | low | high |

## Cairn references (decision-relevant)

- **F49 (Dual-Level Enforcement of Same Rule) — ANTI-pattern (refusal-class).** Verified at `02-anti-patterns.md:343`. ε's 6-layer resolution structurally invites F49 (config-file says X, env var says Y, in-code default says Z). Mitigation in α/β: single resolution function in `anthropic.ts` walks layers; one constant exported as the producer-side source-of-truth.
- **P43 (Single Source of Truth)** — applies in all options: one `DEFAULT_MODEL` constant exported from `anthropic.ts`, imported wherever needed.
- **P32 (Config-as-Parameter Threading)** — canonical text: "Load config once at startup, pass as parameter ... no global singleton." (NOT a "5-7 knob threshold" — that wording was plan-author extrapolation; corrected per P4 mechanical-sweep.) We're at 4 FORGE_* vars today (`FORGE_BASH_PATH`, `FORGE_CORRECTOR_MAX_TOKENS`, `FORGE_DASHBOARD_AUTO_OPEN`, `FORGE_SPEC_VALIDATOR_MODE`); α brings it to 5; β to 10; γ to 7.
- **F54 (Stale MCP Server After dist/ Rebuild)** — module-load IIFE applies to env-vars; config-file read could be either at-startup OR per-call (designer's choice). All options need a "restart MCP" reminder in operator docs.
- **P44 + P45** — A1's loud-failure on obsolete model is canonical P44+P45.
- **F46 (Silent Numeric Default When Data Missing)** — anti-pattern correctly avoided in all options (cost-tracker null-sentinel preserved).

## Reviewer chain — what we're asking

Each reviewer (P1 stateless, P2 comparative, P3 cairn-grounded, P4 mechanical-sweep) must produce **a single-letter verdict** picking one of α / β / γ / δ / ε, with three sentences of justification. The reviewers are NOT asked to ship-it/iterate/drop in this plan — they're asked to **vote**.

Tally rule:
- 4-0 unanimous → present winner to operator with high confidence.
- 3-1 majority → present winner with the dissent's reasoning preserved.
- 2-2 split → escalate to operator with both top choices and the trade.
- 4 different votes → escalate, but flag the design as not-yet-clear.

## Binary AC (for THIS plan, not the implementation)

- **AC-1.** Each of P1-P4 produces a vote in {α, β, γ, δ, ε} with ≥ 3-sentence rationale tying their pick to a concrete project constraint (FORGE_* convention / cairn pattern / blast radius / operator UX).
- **AC-2.** The winning option is recorded in this plan's revision log + presented to the operator.
- **AC-3.** Operator ratifies (or course-corrects) the winner.
- **AC-4.** A separate Phase-2 implementation plan is filed at `.ai-workspace/plans/2026-05-08-forge-model-<winner-shape>.md` capturing the chosen winner with normal Plan-First sections (ELI5, Why, What, Critical files, Considered alternatives — already covered here, Binary AC for code, etc.). **Phase-2 AC must include**: (i) the live `cost.ts:90` P43 violation fix — replace `model ?? "claude-sonnet-4-6"` literal with `model ?? DEFAULT_MODEL` import (P3 + P4 catch); (ii) the A1 error message must NOT reference `forge.config.json` under α/β (P1 + P3 catch); (iii) the F54 IIFE-at-module-load restart caveat must be documented (P1 catch); (iv) operator's answer to the (a)/(b)/(other) clarifying question above determines whether ζ (`.envrc` + README) is folded into Phase-2 or deferred.
- **AC-5.** Phase-2 plan goes through its own /auto-flow Stage 1 four-reviewer chain (lighter pass — architectural choice already validated here, so reviewers focus on implementation correctness, not option re-litigation).

## Out of scope for this DECISION plan

- Actual code changes (Phase 2's job).
- Test plumbing (Phase 2's job).
- CHANGELOG entry text (Phase 2's job).
- macbook-monday smoke-test mail (Phase 2's job).

## Operator-intent clarifying question (must resolve BEFORE Phase 2)

P2 + P3 + P4 all independently flagged this as an unresolved ambiguity. The operator's "suggest AI model in config file too" ask has two distinct interpretations and the plan does not adequately tease them apart:

- **(a) Team-default committed for CI pickup.** Operator wants model choice to live in the repo so CI runners (and new dev clones) automatically pick up the team's default without per-machine env-var setup. **This is solvable WITHOUT δ/ε** — committed `.envrc` (direnv) or `.env.example` would do it. P4 verified neither file exists in the repo today, so operator would need to add direnv or similar tooling. Phase-2 would add a `.envrc` template + README pointer instead of a JSON/Zod-schema config file.
- **(b) Discoverability — "where do I configure forge-harness?"** Operator wants a single visible-to-humans place that lists all available knobs. **This is solvable WITHOUT δ/ε too** — README section + `forge_status` dashboard widget enumerating FORGE_* env vars would do it.

If (a) or (b) is the actual ask, **a sixth option ζ (env-var family + committed `.envrc` + README enumerator)** dominates δ/ε on every axis and lands in v0.40.6 as cleanly as α does.

**This question goes to the operator at ratification time.** All four reviewers voted α regardless of which interpretation wins because α is the cheapest both-direction option (P2's "cheapest mobility" property), so the vote is robust to the unresolved ask. But if operator's answer is (a) or (b), Phase-2's plan should fold ζ into α (one-line `.envrc.example` add + README section), not pursue δ/ε.

## Notes for reviewer chain

1. **You are voting, not iterating.** Do NOT ask for the plan to be iterated to add details about the implementation of the option you favor — that's Phase 2's job. Your vote is a single-letter pick + rationale.
2. **F6 just shipped (v0.40.5, 30 min ago).** The `KEYCHAIN_SERVICE_NAME` export pattern is fresh precedent for single-source-of-truth between `anthropic.ts` and consumer files. P3 should weigh whether each option upholds or breaks that pattern.
3. **The original v1 plan reached 4-0 ship-it.** It's the single-option ancestor of α (without A1). If your reasoning matches v1's, vote α + A1.
4. **Consider operator's likely follow-ups.** If today's operator-UX preference might shift in 6 months (e.g., they start running CI that needs different models per environment), an option that's "just right today" may be "wrong soon." Score multi-step robustness, not just current fit.
5. **B2's "no current EASY stage" is a real cost.** Don't vote γ if you can't name an EASY stage that will exist within 3 months.
6. **ε's six-layer resolution is a real cost.** Don't vote ε if you can't justify why a team needs that many surfaces over a one-off two-surface compromise.
7. **Config-file (δ, ε) means a new schema** — Zod parser, error messages on malformed files, version field for forward-compat. Score that effort honestly.
8. **The operator implicitly committed to A1** — your vote is over the B/C variants only.

## Revision log

- **2026-05-08T1450Z** — initial draft. Pre-reviewer-chain. 5 option-bundles framed (α/β/γ/δ/ε), all with A1 (obsolescence-aware loud failure) baked in. v1 plan archived to `_quarantine-superseded-plans-20260508/`. Reviewer chain to vote on winner; operator ratifies; Phase-2 implementation plan filed separately. Author: forge-plan.

### Reviewer-chain votes

- **P1 (stateless, 2026-05-08T1505Z): VOTE α — RUNNER-UP β.** Rationale: (1) blast-radius alignment with just-shipped F6 precedent (`anthropic.ts:26` `KEYCHAIN_SERVICE_NAME` export pattern; α extends it verbatim). (2) γ's "EASY stage" cost is real — all 5 current `trackedCallClaude` callsites route reasoning-heavy work; β/γ/δ/ε build dual-model machinery for a customer that doesn't exist; YAGNI applies, file #547 when a real haiku candidate appears. (3) Obsolescence-recovery UX is strongest with α — operator types one `export FORGE_MODEL=` and restarts; δ/ε add Zod schema + migration burden at the moment of breakage. (4) v1 was α-without-A1 at 4-0 ship-it; operator's three questions add A1 (unanimous) but don't invalidate v1's core. β fallback is clean because `stageName` already plumbed. Concerns flagged: (a) if operator has near-term per-stage need, β is materially better at 3-file vs 2-file cost; (b) Phase-2 implementation plan MUST scrub the A1 error message's `forge.config.json` reference (won't exist under α); (c) Phase-2 MUST document F54 IIFE-at-module-load restart caveat.
- **P2 (comparative, 2026-05-08T1515Z): VOTE α — RUNNER-UP β. AGREES WITH P1.** Rationale: (1) industry-pattern fit on ε cuts AGAINST ε, not for it — forge is an MCP server consumed by an agent (12-factor backend neighborhood: `PG_*`, `REDIS_*`, `AWS_*`), not a human-editable dev tool (Vite/ESLint/Prettier neighborhood). The plan's matrix overrated ε's fit by importing UX expectations from the wrong peer family. (2) Forge's 5-strong FORGE_* family + v0.40.4 I8 + v0.40.5 F6 are a deliberate cultural choice (env-var-all-the-way), not coincidence; δ/ε break the pattern at knob #6 without an inflection-point trigger. (3) The next 3 likely config knobs (per-stage maxTokens, retry policy, log-level) are all per-environment knobs (CI vs local) — exactly the env-var sweet spot. δ's "committable team default" pro is double-edged: a CI runner committing `forge.config.json` with `model: opus-4` then forgetting to bump it on opus deprecation reproduces the obsolescence problem at a different layer. (4) α→β upgrade is 3 LOC + 5 env-vars; δ→α retreat is deprecating a parser without breaking CI consumers. **α has the cheapest both-direction mobility** of all five options — that's the real architectural property worth optimizing for. Push-back on P1: P1's "obsolescence-recovery UX strongest with α" understates β's parity (β has the same one-line export shape; the α-vs-β trade is dual-model-day-1, not recovery). Concerns for operator: (a) **if "haiku for easy" has any concrete near-term candidate (issue, mailbox, retro), upgrade to β NOW** — α-then-β burns a v0.40.x cycle; (b) Phase-2 should add a `// TODO: extend to FORGE_MODEL_<STAGE> when first EASY-tier stage lands` comment at the resolution site so β's extension point is documented in code; (c) **Reconsider δ ONLY if operator's "config file" ask was about COMMITTING model choice into the repo (team-default-with-CI-pickup) rather than discoverability — different value prop, plan didn't fully tease apart.**

- **P3 (cairn-grounded, 2026-05-08T1530Z): VOTE α — RUNNER-UP β. AGREES WITH P1+P2.** Rationale (cairn-grounded, 3 independent grounding points): (1) **F66 (Hybrid-First Design Reflex) is the strongest argument against ε that neither P1 nor P2 cited.** ε's "env vars layered over config file ... six-layer resolution" matches F66's failure shape verbatim ("local + remote ... split responsibility across different execution surfaces"). F66's cure is "enumerate single-locus interception points first" — α IS that single-locus solution; δ fails the same check (config + in-code fallback = two loci with schema between them); γ introduces a categorization seam without a customer. **α is the only option that cleanly survives F66.** (2) **P50 (Additive Optional Fields) cuts AGAINST δ/ε's "config-file is composable" pro.** Each new `FORGE_MODEL_*` env var is additive, opt-in, no schema bump — that IS P50. The plan's matrix overrated δ's composability advantage; env-var families compose just as cleanly without parser/migration burden. (3) **Live P43 violation in `cost.ts:90` (`model ?? "claude-sonnet-4-6"` literal duplicate of `anthropic.ts:7` DEFAULT_MODEL) is a Phase-2 finding the plan should pre-load** — whichever option wins, implementer must replace that literal with an import from the single resolver or it becomes a third source of truth and re-creates F49. α's tiny blast radius makes this trivial; ε's six-layer resolution makes it harder to verify the literal got caught. (4) **F67 (Subagent Schema Fabrication)** — δ/ε create a Zod-schema verification surface α/β don't have. Pattern miscitations in plan: F49 framed as "RISK" but is actually a refusal-class ANTI-pattern (ε structurally invites it); P32's "5-7 knob threshold" is plan-author extrapolation, not canonical. **P1+P2 convergence is EARNED, not groupthink** — three independent grounding points (F66, P50, live cost.ts:90 measurement). Concerns for operator: (a) **live `cost.ts:90` P43 violation must be folded into Phase-2 AC regardless of winner**; (b) Phase-2 must scrub A1 error message's `forge.config.json` reference under α/β; (c) **CONFIRMED P2's earlier flag — if operator's "config file" ask was about CI-picks-up-committed-model-choice (team-default-with-CI-pickup), neither δ/ε is needed; solvable via committed `.envrc`/`direnv`/`.env.example`. Worth clarifying with operator before Phase-2.**

- **P4 (mechanical-sweep, 2026-05-08T1545Z): VOTE α — RUNNER-UP β. AGREES WITH P1+P2+P3. CONVERGENCE AUDIT: EARNED.** Rationale: (1) all cited line numbers verify against current source (`anthropic.ts:7` DEFAULT_MODEL, `:26` KEYCHAIN_SERVICE_NAME, `cost.ts:90` literal duplicate confirmed, `run-context.ts:43-45` stage plumbing confirmed; 5 stage names verified by grep). (2) **Convergence is EARNED, not cascade.** P1 grounds in F6 precedent + YAGNI (mechanical/measurement axis); P2 in industry-pattern reframing (peer-family axis); P3 in F66+P50+live measurement (cairn axis). Three independent axes, three different cited evidences, one converged answer — textbook earned-convergence signature. A cascade would show each reviewer leaning on prior reasoning; instead each found new grounding the prior missed. (3) P3's F49 reclassification (RISK → ANTI-pattern, refusal-class) is verified at `02-anti-patterns.md:343` — INCREASES the case against ε; doesn't change verdict. P32's "5-7 knob threshold" is plan-author extrapolation, corrected. (4) **Matrix imprecision: actual current FORGE_* count is 4 not 5** (`FORGE_BASH_PATH`, `FORGE_CORRECTOR_MAX_TOKENS`, `FORGE_DASHBOARD_AUTO_OPEN`, `FORGE_SPEC_VALIDATOR_MODE`); α brings it to 5, β to 10, γ to 7, δ stays at 4, ε to 10. Directional correctness preserved; cosmetic correction applied. (5) **Operator-intent gap (P2+P3 flag) is real but does not change the vote** — α is the cheapest both-direction option regardless of which interpretation wins, so voting α is robust to the unresolved ask. The clarifying question goes to the operator BEFORE Phase-2 begins. Plan edits applied: matrix corrected; F49 reclassified; P32 threshold marked extrapolation; new §Operator-intent block added; Phase-2 AC scope expanded with cost.ts:90 + error-message scrub + F54 caveat. Final tally: **4-0 unanimous α (β runner-up); convergence audit EARNED.**
