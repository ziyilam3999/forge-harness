# Plan: ship-fix PR #456 — dark-mode ember box-shadow specificity

## Execution model

Inline fix during /ship Stage 5b BLOCK on PR #456. One MINOR bug found by stateless review; fix scope is 4 selector prefixes (`:root` qualifier) on a single file.

## Context

Stateless reviewer of PR #456 (iteration 1) flagged B1: the four `box-shadow` overrides inside the `@media (prefers-color-scheme: dark)` block at `server/lib/dashboard-renderer.ts:597-600` are dead CSS. They share specificity (0,2,0 / 0,2,1) with later same-selector rules at lines 625, 638, 646, 652 — and `@media` blocks do NOT bump specificity, so source order kills the dark-mode glows. The PR body's "wider glow spread on the dark base" claim is silently undelivered.

## Goal

Dark-mode ember rules actually win the cascade against the same-selector rules that appear later in the file. Smallest possible diff. AC-3 (exactly one `@media` block) preserved.

## Fix

Bump specificity on the four override selectors by prefixing each with `:root` (a no-op match against the same elements, but raises specificity from 0,2,0/0,2,1 to 0,3,0/0,3,1, beating any same-selector rule regardless of source order).

## Binary AC

- **F-1.** `grep -cE '^\s*:root \.forge-pulse' server/lib/dashboard-renderer.ts` returns 4 (the four overrides each prefixed with `:root`).
- **F-2.** `grep -c '@media (prefers-color-scheme: dark)' server/lib/dashboard-renderer.ts` STILL returns 1 (no second media block introduced — preserves AC-3).
- **F-3.** `npx vitest run server/lib/dashboard-renderer.test.ts server/lib/dashboard-renderer-polish.test.ts server/lib/dashboard-renderer-reconciliation.test.ts server/lib/dashboard-renderer-declarations.test.ts server/lib/dashboard-renderer-dark-mode.test.ts` exits 0 (no test churn).
- **F-4.** `npm run build` exits 0.

## Out of scope

- E1 (border contrast at 1.45:1), E2 (`--light-green` consumer check), E3 (stricter test value-shape), E4 (brace-balancer hardening) — file as enhancement issues post-merge per Stage 5b auto-issue creation.

## Critical files

- `server/lib/dashboard-renderer.ts` — four `:root` prefixes added to lines 597-600.

## Checkpoint

- [ ] Edit applied (4 selector prefixes).
- [ ] Local vitest passes.
- [ ] `npm run build` passes.
- [ ] Commit (new commit, not amend) + push.
- [ ] Re-spawn stateless reviewer (Stage 5 iteration 2).
