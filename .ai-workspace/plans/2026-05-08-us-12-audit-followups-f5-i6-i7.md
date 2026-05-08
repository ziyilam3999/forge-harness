# US-12 audit followups — F5 + I6 + I7 + I8 (POLISHED — all 4 reviewers approved, verdicts locked)

## ELI5

v0.40.3's F4 fix made a silent failure loud — and macbook-monday immediately discovered the *real* cause: their Claude Code OAuth handling and forge's MCP child got out of sync. forge currently bails on any token within 5 min of expiry, even though Claude Code's main process is about to refresh that exact token. So forge says "no creds" while Claude Code is happily logged in. **Operator's insight (added post-show-and-wait): forge should defer to the credentials file Claude Code already maintains, not be clever about expiry windows.** Two complementary fixes:

- **I8** (NEW, operator-priority HIGH, fixes the hot path): trust `~/.claude/.credentials.json` as Claude Code's source of truth. Drop the 5-min pre-emptive bail; cap client cache at ≤30s; retry once on 401 (re-reading the file in case Claude Code refreshed between forge's original read and the 401). ~30-40 LOC. Fixes 90% of macbook-monday's hot path.
- **I6** (safety net): when EVEN Claude Code can't help (refresh token also dead, network out, no Claude Code session at all), wrap the LLM call in try/catch so the spec writes a 70% structural shell with an HTML-comment placeholder body. ~15-25 LOC.

I7 (stale-spec banner) still deferred. F5 still merged-into-I6. I8 added this round. All four reviewers approved I8 = ship-it (4-0); F5/I6/I7 verdicts unchanged from prior round.

## Execution model

**Two-PR subagent dispatch in shipping order: I8 → I6.** I8 fixes the hot path (90% of macbook-monday's pain) and is the cheaper, lower-risk change; ship first to get evidence in the wild quickly. I6 follows as the safety net for residual failures Claude Code can't fix. F5 closes for free when I6 ships (no separate ticket). I7 deferred to follow-up issue. Post-merge of both PRs: forge-plan files I7 issue with P2's reshape pre-noted as the leading design, sends final reply to macbook-monday on audit thread.

## Why

- macbook-monday's US-11 + US-12 audits prove forge-harness now surfaces silent failures correctly (v0.40.3 ✓). But surfacing alone doesn't fix the user-facing pain — `TECHNICAL-SPEC.md` is still 8 days stale on monday-bot.
- Operator's framing: *"I'd take 70% regen + a placeholder over 0% regen + a stale doc, every time."* That's the I6 case in one sentence.
- I7 brings the loud-failure principle (which v0.40.3 shipped on the write side via F4) to the read side. Today, a passive operator wouldn't notice a stale spec until something downstream breaks. **Reviewer chain (2-1 defer)**: even with P2's reshape, I7 still introduces a NEW top-level field on `StatusOutput` (verified at `status.ts:80-93` — no warnings field exists). macbook-monday only suggested I7, didn't request it. Defer 1-2 weeks per P3.

## What (intent — outcome we want)

After both I8 and I6 ship, forge-plan replies to macbook-monday on the audit thread with all 4 verdicts (F5 / I6 / I7 / I8) + I7 follow-up issue link.

### I8 — Defer to Claude Code's credentials file; stop pre-emptively bailing on near-expiry tokens (operator priority HIGH; fixes hot path)
- **Source-line evidence**: `server/lib/anthropic.ts:43-61` (`readOAuthToken`) rejects any token with `< 5 * 60 * 1000` ms remaining (line 50-55). `anthropic.ts:74-78` (`getClient`) evicts the cached client when `Date.now() >= expiresAt - 5 * 60 * 1000`. The 5-minute moat is the bug: Claude Code's main process refreshes the file just-in-time, and forge bails on a token Claude Code is seconds away from refreshing.
- **Operator reasoning (verbatim)**: *"since claude code main process will ensure the oauth token keep fresh, why not forge harness just refer to the same oauth token claude code maintaining."* Exactly right. forge already reads the same file; it just needs to stop being clever about expiry windows.
- **Recommended fix (3 changes to `anthropic.ts`)**:
  1. **Drop the 5-min pre-emptive bail.** Replace `if (remainingMs < 5 * 60 * 1000)` (line 50-55) with `if (Date.now() > oauth.expiresAt)` — only reject *strictly* expired tokens. Drop the matching pre-emptive eviction at line 75-78; replace with strict `Date.now() >= expiresAt`.
  2. **Drop the module-level client singleton.** `getClient()` always re-reads `~/.claude/.credentials.json`. The file is ~1KB and OS-page-cache hot after the first read; SDK constructor is config-only (no network, no telemetry init). The `clientExpiresAt` book-keeping disappears with the singleton.
  3. **Retry once on 401.** Wrap the `anthropic.messages.stream(...)` call (`anthropic.ts:259-268`) in a retry: on `err instanceof Anthropic.AuthenticationError` (SDK 0.82.0 — `core/error.ts:133`, `extends APIError<401>`; do NOT status-code-sniff), re-read the credentials file via a fresh `getClient()` and retry the stream once. **Skip the retry when `process.env.ANTHROPIC_API_KEY` is set** — there is no file to re-read; let the original error propagate. If the retry also 401s, throw — and let I6's shell-only path catch it.
- **Tearing-read note**: if the credentials file tears during a concurrent Claude Code refresh, the read either gets the old token (→ 401 → retry re-reads → succeeds with the new token) or the new one. The 401-retry IS the recovery; no inter-process coordination needed.
- **Outcome contract**:
  - Token has 30 seconds of validity left → forge USES it (today: bails). If the call takes longer than 30s and Anthropic returns 401, forge re-reads the file (Claude Code may have refreshed) and retries once.
  - Token is strictly expired and Claude Code has refreshed it on disk → forge re-reads, gets fresh token, succeeds. (Today: forge bails because the cached client thinks it's expired AND the file might still show the old expiry depending on race.)
  - Token is strictly expired AND Claude Code can't refresh (refresh-token also dead, network out, no Claude Code session monitoring this file) → forge throws after one 401-retry. I6's shell-only path catches it. Operator sees a `spec-gen-shell-only` warning naming the cause.
  - **`getCredentialSource()` semantics shift**: returns `oauth` (today: `unknown`) for tokens with 0–5 min remaining. Observable downstream as a BUDGET-widget marker flip in those windows; intended.
- **Cost estimate**: ~30-40 LOC across `anthropic.ts` + 2-3 unit tests (no-pre-emptive-bail, file-reread-after-401, single-retry-not-loop). NOT changing the public `getClient()` / `callClaude` signatures — purely internal hardening. No public-API delta.
- **What I8 explicitly does NOT do** (rejected scope):
  - **Does NOT implement OAuth refresh in forge.** No HTTP calls to refresh endpoints, no file writes, no refresh-token management. Claude Code owns that lifecycle.
  - **Does NOT shell out to `claude login` or any CLI.** forge's MCP child is non-interactive (stdio JSON-RPC) and shelling out would be brittle.
  - **Does NOT coordinate with other forge MCP children.** If two forge processes both 401 simultaneously and both read the file, both get the same fresh token from Claude Code's refresh — no coordination needed.
  - **Does NOT change CI/cron paths.** Those use `ANTHROPIC_API_KEY` and bypass the OAuth read entirely; I8 fixes the macbook hot path only. CI/cron with no creds still throws → I6 catches it.
- **Verdict: ship-it — standalone PR — ship FIRST (before I6) — operator priority HIGH** — Reviewer chain unanimous (4-0); single-locus per F49 (5-min bail mint at one point, not two); SDK 0.82.0's `AuthenticationError` exposed at both `index.d.ts:6` re-export and `client.d.ts:206` static-on-Anthropic; SDK has no `authProvider` callback so manual try/catch is the correct shape; SDK explicitly does NOT auto-retry 401 (`client.js:358-379`) — forge MUST own this retry path.

### F5 — Operational dead-end: F4 surfaces failure but doesn't close the loop
- **Source-line evidence**: post-v0.40.3 (`server/tools/evaluate.ts:407-411` + `:434-441`), the swallow → fallback → typed-warning chain works as designed. Macbook-monday's US-12 evidence (run-record `forge_evaluate-2026-05-08T09-01-58-642Z-43c0.json`) shows both warning kinds present with the `spec-gen-failed` message naming the real cause: "No API credentials found".
- **Verdict: merged-into-I6** — F5 is meta-framing, not a fix-target on its own. The actual fix is I6. F5 motivates I6's verdict; if I6 ships, F5 closes for free. No separate ticket — would be paperwork.

### I6 — Partial-regen-without-LLM (operator priority HIGH)
- **Source-line evidence**: `server/lib/spec-generator.ts:599-606` (`synth()` call site) is the realistic throw locus. Reviewer chain confirmed `parseSpec` (line 578) already has malformed-recovery, and `validateAgainstVocabulary` (line 617) does NOT realistically throw (pure string ops on a known sections map). The throws happen inside `defaultSynthesize` → `trackedCallClaude` (auth, network, JSON parse, zod validation). Single locus.
- **Recommended fix (single-locus shape, NOT a function split)**: wrap ONLY the `synth()` call at `spec-generator.ts:599-606` in an internal try/catch. On throw:
  - Set local flag `shellOnly: true`.
  - Synthesize a placeholder `synthResult` with `contracts: []`, `tokens: { inputTokens: 0, outputTokens: 0 }`, and all four section bodies set to the byte-stable HTML-comment placeholder `<!-- forge: placeholder body — LLM unavailable; see warnings -->`.
  - Continue through the rest of `generateSpecForStory` unchanged: vocab merge (no-op since synth wrote nothing), frontmatter update at line 638 (`lastUpdated` refreshes deterministically), section merge at line 643 (placeholder lands), `idempotentWrite` at line 665 (writes file).
  - Emit `{ kind: "spec-gen-shell-only", message: <truncated err> }` warning inline at the same point `no-vocabulary` is emitted (line 628-ish), into the `warnings: SpecGeneratorWarning[]` array the F4 plumbing already surfaces.
- **Mint locus locked to one level (per F49)**: `spec-generator.ts` mints `spec-gen-shell-only`. The existing F4 catch at `evaluate.ts:407-411` continues to mint `spec-gen-failed` + `spec-gen-skipped-on-pass` only when `generateSpecForStory` *itself* throws (e.g., the placeholder write throws). With I6, `generateSpecForStory` no longer throws on synth-failure; it returns successfully with the new warning. So the F4 plumbing keeps firing only on truly-non-recoverable throws, and the new I6 warning fires on synth-recoverable throws.
- **Co-emission semantics (orthogonal)**: `spec-gen-failed` (F4) and `spec-gen-shell-only` (I6) co-emit only when synth throws AND the catch path then ALSO throws (rare — placeholder write fails). Normal synth-throw → only `spec-gen-shell-only`. `no-vocabulary` is independent and gates on vocab presence pre-throw.
- **Idempotency**: shell-only writes must be byte-identical across consecutive no-creds runs. The HTML-comment placeholder has no per-run timestamps. `idempotentWrite` short-circuits the second run as a no-op, preserving operator's clock-stable git history.
- **Outcome contract**:
  - PASS evaluate WITHOUT LLM creds → run record's `generatedDocs.specPath` is non-empty (file written) AND `warnings[]` contains `kind: "spec-gen-shell-only"` AND the F4 `spec-gen-failed` warning is NOT present (because `generateSpecForStory` now returns successfully).
  - PASS evaluate WITH LLM creds → behavior unchanged from v0.40.3 (full regen, no `shell-only` warning).
  - PASS evaluate where placeholder write itself fails → both `spec-gen-failed` (F4) AND `spec-gen-shell-only` (I6) emit. Orthogonal recovery-class warnings.
- **Cost estimate**: ~15-25 LOC across `spec-generator.ts` + 1 unit test (P64 two-surface assertion: warning lands on BOTH on-disk run record AND MCP top-level `specGenWarnings`). New `SpecGeneratorWarning` discriminated-union variant `spec-gen-shell-only` extends `run-record.ts:197-221` additive-optionally per P50.
- **Verdict: ship-it — standalone PR (operator priority HIGH)** — Reviewer chain unanimous; single-locus shape per F49 + P39 (Non-Fatal Enrichment with Corruption Detection); avoids two-locus drift the original split would have created.

### I7 — Stale-spec banner in `forge_status`
- **Source-line evidence**: `server/tools/status.ts:80-93` (`StatusOutput` type) — verified zero `warnings[]` field and zero `staleSpec?` field exist today. Adding either is a public-API expansion (additive optional, but new top-level field).
- **Verdict: defer — to-be-filed-post-approval — owner: forge-plan** — Reviewer chain 2-1 (P1+P3 defer; P2 ship-it with reshape). P4 sided with defer for three reasons: (a) operator framed I7 as "lower priority, cheap" — *suggested* not requested, no operator pull; (b) status.ts has zero existing warnings field, so even P2's `staleSpec?` reshape is a new public-API top-level optional, not a free additive change; (c) I6's wrap-and-recover changes the spec-staleness semantics — operators with no creds now get a fresh-stamped shell with `spec-gen-shell-only` warning, so I7's age-based banner needs to distinguish "shell-only" from "real" via the run-record warnings stream BEFORE the staleness rule can be designed correctly. Issue title prefix `enh:`. Pre-note P2's reshape (`staleSpec?: { lastUpdated, ageDays, message }` single-purpose top-level field, ~20-30 LOC) as the leading design when the issue is filed.

## Critical files

- `server/lib/anthropic.ts:43-61` — I8 fix locus 1 (`readOAuthToken` — drop 5-min pre-emptive bail)
- `server/lib/anthropic.ts:74-78` — I8 fix locus 2 (cached client eviction — drop singleton entirely)
- `server/lib/anthropic.ts:259-268` — I8 fix locus 3 (`callClaude` stream call — wrap in 401-retry)
- `server/lib/anthropic.ts:33-37` — I8 observable surface (`getCredentialSource()` — outcome contract C1)
- `server/lib/spec-generator.ts:599-606` — I6 fix locus (`synth()` call wrap)
- `server/lib/spec-generator.ts:613-629` — `validateAgainstVocabulary` + warning-emit site (where `spec-gen-shell-only` joins `no-vocabulary`)
- `server/lib/spec-generator.ts:638` — `lastUpdated` deterministic refresh (runs unchanged in shell-only path)
- `server/lib/spec-generator.ts:643` — `renderStorySection` call (writes placeholder body in shell-only path)
- `server/lib/spec-generator.ts:665` — `idempotentWrite` (preserves byte-stability across consecutive no-creds runs)
- `server/lib/run-record.ts:197-221` — `SpecGeneratorWarning` discriminated union (extends with `spec-gen-shell-only`)
- `server/tools/evaluate.ts:407-411` + `:434-441` — F4 chain reference (shows `spec-gen-shell-only` does NOT pass through this path; orthogonal)

## Considered alternatives

- **I8 alternative A (implement OAuth refresh in forge)**: add HTTP client, POST to Anthropic's OAuth refresh endpoint with the `refreshToken` from the credentials file, atomically rewrite the file, retry. Rejected — ~80-150 LOC, race conditions with Claude Code's main process which ALSO writes the file, refresh-token TTL handling, much larger surface. Claude Code already does this; forge should defer.
- **I8 alternative B (shell out to `claude` CLI)**: detect expired token → `child_process.spawn("claude", ["login"])` → re-read file. Rejected — interactive (browser flow), brittle, breaks in CI. forge's MCP child is non-interactive by design.
- **I8 alternative C (proactive eviction with longer pre-emptive window, e.g. 1 min)**: same shape as today, just smaller bail margin. Rejected — strictly worse than dropping the pre-emptive bail entirely. Any pre-emptive window is a guess at when Claude Code will refresh; the file's `expiresAt` field is the actual signal. Use it strictly.
- **I6 alternative A (deterministic-only mode flag)**: input flag `forge_evaluate({mode: "structural-only"})` that explicitly skips LLM. Rejected — adds a public-API knob for a failure-mode case. The throw-and-recover shape is cleaner: structure always runs, prose runs when it can.
- **I6 alternative B (re-throw the LLM error)**: instead of placeholder, re-throw and let F4 plumbing surface it. Rejected — that's what v0.40.3 does today (the `spec-gen-failed` warning IS the surfacing). Operator already sees the cause; they want the *partial* result on top of that. Not a substitute.
- **I6 alternative C (function split)**: split `generateSpecForStory` into `renderStructuralShell` + `enrichStoryBodies`. Rejected — F66 (Hybrid-First Design Reflex) catches it: two-function shape creates two-locus drift risk. Single-locus try/catch around `synth()` is cheaper, simpler, F49-compliant.
- **I6 alternative D (in-session LLM emulation per P65)**: see tier-b card `monday-no-api-key-workaround-2026-04-19.md`. Operator can run `forge_evaluate` in-session by binding the LLM call to the session's already-authenticated client. Documented but complementary to I6, not a substitute — operator still wants the placeholder when emulation isn't run.
- **I7 alternative A (`warnings[]` discriminated union on `StatusOutput`)**: P2's original-rejection target. Heavier than `staleSpec?` reshape (60-100 LOC vs 20-30) but more extensible. Either way, deferred this round.
- **I7 alternative B (`staleSpec?` single-purpose field)**: P2's reshape. Cheaper, simpler, P50-clean. Pre-noted as the leading design for the deferred issue.

## Out of scope

- The `briefScope` flag (I2 from US-11 audit, deferred → issue #539). Still deferred.
- The `forge` CLI bin (I5 from US-11 audit, dropped). Still dropped.
- macbook-monday's credential setup. That's their problem to fix; forge-harness's job is to handle the no-creds case gracefully (which is exactly what I6 ships).
- I7 stale-spec banner — deferred this round (will-be-filed-post-approval as enhancement issue with P2's `staleSpec?: { lastUpdated, ageDays, message }` single-purpose-field shape pre-noted as the leading design). Re-evaluate after 1-2 weeks of I6 operator feedback per P3.

## Cairn references

- **P39 — Non-Fatal Enrichment with Corruption Detection** (`01-proven-patterns.md:270-275`) — strongest structural twin for I6's wrap-and-recover shape. Try/catch around enrichment, restore from cache/structural-shell on failure, log warning. P3 added this citation.
- **F49 — Dual-Level Enforcement of Same Rule** (`02-anti-patterns.md:343-348`) — applies to I6 mint-locus choice. Lock to ONE level (`spec-generator.ts`), never both spec-gen + evaluate. P3 added this citation.
- **F45 (Empty Catch Block on Parse Error)** + **P44 (Loud Failure on Parse Errors)** — applied to F4 in v0.40.3; I6 builds on the same principle: graceful degradation, not silent skip. The `spec-gen-shell-only` warning IS the sentinel that P44 endorses (`02-anti-patterns.md:320` lists "return a sentinel value that clearly indicates failure" as compliant remediation).
- **P50 — Additive Optional Fields for Schema Evolution** — applies to I6 (new `spec-gen-shell-only` warning kind extends discriminated union additive-optionally). Note: P3 verified P50's body is *neutral* on single-purpose-field-vs-discriminated-union choice; it endorses additive-optional generally.
- **P64 — Producer/Consumer Seam Coverage** — applies to I6 unit test: assert the warning lands on BOTH the run record AND the MCP top-level `specGenWarnings`. Same two-surface contract as F4 in PR #537.
- **F66 — Hybrid-First Design Reflex** — caught the original I6 split (`renderStructuralShell` + `enrichStoryBodies`); reviewer chain unanimously adopted single-locus instead. Also applies to I8: rejected alt-A (forge implements own OAuth refresh) was a hybrid-with-Claude-Code; single-source-of-truth (defer to Claude Code's file) is the F66-compliant shape.
- **2026-05-08 PR #537 (F4 ship)** — direct ancestor. F4 made silent failures loud; I6 makes them recoverable.
- **`monday-no-api-key-workaround-2026-04-19.md` (tier-b)** — operator-side context relevant to BOTH I6 (in-session LLM emulation alternative per P65) AND I8 (the card explicitly documents the 5-min eviction buffer that I8 removes).
- **F49 (I8-specific)** — the 5-min bail rule lives at TWO places today (`readOAuthToken:50-55` AND `getClient:75-78`). I8 drops both — single-locus enforcement, no dual-level drift.
- **P64 (I8-specific)** — applies to I8 unit test (AC-G probe 2): assert the SDK was invoked twice AND the second call returned the success payload. Two observable surfaces: producer (call count) + consumer (final return value).

## Notes for reviewer chain (augmented charter — repeated from US-11 round)

This pass is NOT a coherence-only sweep. Every reviewer (P1 stateless / P2 comparative / P3 cairn-grounded / P4 mechanical) ran the augmented worth-it charter. Cross-reviewer consensus held on F5, I6 (single-locus shape after F66 caught the split). Disagreement on I7: P2 ship-it-with-reshape; P1+P3+P4 defer. Reasoning recorded in I7 verdict above. The reviewer chain ran as background subagents per Rule 2 (sequential ≠ foreground).

## Binary AC

- **AC-A**: Final plan has a non-placeholder verdict for every one of F5, I6, I7, I8. Verifier:
  ```
  ! grep -nE 'Verdict:\s*(\[ship-it[[:space:]]*\|[[:space:]]*defer[[:space:]]*\|[[:space:]]*drop\]|\[pending [^]]*\])' <plan> \
    && [ "$(grep -cE '\*\*Verdict:[[:space:]]+(ship-it|defer|drop|merged-into-[A-Za-z0-9_-]+)' <plan>)" -eq 4 ]
  ```
  First clause refuses both unfilled `[ship-it | defer | drop]` placeholders AND `[pending ...]` placeholders; second clause requires exactly 4 filled verdicts.
- **AC-B**: Each `ship-it` verdict references a concrete file:line evidence anchor in current source. Verifier: human review at show-and-wait.
- **AC-C**: Each `defer` verdict names the GitHub issue number post-filing OR notes "to-be-filed-post-approval — owner: forge-plan".
- **AC-D**: Each `drop` verdict gives a one-sentence why-not. (Not applicable this round; F5 is `merged-into-I6`, not `drop`.)
- **AC-E**: macbook-monday receives a final reply on the audit thread itemizing all 4 verdicts post-merge of both I8 and I6.
- **AC-F (I6 code-level, observable from outside the diff)**: Run `forge_evaluate` on a story with `ANTHROPIC_API_KEY` unset and no `~/.claude/.credentials.json`. Verifier:
  ```
  jq -e '.generatedDocs.specPath != "" 
         and (.generatedDocs.warnings | map(.kind) | contains(["spec-gen-shell-only"]))' \
     <run-record.json>
  ```
  PASS condition: file written (non-empty `specPath`), `spec-gen-shell-only` warning present. Run twice consecutively → second run's spec file byte-identical to first (`cmp -s spec-1.md spec-2.md` exits 0).
- **AC-G (I8 code-level, observable from outside the diff)**: Two probes:
  1. **No pre-emptive bail**: stub `readFileSync` to return a credentials file with `expiresAt = Date.now() + 30_000`. Assert `getClient()` returns an `Anthropic` instance (today: throws `"No API credentials found"` because `readOAuthToken` rejects via the 5-min bail and `getClient()` falls through to the throw at lines 103-107). Assert no `expired or expiring soon, skipping` line was written to stderr.
  2. **401 retry**: with a stub Anthropic SDK whose first `messages.stream(...).finalMessage()` rejects with an `Anthropic.AuthenticationError`-shaped error and the second resolves with a normal `Message`, `callClaude` resolves with the second call's text payload. Assert the SDK was invoked exactly twice. Do NOT assert anything about `resetClient()` or singleton state — those are implementation details.

## Revision log

- 2026-05-08: filed by forge-plan post-v0.40.3 ship + post-US-12 macbook-monday audit.
- 2026-05-08: P1/P2/P3/P4 reviewer chain completed (round 1). 11 consolidated edits applied. F66 caught the original I6 split; reviewer chain unanimously adopted single-locus shape. F49 + P39 cairn cites added. AC-A regex bug fixed; AC-F added for code-level observable. I7 verdict locked at defer (2-1).
- 2026-05-08 (post-show-and-wait, mid-flight): operator question about why forge needed `ANTHROPIC_API_KEY` despite Claude Max plan led to discovery that forge was bailing on tokens within 5 min of expiry, even though Claude Code refreshes the file just-in-time. Operator's reframe: "forge harness should just refer to the same oauth token claude code maintaining." I8 added to plan as code-cheap fix (~30-40 LOC) for this hot path. I6 retained as safety net for residual failures.
- 2026-05-08 (round 2 reviewer chain on I8): P1+P2+P3+P4 background subagents per Rule 2 ran focused pass on I8 (F5/I6/I7 verdicts stayed locked). 12 consolidated edits applied. Drop-singleton chosen over 30s-cap. Retry-target locked to `Anthropic.AuthenticationError` (SDK 0.82.0 verified at `core/error.ts:133`). Skip-retry-on-API-key guard added. AC-A regex extended to catch `[pending ...]` placeholders. AC-G probes reframed to observable behavior. F49 + P64 cairn cites added for I8. Tier-b card `monday-no-api-key-workaround-2026-04-19.md` re-cited as relevant to BOTH I6 and I8. CI/cron disclaimer added (I8 fixes macbook hot path only). All 4 verdicts locked, AC-A passes mechanically (0 placeholders, exactly 4 verdicts). Show-and-wait gate ready.
