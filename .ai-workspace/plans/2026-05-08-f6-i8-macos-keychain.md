---
plan: F6 — I8 misses macOS Keychain
status: DRAFT (pre-reviewer-chain)
authors: forge-plan
date: 2026-05-08
relates_to:
  - prior_plan: .ai-workspace/plans/2026-05-08-us-12-audit-followups-f5-i6-i7.md
  - audit_thread: forge-harness-audit-us-11
  - found_by: macbook-monday (2026-05-08T1218Z)
---

## ELI5

The earlier fix (I8, shipped in v0.40.4) taught forge-harness to read the OAuth login token from `~/.claude/.credentials.json` so Claude Max users on Linux/WSL would Just Work. Macbook-monday dogfooded it on macOS and found the file isn't there — Claude Code on macOS stores the token in macOS Keychain (a system-level secure password manager), not on disk. So every macOS Max user looks like a no-creds user and falls through to the I6 placeholder-body path even though they're properly logged in.

The fix is two parts:
1. **A** — when the file isn't present on macOS, ask Keychain via the built-in `security` shell command, parse the JSON blob exactly the same way as the file would have been. ~5-10 LOC, zero npm deps. Native macOS toolchain.
2. **C** — if even Keychain comes back empty (locked, prompt-timeout, entry missing), emit a typed warning telling the user "set ANTHROPIC_API_KEY env var to bypass — forge can't read Keychain right now." Visible failure instead of silent.

Linux/Windows users keep the existing file-only path. macOS users get the new fallback.

## Execution model

**Single-PR shipping order.** F6 is one tightly-scoped surface (`server/lib/anthropic.ts` + `server/lib/run-record.ts` + `server/lib/anthropic.test.ts`). A and C are entwined — A's failure path IS C's trigger condition — so splitting them costs more than it saves. Ship as one PR.

**Stages:**

1. Worktree from `origin/master` per Rule 12: `.claude/worktrees/f6-keychain-20260508/`.
2. Implement A (`readOAuthTokenFromKeychain` helper + platform-conditional fallback inside `readOAuthToken`).
3. Implement C (new `kind: "spec-gen-creds-keychain-only"` warning variant in `run-record.ts`; emit from `getClient` or its caller's no-creds path on darwin).
4. New test cases in `anthropic.test.ts` covering A's happy path, A's `security` failure path → C, non-darwin file-only path unchanged.
5. `npm test` PASS, `npm run build` PASS.
6. PR + CI + `/ship` Stages 0-10 → v0.40.5. **Cross-machine restart gotcha:** macbook-monday's currently-running Claude Code on v0.40.4 will keep hitting F6 until it restarts the MCP child after v0.40.5 ships — same trap as v0.40.3→v0.40.4. The reply to macbook-monday MUST include "restart Claude Code to pick up v0.40.5" as the first line of the verification section.
7. Update plan revision log with shipped commit + PR number.
8. Reply to macbook-monday with verdict + ship confirmation; archive plan; place cairn-stone.

## Why

**Operator impact.** macOS is the primary OS for ai-brain authors (per `tier-b/topics/migration/2026-05-05-macbook-primary-windows-decommissioning.md` — Windows is decommissioning). Every macOS Max user currently triggers the I6 placeholder-body path on every `forge_evaluate` call even though they have valid creds. The defect is:
- **Silent.** No warning explains "your creds are in Keychain, not on disk, and forge doesn't read Keychain."
- **Wide.** Hits 100% of macOS Claude Max users who haven't manually set `ANTHROPIC_API_KEY`.
- **Workaround-hostile.** The `spec-gen-shell-only` warning's existing text says "log in to Claude Code" but the user already IS logged in — Keychain proves it. The advice is wrong on macOS.

**Why A (security shell-out) over B (keytar dep).** macbook-monday's recommendation, accepted:
- Zero npm dep — `security` is in `/usr/bin/` on every macOS install since 10.x.
- `keytar` is a native binding (N-API) with a known supply-chain headache + cross-platform build matrix overhead.
- The cross-platform parity B offers (libsecret on Linux, wincred on Windows) is **not currently needed** — Linux + Windows Claude Code DOES write `~/.claude/.credentials.json`, so the existing file-only path covers them.
- If future Claude Code releases migrate Linux to libsecret or Windows to wincred, that's a follow-up; A doesn't preclude B later.

**Why bundle A + C.** A's only failure modes (locked Keychain, prompt-timeout, entry missing despite cdat present) need a recovery narrative. Without C, A's failures look identical to "no creds at all" — the user can't tell whether to log in to Claude Code, set ANTHROPIC_API_KEY, or unlock Keychain. C surfaces the actual platform state.

**Plan-time mistake confession.** The original I8 plan (round-2 reviewers, 4-0 ship-it) explicitly said "Defer to Claude Code's existing OAuth lifecycle" — assuming "the file" was the singular contract. That assumption was Linux/WSL-true and silently macOS-false. The plan-time error is on the seam: I8 verified `~/.claude/.credentials.json` shape (P64-style consumer-side check) but did not enumerate producer write surfaces × supported platforms. F6 is the platform-coverage gap. **Note:** A is NOT a "hybrid" in the F66-anti-pattern sense — F66 warns against reaching for hybrids before single-locus solutions; F66 is an anti-pattern, not an endorsement. A is a fallback chain through ONE credential-resolver locus (`readOAuthToken()`); both attempts live behind a single function. F66's prescription (single-locus enumeration) is already followed.

## What

### A. macOS Keychain fallback in `readOAuthToken()`

**Locus.** `server/lib/anthropic.ts:45-65` — `readOAuthToken()`.

**Shape.** Add a `readOAuthTokenFromKeychain()` helper, called as a fallback inside the existing `try { … } catch { return null; }` body. Order:

1. Try `readFileSync(credPath)` first (current behavior — Linux / WSL / macOS-with-explicit-file).
2. If file read or JSON parse throws AND `process.platform === "darwin"`, call `readOAuthTokenFromKeychain()`.
3. Validate the resulting blob the same way (`oauth.accessToken` string + `oauth.expiresAt` number + strict expiry check).

**Keychain helper (intent only — reviewers may refine).**

```ts
// CONTRACT: Keychain entry name pinned to "Claude Code-credentials" as of
// Claude Code (macOS) on 2026-05-03 (cdat from macbook-monday's a9d0 host).
// If Claude Code renames the entry in a future release, this constant must
// follow; symptom would be silent fall-through to no-creds on macOS.
// EXPORTED so spec-generator.ts can use the same string for its emit-point
// existence-check probe — single source-of-truth per F49 (no dual-locus drift).
export const KEYCHAIN_SERVICE_NAME = "Claude Code-credentials";

function readOAuthTokenFromKeychain(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const username = userInfo().username;
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE_NAME, "-a", username, "-w"],
      { encoding: "utf-8", timeout: 2000 },
    ).trim();
  } catch {
    // F45 escape: empty catch + null sentinel is defensible BECAUSE
    // spec-generator.ts emits a typed `spec-gen-creds-keychain-only`
    // warning on this null (P44 loud-failure). Do NOT remove the
    // C-side warning without re-evaluating this catch.
    return null;
  }
}
```

The output of `security … -w` is the password BLOB only (newline-terminated). Claude Code stores the JSON-encoded credentials object as the password blob, so `JSON.parse(blob)` yields the same shape `~/.claude/.credentials.json` would. **The reviewer chain must verify this assumption** — if the password blob is in a different shape (e.g., URL-encoded, base64, custom envelope), A needs a different parser.

**Timeout.** `2000ms` hard cap on the `security` call. macOS may prompt the user for unlock if Keychain is locked AND default ACL allows; we don't want to block the MCP child indefinitely on a UI dialog. P1 sanity-check (2026-05-08): cold Keychain ACL lookups on M-series Macs are 30-150ms typical; APFS-backed pathological cases hit 500-800ms; 2000ms gives ~3x headroom over worst-observed and stays below MCP-child user-perceived stall. **The 2000ms is the failsafe, not the expected latency** — if `security` is locked AND auto-unlock is denied, the call hangs on the modal until this timer fires.

### C. Typed warning when no creds available on darwin

**Locus.**
- `server/lib/run-record.ts:204-232` — `SpecGeneratorWarning` discriminated union (new variant).
- `server/lib/run-record.ts:241-270` — matching Zod schema entry.
- `server/lib/spec-generator.ts:686-688` — emit-point alongside the existing `spec-gen-shell-only` warning. P1 review (2026-05-08) recommended this seam over `anthropic.ts` because (a) all other `spec-gen-*` warnings live there and consumers expect a single seam (P64); (b) routing through `anthropic.ts` would force the credential-resolver layer to import the warning union, creating a cycle risk; (c) the warning is observably a *spec-generator-state* signal ("this run produced placeholder body because creds were Keychain-only"), not a *credential-resolver* signal. **Open question RESOLVED → emit from `spec-generator.ts`.**

**Shape.** Add a new variant:

```ts
| {
    kind: "spec-gen-creds-keychain-only";
    message: string;
  }
```

**Emit-point.** When `getClient()` (or its caller) determines no creds are available AND `process.platform === "darwin"` AND the Keychain entry exists (probed cheaply via `security find-generic-password -s "Claude Code-credentials" -a <user>` without `-w`), emit this warning instead of (or in addition to) the existing `spec-gen-shell-only`. The body text:

> macOS Keychain entry exists for "Claude Code-credentials" but forge-harness cannot read it (locked, prompt-timeout, or ACL mismatch). Set `ANTHROPIC_API_KEY` to bypass.

**Wiring.** `synth()` catches the auth failure (existing path), `spec-generator.ts` then probes `process.platform === "darwin"` AND a cheap `security find-generic-password -s "Claude Code-credentials" -a <user>` existence-check (no `-w` flag — exit code only, no blob retrieval) and pushes the `spec-gen-creds-keychain-only` variant onto `warnings[]` instead of (or in addition to) the existing `spec-gen-shell-only`.

### Soft-touch UX from macbook-monday's mail — **excluded from this PR**

The mail flagged that `spec-gen-shell-only`'s warning body could append "(macOS Keychain users: set ANTHROPIC_API_KEY env var; forge does not currently read Keychain)" on darwin. **After F6 ships A**, macOS Keychain users won't fall through to `spec-gen-shell-only` anymore (they'll get a real client), so the conditional copy is moot. If A's Keychain read fails, C is the right channel. Excluding this UX tweak from the PR keeps the blast radius tight.

## Critical files

- `server/lib/anthropic.ts` (existing, 338 LOC pre-fix; +20-30 LOC for A + helper).
- `server/lib/run-record.ts` (existing; +1 union variant + 1 Zod schema entry; ~10 LOC).
- `server/lib/anthropic.test.ts` (existing 433 LOC; +7 new test cases — see AC-D). **Platform-mock pattern (mandatory):** snapshot the original `process.platform` in `beforeEach`; `Object.defineProperty(process, "platform", { value: "darwin", configurable: true })` inside the test; restore via `Object.defineProperty(process, "platform", { value: <snapshot>, configurable: true })` in `afterEach`. Direct assignment (`process.platform = "darwin"`) fails silently on Node 20+ because the property is read-only. **Diverges from I8's test pattern** at `anthropic.test.ts:293-432` (which never touched platform) — divergence is necessary because F6 is platform-conditional and I8 wasn't.
- `server/lib/spec-generator.ts:680-688` — read-only reference for C's emit-point seam (the `if (shellOnly)` warnings-push block; matches the §What citation above).
- `dist/lib/anthropic.js` — auto-built from `npm run build`, no manual edit.

## Considered alternatives

### Option A — `security` shell-out fallback (CHOSEN)

- **Pros.** Native macOS toolchain (`/usr/bin/security` ships on every macOS install). Zero npm deps. Single platform check. Cleanest blast radius.
- **Cons.** Synchronous shell-out adds ~30-100 ms per cold-cred-resolve on macOS (Keychain ACL lookup). `security` may prompt for unlock if Keychain is locked AND default ACL doesn't auto-allow — the 2000 ms timeout caps this. Doesn't extend to Linux libsecret or Windows wincred.
- **Verdict.** Cheapest correct fix that closes 100% of the macOS Max user gap.

### Option B — `keytar` npm dep

- **Pros.** Cross-platform (macOS Keychain + Linux libsecret + Windows wincred) in one API. Async, no shell-out.
- **Cons.** Native binding (N-API) — supply-chain risk (the 2024 keytar-package compromise is precedent). Build-matrix overhead (`postinstall` recompile on every npm install). Cross-platform coverage is **speculative** — Linux + Windows Claude Code currently writes the file. Only macOS needs Keychain coverage.
- **Verdict.** Rejected. Overkill until Linux/Windows force the issue.

### Option C alone (without A) — typed warning only

- **Pros.** ~3 LOC. Zero behavior change. Just upgrades silent failure to visible failure.
- **Cons.** Doesn't actually fix the bug. macOS Max users still fall through to placeholder-body on every `forge_evaluate` — they're just told why.
- **Verdict.** Rejected as a standalone fix. Bundled into the A PR as the defensive layer for A's failure modes.

### Option D — extend `readOAuthToken` to return `Result<token, reason>` instead of `null`

- **Pros.** Richer error reporting; C's branch could become deterministic (no separate Keychain probe).
- **Cons.** Public-API surface change inside a hot-path helper. Cascades to every caller of `readOAuthToken` (currently 3 sites). I7-flavored scope creep.
- **Verdict.** Rejected. Reshape-class change for a single-defect fix is poor scope discipline.

## Out of scope

- Linux libsecret support (no current evidence of a defect; defer until Claude Code Linux migrates).
- Windows wincred support (same).
- Refactoring `readOAuthToken` to return a richer result type (Option D — too broad).
- Soft-touch UX rewording of `spec-gen-shell-only` warning body (mooted by A).
- I7 stale-spec banner (already deferred as #544).

## Cairn references

- **P64 (Producer/Consumer Seam Assertion)** — F6 *extends* P64 to the platform axis. Canonical P64 says "test both sides of the seam"; F6's lesson refinement is "enumerate producer surfaces × supported platforms in a table BEFORE verdict-lock." Generalization, not direct fit.
- **P50 (Additive Optional Fields for Schema Evolution)** — adding the `spec-gen-creds-keychain-only` variant to the `SpecGeneratorWarning` discriminated union is textbook P50 (additive-only schema growth, old run records still parse via `default([])`). AC-F is the P50 round-trip test.
- **P44 (Loud Failure on Parse Errors) + F45 (Empty Catch Block) escape rationale** — `readOAuthTokenFromKeychain`'s `catch { return null }` reads like F45 on first glance. It is *defensible* BECAUSE the typed `spec-gen-creds-keychain-only` warning at `spec-generator.ts` satisfies P44 — the failure surfaces visibly at the warning seam. **The implementer MUST preserve this property:** if C's existence-probe inside `spec-generator.ts` itself throws, fall through to the existing `spec-gen-shell-only` warning rather than swallowing silently. Without C, the catch *would* be F45.
- **F49 (Dual-Level Enforcement of Same Rule)** — RISK, not endorsement. F49 warns against duplicating the *same* constraint at multiple seams. F6's risk is `KEYCHAIN_SERVICE_NAME` living in two files post-P1 (`anthropic.ts` for the read, `spec-generator.ts` for the existence-probe). Mitigation: `export const KEYCHAIN_SERVICE_NAME` from `anthropic.ts`, import in `spec-generator.ts`. See "Notes for reviewer chain" §3.
- **F54 (Stale MCP Server After dist/ Rebuild)** — the v0.40.4→v0.40.5 "restart Claude Code" gotcha at Stages §6 IS the canonical F54 case. Same mechanism as v0.40.3→v0.40.4 (MCP child loads `dist/index.js` once at startup; rebuilt `dist/` is invisible until restart). The final reply to macbook-monday MUST lead with the restart instruction.
- **F68 + F65 (measurement-first patterns)** — macbook-monday's first F6 ack-mail asserted "I8 untestable, no creds" without `security` probe; the user pushed back and forced re-measurement. Plan-time blob-shape verification deferred to implementer (worktree probe) for the same reason — the harness boundary blocked the planning-stage probe. Both are F68/F65 cases.
- **Predecessor tier-b card:** `tier-b/topics/forge-harness/2026-05-08-v0404-i8-misses-macos-keychain-f6.md` — operational context for the audit finding (already exists at plan-time).
- **Tier-b card to write at ship time:** `2026-05-08-f6-i8-macos-keychain-shipped.md` under `tier-b/topics/forge-harness/` — placed via `memory write` (NOT hand-edited into `hive-mind-persist/knowledge-base/`; that path is forbidden — graduation flows through H4/H5 runners only).

## Notes for reviewer chain

1. **P64 lesson refinement.** The reviewer chain locked round-2 I8 ship-it on "defer to the file Claude Code maintains." That phrasing was platform-blind. P3 (cairn-grounded) should explicitly cite the refinement: **plans must enumerate producer write surfaces × supported platforms in a table BEFORE verdict-lock**. I8 cited "the file" (one row, implicit). F6 reveals the actual table is `{file, Keychain} × {linux, wsl, darwin, win32}` — only one of the eight cells (`Keychain × darwin`) was the gap, but the *enumeration discipline* would have caught it.
2. **Keychain blob shape.** **P1 verdict (2026-05-08):** could not probe — credential-store access denied at the harness boundary (correctly, per Rule 8: "if you can't measure, say so"). Verification deferred to P2 or operator-run one-shot. A's parse is `JSON.parse(blob)` until proven otherwise; if the shape differs (base64 / URL-encoded / custom envelope), A needs a decode adapter. Suggested probe (operator-run): `security find-generic-password -s "Claude Code-credentials" -a $USER -w | head -c 200 | jq -r 'keys'` on a known-logged-in macOS box. **The implementer MUST run this probe in the worktree before locking A's parser.**
3. **C emit-point — F49 dual-locus risk.** P1 routed C to `spec-generator.ts`. That seam now needs its OWN `security find-generic-password -s "Claude Code-credentials"` probe (exit-code only) at emit-time, duplicating the Keychain service-name string from `anthropic.ts`. **Mitigation (mandatory):** export `KEYCHAIN_SERVICE_NAME` as a `const` from `anthropic.ts` and import it in `spec-generator.ts` so the string lives at one source-of-truth. The implementer MUST wire this — drift between the two probes (e.g., a Claude Code rename caught in one file but not the other) silently breaks F6 with no warning.
4. **Test coverage.** Tests must mock `process.platform = "darwin"` AND mock `execFileSync` to cover both A happy and A failure → C paths. `anthropic.test.ts` has prior precedent for `vi.mock("node:fs")` (used in I8's tests at lines 293-432); same pattern applies to `node:child_process`.
5. **Timeout semantics.** Reviewers should challenge the 2000ms cap. Too low → fails on slow Keychain ACL lookups. Too high → MCP child blocks user-visible. 2000ms is a starting guess; P2 may have a stronger number.
6. **Bundle-vs-split.** P1/P2 may argue A and C should split. Plan-time bias is bundled (one defect, intertwined paths). If a reviewer argues split, the chain reconciles before show-and-wait.

## Binary AC

- **AC-A (Keychain fallback fires).** On a macOS host where `~/.claude/.credentials.json` does NOT exist AND the Keychain entry "Claude Code-credentials" exists with a valid OAuth blob: `forge_evaluate('US-13')` succeeds with non-empty `genTokens.outputTokens > 0` (LLM call landed) and ZERO `kind: "spec-gen-shell-only"` warnings emitted. Verifiable by running `forge_evaluate` on macbook-monday's macbook (post-restart on v0.40.5) and inspecting the run record.
- **AC-B (non-darwin unchanged).** On Linux / Windows / WSL, behavior is byte-identical to v0.40.4: the file path is read, Keychain code path is skipped (no `security` invocation), no new warnings. Verifiable by running existing test suite (1052/1052 PASS) plus a new linux-platform test.
- **AC-C (C warning fires when Keychain read fails).** On a macOS host where `~/.claude/.credentials.json` does NOT exist AND `security find-generic-password` returns non-zero exit (locked Keychain, missing entry, ACL mismatch): the run record's `generatedDocs.warnings` contains exactly one `kind: "spec-gen-creds-keychain-only"` warning with non-empty `message`. Verifiable via test mock (`execFileSync` throws).
- **AC-D (test coverage).** New test cases: (i) A happy path on mocked darwin (Keychain returns valid blob → fresh client constructed); (ii) A failure → C on mocked darwin (Keychain returns non-zero exit → `spec-gen-creds-keychain-only` warning emitted); (iii) non-darwin (linux/win32) skips Keychain (no `security` invocation observed); (iv) `process.platform === "darwin"` AND Keychain returns malformed JSON → `readOAuthToken` returns `null` (no crash); (v) `execFileSync` throws `ETIMEDOUT` → `null` (no crash, distinct from generic throw); (vi) Keychain returns empty string (locked-but-listed) → `null`; (vii) `getCredentialSource()` returns `"oauth"` after Keychain hit on darwin (BUDGET-marker dashboard path covered — addresses P1's mis-attribution flag at line 31 of `anthropic.ts`). All seven PASS. Total test count delta: +7 cases. Existing 1052 tests remain PASS.
- **AC-E (build clean).** `npm run build` exits 0 with zero TypeScript errors.
- **AC-F (Zod schema parses new variant).** A round-trip `RunRecordSchema.parse(JSON.stringify({ generatedDocs: { warnings: [{ kind: "spec-gen-creds-keychain-only", message: "test" }] } }))` succeeds.
- **AC-G (PR shipped).** PR for F6 merged to master; tag v0.40.5 published with GitHub Release; CHANGELOG updated.

## Revision log

- **2026-05-08T1240Z** — initial draft. Pre-reviewer-chain. Single-PR shape. A + C bundled. B rejected. macbook-monday's soft-touch UX excluded. Author: forge-plan.
- **2026-05-08T1255Z** — P1 stateless review applied. VERDICT: iterate (4 edits). Changes: (1) C emit-point resolved to `spec-generator.ts` (not `anthropic.ts`) — cycle risk + warning-family seam consistency; (2) AC-D expanded from 4 to 7 cases (added `ETIMEDOUT`, empty-blob, `getCredentialSource()` darwin happy path); (3) `Object.defineProperty` mock pattern called out in Critical files — Node 20+ `process.platform` is read-only; (4) `KEYCHAIN_SERVICE_NAME` extracted to a `// CONTRACT:` comment with cdat pinning. Keychain blob shape still UNVERIFIED at plan time — implementer must probe in worktree before locking parser. Author: forge-plan (applying P1 edits).
- **2026-05-08T1305Z** — P2 comparative review applied. VERDICT: iterate (4 edits). Changes: (1) P64 lesson refinement sharpened — plans must enumerate producer surfaces × platforms in a table BEFORE verdict-lock (was vague); (2) F49 dual-locus risk on `KEYCHAIN_SERVICE_NAME` now explicit — P1 routed C to `spec-generator.ts`, which means the constant lives in two files; mandate single-source-of-truth `export` from `anthropic.ts`; (3) test-mock pattern strengthened with snapshot/restore protocol + explicit divergence note from I8's tests; (4) cross-machine restart gotcha appended to Stages §6 — final reply must lead with "restart Claude Code to pick up v0.40.5". Architectural drift confirmed clean (F6 is a superset of I8, not a contradiction). Author: forge-plan (applying P2 edits).
- **2026-05-08T1320Z** — P3 cairn-grounded review applied. VERDICT: iterate (3 edits, but big content delta). Critical pattern miscitations corrected: (1) F66 was MISCITED as endorsement (it's an anti-pattern warning against premature hybrids) — neutralized in §Why with explicit clarification that A is single-locus fallback chain, not F66-shape; (2) F49 was MISCITED as endorsement of "two complementary layers" (canonical F49 is about duplicating the *same* rule) — kept as RISK only on `KEYCHAIN_SERVICE_NAME` duplication; (3) Cairn references rewritten end-to-end: P64 now "extends to platform axis" (not "covered partially"); P50 added (Zod additive variant); P44+F45 escape rationale added (empty-catch defensible because C satisfies loud-failure); F54 added (the canonical name for the v0.40.4→v0.40.5 MCP-restart trap); F68+F65 paired as measurement-first siblings; predecessor tier-b card cited; ship-time tier-b card path noted as `memory write` not hand-edit. F45 escape-hatch comment added to the helper code block. P39 dropped (loose fit; not actually enrichment). Author: forge-plan (applying P3 edits).
- **2026-05-08T1335Z** — P4 mechanical-sweep review applied. VERDICT: iterate (2 edits, stale-references only — Dimensions 1/3/4/5/6/7 all clean). Changes: (1) `anthropic.ts` LOC corrected from `~110` to `338` (the ~110 figure predated v0.32.7 streaming + I8 retry block); (2) `spec-generator.ts` line citation in §Critical files corrected from `:599-606` to `:680-688` (matches §What's correctly-cited emit-point at the `if (shellOnly)` warnings-push block). All four reviewer rounds complete; plan is ship-ready. Final state: 7 ACs (A-G), 7 test-case delta on AC-D, 4 patterns cited correctly (P50, P44/F45-escape, F54, F65/F68) + 2 risks flagged (F49, F66-anti-pattern), single-PR shape, A+C bundled for v0.40.5. Author: forge-plan (applying P4 edits).
