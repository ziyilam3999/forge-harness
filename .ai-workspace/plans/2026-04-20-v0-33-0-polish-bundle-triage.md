---
title: "v0.33.0 polish bundle — triage & PR grouping"
date: 2026-04-20
owner: forge-plan (planner)
status: approved (awaiting per-PR execution)
---

## ELI5

After the four v0.32.x releases, 20 small "polish" enhancement issues accumulated on GitHub. None are bugs, none block anyone — they're cosmetic cleanups, minor refactors, and small UX improvements that the `/ship` stateless reviewer flagged across shipped PRs. Rather than fix them one at a time and ship 20 tiny releases, we want to triage them into one coherent **v0.33.0 polish release**: decide which to fix, which to defer, which to close as duplicates, and **group the fixes by surface** so the actual implementation breaks into a handful of focused PRs instead of one sprawling mega-PR.

This plan **is the triage**. It does not ship fixes. When the user approves it, the output is: (a) `#322` is closed as dup of `#315`, (b) 16 issues are labelled `ready` for the polish PRs, (c) 2 issues (`#310`, `#327`) get a "deferred to v0.34+" comment with rationale, (d) a PR grouping recommendation for execution to follow.

## Context

**Origin.** Pre-compact card `2026-04-20-session-state-pre-compact-6-arc-closed.md` flagged "21-issue enhancement backlog" as the natural next track after the monday-bot 4-blocker arc closed (v0.32.6/7/8 all shipped and confirmed working by monday on 2026-04-20T04:32Z). Actual fetched count = **19 pre-existing + 1 just-filed (#331) = 20 issues**. Card's "21" was a one-off off-by-one.

**Provenance of each issue.**
| Source release | Issues | Trigger |
|---|---|---|
| v0.32.5 (`/ship` review of PR #305, setup-config fix) | #306-#311 (6) | Stateless reviewer E1-E6 |
| v0.32.6 (`/ship` review of PR #313, corrector fix) | #314-#318 (5) | Stateless reviewer |
| v0.32.7 (`/ship` review of PR #320, DEFAULT_MAX_TOKENS sweep) | #321-#324 (4) | Stateless reviewer |
| v0.32.8 (`/ship` review of PR #326, unconditional streaming) | #327-#330 (4) | Stateless reviewer |
| post-v0.32.8 (monday's FYI mail) | #331 (1) | Operator observation (dashboard idle-banner copy) |

All 20 carry labels `enhancement` + (usually) `ship-review`, `housekeep-triaged`, and one of `housekeep-mechanical` / `housekeep-judgment`. None are labelled `bug` or `ready`.

**Why bundle now.** The pre-compact card's rationale: "Candidate for a bundled v0.33.0 polish release in a fresh session with a dedicated triage pass (dedupe, group by file, close-as-won't-fix where stale). Not urgent." Monday's monday-bot work is unblocked and no new forge-harness demand is active, so this is a good break-window to draw down polish debt.

**What's NOT in this scope.** GitHub has ~20 additional open `enhancement` issues from v0.32.0-v0.32.4 era (`#271`-`#303` range). They're polish too, but they predate the card's stated scope. Deliberately excluded from this triage; flagged in "Out of scope" so the user can decide later whether a v0.34.0 should absorb them.

## Goal

When this triage plan closes:

1. **Every one of the 20 issues has a verdict**: `bundle`, `defer`, or `close-as-dup`.
2. **Fix scope for v0.33.0 is deterministic**: a concrete list of N issues to address, grouped into proposed PRs.
3. **Duplicates are collapsed**: `#322` is closed on GitHub as dup of `#315`.
4. **Deferred issues carry their rationale**: `#310` and `#327` have a "deferred to v0.34+ because <reason>" comment on the GH issue so future triage doesn't re-litigate.

## Verdict per issue

Legend: `B` = Bundle into v0.33.0 · `D` = Defer to v0.34+ · `X` = Close as dup · `A` = Audit-only (may close with no code change)

| # | Title (abridged) | Surface | Size | Verdict | Rationale |
|---|---|---|---|---|---|
| 306 | drop dead `EXPECTED_DIST` | setup-config-acceptance.sh | XS | B | 1-line delete or 1-line tighten |
| 307 | guard `/c/Windows/System32` behind OS check | setup-config-acceptance.sh | XS | B | Trivial conditional |
| 308 | add host-pollution sha256 assertion | setup-config-acceptance.sh | S | B | Externalises AC-9 verifiability — worth it |
| 309 | distinguish CLI-missing vs CLI-failed in fallback | setup-config.cjs | XS | B | Wording fix |
| 310 | spawnClaude `shell:true` → explicit claude.cmd | setup-config.cjs | M | **D** | Latent trap, not a real bug. Substantive refactor needs a dedicated spike (`where claude`, Windows PATHEXT, POSIX behavior). Park as `#310` deferred to v0.34+; revisit if a spaces-in-path user reports breakage |
| 311 | log note on invalid `~/.claude/settings.json` | setup-config.cjs | XS | B | stderr line |
| 314 | defensive fallback for future `stop_reason` literals | anthropic.ts | S | B | Type-narrow so new SDK enum becomes a TS error, not a silent miss |
| 315 | switch AC-7 from stdout grep to `--reporter=json` | corrector-crash-fix-acceptance.sh | M | B | **Primary** of the `#315`/`#322` pair |
| 316 | consolidate JSDoc above `runCorrector` + `CORRECTOR_MAX_TOKENS` | server/tools/plan.ts | XS | B | Cosmetic comment merge |
| 317 | drop redundant `message.toContain("max_tokens")` assertion | anthropic.test.ts | XS | B | Tightens test contract |
| 318 | export / env-override `CORRECTOR_MAX_TOKENS` | server/tools/plan.ts | S | B | Operator ergonomics. `FORGE_CORRECTOR_MAX_TOKENS` env read + keep 32000 default |
| 321 | add explicit AC-7 wrapper-exists check OR renumber | default-max-tokens-sweep-acceptance.sh | XS | B | 1-line `[ -x "$0" ]` |
| 322 | harden AC-5 vitest output parsing | default-max-tokens-sweep-acceptance.sh | M | **X** | **Close as dup of #315**. Same fix (switch to `--reporter=json`) retires both wrappers |
| 323 | trim `wc -l` whitespace for BSD portability | default-max-tokens-sweep-acceptance.sh + corrector-crash-fix-acceptance.sh | XS | B | ` | tr -d ' '` on each site |
| 324 | audit `server/tools/evaluate.ts` for max_tokens risk | server/tools/evaluate.ts + server/lib/evaluator.ts | S | **A** | Audit-only. If zero explicit `maxTokens` overrides exist, close with findings comment. If any found, file a follow-up issue |
| 327 | AST-based call-site counter (replace JSDoc regex) | scripts/unconditional-streaming-acceptance.sh | L | **D** | Substantive — introduces ts-morph / TS compiler API dependency to a shell-only acceptance wrapper. Not worth the coupling for a single-use regression guard. Defer; revisit if a second wrapper wants the same AST counter |
| 328 | break dense v0.32.8 CHANGELOG paragraph | CHANGELOG.md | XS | B | Copy-edit, no code |
| 329 | surface `cache_creation_input_tokens` + `cache_read_input_tokens` | anthropic.ts | M | B | Extends the usage contract. Optional fields, no breaking change. Cost attribution win |
| 330 | hoist `mockCreate` tripwire to suite-scoped `afterEach` | anthropic.test.ts | S | B | Strengthens the tripwire across every test in the file |
| 331 | dashboard idle-vs-hung banner copy | dashboard-renderer.ts | S | B | Threads `activity.tool` into client script; branches banner on idleness + elapsed |

**Rollup:**
- **16 B (Bundle)** — the v0.33.0 scope.
- **1 X (Close-as-dup)** — `#322`.
- **2 D (Deferred)** — `#310`, `#327`.
- **1 A (Audit)** — `#324`, may contribute zero code but produces closure comment.

## Proposed PR grouping

| PR | Surface | Issues | Files touched | Est size |
|---|---|---|---|---|
| **A1** | setup-config polish | #306, #307, #308, #309, #311 | `scripts/setup-config.cjs`, `scripts/setup-config-acceptance.sh` | ~30 LoC |
| **A2** | acceptance wrapper polish | #315 (retires #322), #321, #323 | `scripts/corrector-crash-fix-acceptance.sh`, `scripts/default-max-tokens-sweep-acceptance.sh` | ~40 LoC |
| **B** | anthropic + plan polish | #314, #316, #317, #318, #329, #330 | `server/lib/anthropic.ts`, `server/lib/anthropic.test.ts`, `server/tools/plan.ts` | ~60 LoC |
| **C** | CHANGELOG + dashboard polish | #328, #331 | `CHANGELOG.md`, `server/lib/dashboard-renderer.ts` | ~50 LoC |
| **D** | evaluate.ts max_tokens audit | #324 | (read-only if clean) | 0-20 LoC |

Total: **5 PRs**, **16 fixes** + 1 dup-close + 1 audit, roughly **~180 LoC**.

## Checkpoint

- [x] Fetch all 20 issue bodies via `gh issue view`
- [x] Classify each issue with verdict `B | D | X | A`
- [x] Group bundle issues into 5 proposed PRs by surface
- [x] Draft this triage plan to `.ai-workspace/plans/`
- [x] Present ELI5 summary + PR-grouping recommendation to user
- [x] User approved (5 PRs, proceed, remember v0.34.0 follow-up)
- [x] Execute triage side-effects: #322 closed as dup, #310/#327 commented deferred, 17 issues labelled `ready`
- [x] Save v0.34.0 follow-up commitment to memory
- [ ] Commit this plan file to master (rides with PR A1)
- [x] /compact at this boundary
- [ ] Draft per-PR implementation plans (A1 in progress)

Last updated: 2026-04-20T06:15:00+00:00 — triage delivered; GH side-effects landed; PR A1 drafted.
