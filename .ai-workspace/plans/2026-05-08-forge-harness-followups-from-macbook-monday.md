# Forge-harness followups from macbook-monday — F1–F4 + I1–I5 triage (POLISHED — F4 awaiting re-review)

## ELI5

A real end-user (macbook-monday, who just shipped US-11 from a fresh laptop) sent us a bug + wishlist + (mid-flight) **a second bug**. F4 came in after the first reviewer chain finished — it's a silent-correctness defect that has been quietly making `TECHNICAL-SPEC.md` go stale on every PASS since US-08. Their hypothesis (W3 short-circuit regression) doesn't match the source — actual root cause is a swallowed exception in `forge_evaluate`'s spec-generator path. Forge-plan's job here is **not** to ship everything — grade each item: ship now (real value, low cost), defer (file an issue, real but not urgent), or drop (not worth the LOC). Reviewer chain ran the fact-checks twice (initial pass on F1–F3 + I1–I5; focused F4 pass after F4 arrived). Final tally — **9 verdicts**: **5 ship-it (4 PRs)**, **1 defer (to-be-filed enhancement issue)**, **2 drop**, **1 merged-into-another-item**. Detail below.

## Execution model

**Single-bundle subagent dispatch per locked verdict.** Plan now spans 4 PRs (likely 5 once F4 verdict locks):

1. **F4 standalone PR (NEW — likely highest priority, awaiting reviewer pass)** — un-swallow + warn + validate spec-generator failures on PASS path (code). Operator priority is above I1 because F4 is a silent correctness regression already affecting US-08 → US-11.
2. **F2 standalone PR** — host-aware dashboard marker (code).
3. **I1 + I4 co-shipped in one PR** — surface canonicalized ADR path on `forge_evaluate` response (code) + brief instruction append referencing it (docs+code). Co-shipping kills the transient where the brief references a field the response doesn't yet expose.
4. **F3 standalone docs PR** — `docs/audit-ritual.md` listing canonical dashboard-event forge calls.
5. **I3 standalone docs PR** — `docs/cross-machine-portability.md`. Ships separately from F2 because F66 is single-CODE-locus, not single-PR; bundling unrelated write surfaces adds review noise.

**Defer**: I2 (`briefScope` flag) — forge-plan files enhancement issue post-show-and-wait.
**Drop**: F1 (merged into I4 brief append; no separate ticket); I5 (covered by a doc-snippet alternative; new CLI surface unjustified).

Rationale: items are independent in scope (renderer, evaluate response, brief, two docs files); chained PRs would just slow ship cadence. Reviewer charter was augmented this round per operator's exact ask: every reviewer fact-checked AND classified each item ship-it / defer / drop / merged.

## Why

macbook-monday is the first non-Windows operator to ship a story end-to-end (US-11 PASS, PR ziyilam3999/monday-bot#142, squash `026b423`). The audit they sent us is W3-dogfood-grade evidence — exactly the signal forge-harness was built to surface. Acting on the highest-impact items closes the feedback loop and de-risks US-12+. Ignoring or deferring everything would tell future operators the audit ritual is theater.

## What (intent — outcome we want)

After the verdicts below land in code, forge-plan replies to macbook-monday on thread `forge-harness-audit-us-11` with a single mail itemizing all 9 verdicts (F1–F4 + I1–I5). The reply is sent **post-merge** of all `ship-it` items, so the verdicts referenced in the reply have already shipped. The defer item ships its enhancement issue link in the same reply.

### F4 — TECHNICAL-SPEC silently skipped on PASS evaluate (NEW — bug-class, regression)
- **Source-line evidence (forge-plan's diagnosis, supersedes macbook-monday's W3 hypothesis)**:
  - `server/lib/spec-generator.ts:563-668` — `generateSpecForStory()` always invokes the LLM at line 599-606. There is **no W3 pre-LLM short-circuit**. The W3 fix (`idempotentWrite`, line 665) only skips the *file write*, not the LLM call.
  - `server/tools/evaluate.ts:407-411` — exception thrown by `generateSpecForStory()` is caught, logged to **stderr only**, and swallowed. `generatedDocs` stays `undefined`.
  - `server/tools/evaluate.ts:434-441` — when ADR extractor produces paths AFTER spec-generator failed, a fallback `generatedDocs` is synthesized with hardcoded `{specPath:"", genTokens:{0,0}, contracts:[], warnings:[]}`. **This is the run-record shape macbook-monday observed** — not a W3 short-circuit, but a silent-swallow fallback.
  - Macbook-monday's `genTokens: 0` evidence does NOT prove the LLM never ran. The fallback at :434-441 hardcodes zeros regardless of whether spec-generator's LLM call was reached or not.
- **Recommended fix (combines macbook-monday's options B + C, drops option A as misdiagnosis-driven)**:
  1. **Outcome 1 (un-swallow)** — the spec-generator-failed swallow path surfaces a typed warning kind on **both** the on-disk run record's `generatedDocs.warnings` AND the MCP response's top-level `specGenWarnings`. Field shape is additive-optional per **P50**, executor's choice within the existing `SpecGeneratorWarning` discriminated-union extension at `server/lib/run-record.ts:186-228`. Top-level `specGenWarnings` at evaluate.ts:501-502 must be filled from this same warning, not left as the current `?? []` fallback.
  2. **Outcome 2 (PASS-incomplete gate)** — on PASS, an empty `specPath` with the synthesized-fallback shape is treated as an incomplete record. Either the call re-throws (preferred — surfaces to caller) or attaches an error-severity warning kind so consumers cannot see PASS + empty specPath silently.
  3. **Outcome 3 (test seam, P64 producer/consumer)** — unit test injects a synthesizer-throwing stub via `generateSpecForStory`'s import seam and asserts the warning lands on (a) the on-disk run record AND (b) the MCP top-level `specGenWarnings`. Both surfaces are observable from outside the diff.
- **Cost estimate**: ~25 LOC + 1 unit test. Patch-class change (no public API delta — the warning kinds extend the existing discriminated union additive-optionally).
- **NOT recommended (operator's option A)**: "move W3 guard from pre-LLM to pre-write." There is no pre-LLM W3 guard. `idempotentWrite()` already runs at the write step. Option A describes the *current* behavior, not a fix.
- **Verdict: ship-it — standalone PR — priority above F2** — Silent-correctness regression confirmed at evaluate.ts:407-411 (F45/P44 violation: empty-catch + silent stderr) + evaluate.ts:434-441 synthesized-fallback masking PASS-incomplete records. Fix is verifiable from outside the diff via the test seam. Macbook-monday's W3-regression hypothesis disproven (Rule 8 / F68 — bug filed without measuring the actual code path).

### F2 — Dashboard auto-open marker is not host-aware
- **Source-line evidence**: `server/lib/dashboard-renderer.ts:1596` — `markerPath = join(projectPath, ".forge", ".dashboard-opened")`. Stat-only check at :1597–1620; no host gate. Verified at master `eef0ea8`.
- **Recommended fix** (matches macbook-monday's option A): stamp marker body with `host=<os.hostname()>\nopened=<iso>`; on read, suppress only when `host` matches. Legacy-format markers (no `host=`) treat as foreign → open once + rewrite. Emit one structured stderr log line `forge.dashboard.marker.legacy_rewrite` with `{oldTimestamp, newHost}` per legacy rewrite for ops visibility.
- **Cost estimate**: ~30 LOC + 1 unit test in `dashboard-renderer.test.ts`. Ships as patch-class change (no public-API delta).
- **Verdict: ship-it — standalone PR** — Bug confirmed at the cited line; host-stamp is the canonical fix; supported by 2026-05-05 windows-only-tier-b cross-machine lesson (operator-managed cross-machine state needs host-awareness).

### I1 — Surface canonicalized ADR path in `forge_evaluate` MCP response
- **Source-line evidence**: `server/tools/evaluate.ts:419-447` — `processAdrStory()` runs, result `adr.newAdrPaths` lands on `RunRecord.generatedDocs.adrPaths` (lines 426/436). Response shape at `evaluate.ts:179-186` is `{ content, specGenWarnings? }` — there is **no `body` field**. Canonicalized paths are NOT surfaced to the calling agent.
- **Recommended fix**: add `adrCanonicalized?: Array<{from, to, adrId}>` as a top-level field on the MCP response (peer of `specGenWarnings`, additive optional per **P50**). Field is set only in story-mode evaluate (the `processAdrStory` call site at evaluate.ts:420); coherence-mode and dispute-mode handlers do not add the field.
- **Cost estimate**: ~10 LOC + response-shape unit test. Additive optional, backward-compat — no breaking change.
- **Verdict: ship-it — co-ships with I4 in single PR** — Data already exists; surfacing it costs ~10 LOC and follows the additive-optional-field discipline.

### I4 — Brief documents the "second commit needed" pattern
- **Source-line evidence**: `server/lib/generator.ts:53` — `ADR_CAPTURE_INSTRUCTIONS` declaration; `:63` — consumer in `buildAdrCapture()`. Currently silent on the post-evaluate canonicalization commit step.
- **Recommended fix**: append one paragraph to `ADR_CAPTURE_INSTRUCTIONS` referring to the new `adrCanonicalized` field that I1 surfaces. Tells the calling agent: "If you wrote a staging ADR, the PASS path canonicalizes it; the canonical path is in `adrCanonicalized` — stage and commit it as a follow-up."
- **Cost estimate**: ~15 LOC string + 1 snapshot test update.
- **Verdict: ship-it — co-ships with I1 in single PR** — Co-shipping kills the lying-string transient where the brief references an `adrCanonicalized` field the response doesn't yet expose. Atomic landing.

### F3 — Audit-ritual spec ambiguity (which forge calls are dashboard events)
- **Source-line evidence**: `server/tools/status.ts` has zero refs to `renderDashboard`. Active call sites: `server/lib/run-record.ts:345`, `server/lib/progress.ts:205`, `server/lib/dashboard-render-loop.ts:200, 343`. (Plan's earlier draft cited stale lines 133/183/146/279 — those are unrelated comments.)
- **Recommended fix**: documentation in `docs/audit-ritual.md` (new) listing the canonical set: `forge_generate ✓`, `forge_evaluate ✓`, `forge_coordinate ✓`, `forge_reconcile ✓`, `forge_declare_story ✓` (v0.40.2 wired wake), `forge_status ✗`, `forge_lint_refresh ✗` (read-only).
- **Cost estimate**: ~40 lines markdown.
- **Verdict: ship-it — standalone docs PR** — Pure docs, low cost, closes a real audit-ritual ambiguity for every future operator.

### I3 — Cross-machine state-portability docs (ties to F2)
- **Recommended fix**: new `docs/cross-machine-portability.md` listing each `.forge/` artifact + its portability semantics (portable / NOT portable / regenerable / transient). Cite F2 fix as the host-aware example.
- **Cost estimate**: ~80 lines of markdown.
- **Verdict: ship-it — standalone docs PR** — F66 (single-CODE-locus, not single-PR) does NOT govern PR packaging; bundling I3 into F2 would mix unrelated write surfaces and add review noise. Standalone docs PR is cleaner; F2 reverts cleanly if it regresses; I3 ships when ready.

### F1 — ADR canonicalization process gap (RESUME doc / brief silence)
- **Verdict: drop — merged-into-I4** — F1's only proposed fix is the I4 brief append; a separate ticket would be paperwork for nothing. The I4 PR closes F1 transitively.

### I2 — Configurable `briefScope` flag in `forge_generate`
- **Source-line evidence**: `server/lib/codebase-scan.ts:35` — `KEY_FILES = ["package.json", "tsconfig.json", "README.md"]`. README bundled unconditionally.
- **Recommended fix**: input flag `briefScope: "minimal" | "standard" | "full"`. `minimal` → drop README + tsconfig from scan. Default `standard` (current behavior, no breaking change).
- **Cost estimate**: ~25 LOC + 2 unit tests. Public-API knob with three values.
- **Verdict: defer — to-be-filed-post-approval — owner: forge-plan** — Real value but unverified need: macbook-monday flagged ~2.5K extra brief tokens, but no current consumer is hitting a context-budget ceiling. Cheapest flip-to-ship-it: a second consumer reports brief-bloat impact. Issue title prefix `enh:`.

### I5 — `forge` CLI bin (non-MCP entry point)
- **Source-line evidence**: no `bin/` directory exists in repo. `package.json` has no `bin` field.
- **Verdict: drop — write-doc-snippet-instead** — Doc snippet showing how to drive the dist MCP transport from a shell (stdio JSON-RPC) closes all three named use cases (cron `forge_status` to Slack, CI gate, pre-MCP bootstrap) without shipping a new public surface (versioning, build integration, semver guarantees, docs). F66 reinforces: a `bin/forge` wrapper atop dist server is a redundant interception layer. Cheapest flip-to-ship-it: a second non-MCP consumer (≥2 reports of named use cases the doc snippet doesn't cover).

## Critical files

- `server/tools/evaluate.ts:381-411` (silent-swallow catch) + `:434-441` (synthesized fallback) — F4 fix locus
- `server/lib/spec-generator.ts:563-668` — F4 reference (where exceptions actually originate)
- `server/lib/dashboard-renderer.ts:1590-1633` — F2 fix locus
- `server/tools/evaluate.ts:179-186` (response shape) + `:419-447` (ADR canonicalization) — I1 fix locus
- `server/lib/generator.ts:53` (ADR_CAPTURE_INSTRUCTIONS) + `:63` (consumer) — I4 fix locus
- `server/lib/codebase-scan.ts:35` — I2 deferred locus (referenced in issue)
- `docs/cross-machine-portability.md` (new) — I3
- `docs/audit-ritual.md` (new) — F3

## Considered alternatives

- **F4 option A (operator-recommended)**: "render content first, byte-compare on-disk, only then skip the write — move the W3 guard from pre-LLM to pre-write." **Rejected** — there is no pre-LLM W3 guard in the code. `idempotentWrite()` already runs at the write step (spec-generator.ts:665), so option A describes the *current* behavior, not a fix. Operator's hypothesis was wrong; the bug is upstream silent-swallow, not a W3 short-circuit.
- **F4 option D (alternate)**: detect spec-generator failure pattern (specPath:"" + 0 tokens) at the dashboard renderer and surface visually. Rejected — the silent-failure happens upstream; surfacing only at the dashboard means CLI-only consumers (CI, cron) never see it.
- **F2 option B** (per-host filename `.dashboard-opened-{hostname}`): rejected by sender + reviewers; cleanup story is fuzzy when an old host's marker lingers forever.
- **F2 option C** (setup.sh quarantines stale markers on bootstrap): reactive, doesn't help operators who never re-run setup. Keep as belt-and-braces if option A regressions appear.
- **F2 timestamp-only check** (mtime older than process start ⇒ suspect cross-machine copy): rejected — false positives from `cp -p`, NTP jumps, clock skew. `os.hostname()` is the correct signal.
- **I5 alternative**: doc snippet showing how to drive the MCP transport from a shell — adopted (becomes the I5 drop rationale).

## Out of scope

- v0.40.2 follow-up issues #529–#532 (already filed, narrow internal refactors, zero overlap with macbook-monday's items).
- Anything in monday-bot's own US-12 backlog. Forge-harness ships fixes; monday-bot consumes them on next pull.

## Cairn references

- **F45 — Empty Catch Block on Parse Error** + **P44 — Loud Failure on Parse Errors, Never Silent Catch** — apply to F4 root cause. The `evaluate.ts:407-411` swallow does `console.error()` only, then drops the failure on the floor. F45 is the canonical anti-pattern for this; P44 is the fix-shape pattern (warn-or-throw, never silent).
- **Rule 8 (measurement-discipline)** + **F68 — Filing Bug Reports Without Measuring First** — apply to macbook-monday's W3-regression hypothesis. They filed the fix shape without reading the actual code path (no grep for `idempotentWrite` ordering, no read of evaluate.ts:407-411 catch). Their own audit-correction admits the W3 PASS claim was a measurement-discipline failure. Second n=1 sighting — promotes F68 toward accepted.
- **P64 — Producer/Consumer Seam Coverage** — applies to F4 unit test. The fix has TWO observable surfaces (run record on disk + MCP top-level response); test must assert both, otherwise one surface silently regresses.
- **Candidate new cairn stone** (drop after F4 ships): `PASS verdict + empty specPath + empty warnings on a story-mode run record is structurally incomplete; either re-throw or attach a kind:"spec-gen-skipped-on-pass" warning at error severity.`
- **P50 — Additive Optional Fields for Schema Evolution** (apply to I1: `adrCanonicalized?` is additive optional, no version bump, full backward-compat).
- **F2 (anti-pattern)** — behavioral prose without consequences. AC-A's mechanical regex enforces "every item carries a non-placeholder verdict," so the verdict-discipline rule has teeth.
- **F66 — Hybrid-First Design Reflex** (apply *against* I5 — a `bin/forge` wrapper atop the dist MCP server is a redundant surface; reinforces drop verdict). Does NOT govern PR packaging.
- **F67 — Subagent Schema Fabrication** + **F68 — Filing Bug Reports Without Measuring First** (apply to I1 implementation: verify the actual response shape against `evaluate.ts:179-186` before coding, don't recall a `body` field that doesn't exist).
- **P59 — Transport-Boundary Smoke Test** (apply *additionally* if the I1 PR ships a CI smoke through `StdioClientTransport`; not a substitute for the unit test).
- **P62 — Running Beats Reading** (apply to F2: write a unit test that runs the marker check with `os.hostname()` mocked, don't just static-read the new branch).
- **2026-05-05 windows-only-tier-b-cards-do-not-cross-to-macbook** — same class of bug as F2 (operator-managed cross-machine state needs host-awareness). Cuts in favor of *direction* (host-awareness needed) but not specific *shape* (host-stamped body vs per-host filename).

## Notes for reviewer chain (augmented charter — operator's exact ask, COMPLETE)

Reviewer chain ran as background subagents per Rule 2: P1 (stateless), P2 (comparative), P3 (cairn-grounded), P4 (coherent-plan mechanical sweep). Each reviewer fact-checked source claims and classified each item ship-it / defer / drop / merged. Output of each reviewer is in the session transcript; reconciled findings are baked into the verdicts above. Cross-reviewer consensus held on F2, F3, I1, I2, I5; P3 reframed F1 from "defer" (P1+P2) to "drop merged-into-I4" (most honest); P2/P3 over-rode P1's I3-bundle-with-F2 packaging on F66 grounds; P2/P3 over-rode P1's I4-standalone packaging on lying-string-transient grounds. Final lock by P4.

## Binary AC

- **AC-A**: Final plan has a non-placeholder verdict for every one of F1, F2, F3, F4, I1, I2, I3, I4, I5. Verifier: `! grep -E 'Verdict: \[(ship-it \| defer \| drop|pending P1-P4 fact-check)\]' <plan>` AND `grep -cE '^- \*\*Verdict: (ship-it|defer|drop|merged-into-)' <plan>` returns exactly **9**.
- **AC-F (F4-specific)**: given a synthesizer-throwing stub injected via `generateSpecForStory`'s import seam, `forge_evaluate` MCP top-level response contains `specGenWarnings` with one element of `kind === "spec-gen-failed"`, AND the persisted on-disk run record's `generatedDocs.warnings` contains the same element. Verifier: vitest assertion on both surfaces (P64).
- **AC-B**: Each `ship-it` verdict references a concrete file:line evidence anchor in current source. Verifier: human review at show-and-wait.
- **AC-C**: Each `defer` verdict names the GitHub issue number post-filing OR notes "to-be-filed-post-approval — owner: forge-plan". Verifier: human review.
- **AC-D**: Each `drop` verdict gives a one-sentence why-not. Verifier: human review.
- **AC-E**: macbook-monday receives a single final reply on thread `forge-harness-audit-us-11` itemizing all 8 verdicts, sent **post-merge of all `ship-it` items** (so verdicts referenced in the reply have already shipped). Verifier: `/mailbox sent` shows the reply post-ship.

## Revision log

- 2026-05-08: filed by forge-plan (session `42567c24...`) post-v0.40.2 ship.
- 2026-05-08: P1/P2/P3/P4 reviewer chain completed (sequential, all background subagents); 16 consolidated edits applied; verdicts locked (4 ship-it, 1 defer, 2 drop, 1 merged); awaiting operator approval at show-and-wait gate.
- 2026-05-08 (post-show-and-wait, mid-flight): macbook-monday filed F4 — TECHNICAL-SPEC silently skipped on PASS evaluate. Operator hypothesis (W3 short-circuit regression) does not match current source. Forge-plan's diagnosis: silent-swallow at evaluate.ts:407-411 + synthesized-fallback at :434-441. Recommended fix shape: combine options B + C (warn on swallow + validate non-empty specPath on PASS), drop option A. F4 added to plan as bug-class item; reviewer chain re-running with focused F4 charter while F1-F3 + I1-I5 verdicts remain locked.
