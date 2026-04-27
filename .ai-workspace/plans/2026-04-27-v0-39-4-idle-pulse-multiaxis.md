---
title: forge-harness v0.39.4 — idle-pulse multi-axis respiration
date: 2026-04-27
ship-version: 0.39.4
prior-version: 0.39.3
---

## ELI5

The idle (no-tool-running) Forge Pulse hexes were technically animating in v0.39.2 — they breathed by changing their *transparency* a little. But at the actual size they render on the dashboard (12 pixels), a transparency-only breath is too subtle for human eyes to register, so the pill *looked* frozen even though the timer was ticking. People couldn't tell whether the page had hung or whether the dashboard genuinely had nothing running.

This patch makes the idle hexes breathe in three ways at once instead of one: (1) they get a little bigger and smaller (18% diameter swing), (2) they fade in and out further (0.40 ↔ 0.78), and (3) a faint grey glow ebbs and flows around them. The cycle also slows from 4 seconds to 4.8 seconds so each phase lingers longer. None of these changes individually would be enough at 12px — but stacked, they cross the perceptual floor and the pill obviously breathes.

We kept the *base* shape (`scale(0.85), opacity(0.55)`) identical so the `prefers-reduced-motion` accessibility fallback (which freezes hexes at the base shape) doesn't drift. The keyframe just modulates *around* that base in both directions.

## Context

v0.39.2 (PR #488) introduced an opacity-only idle breath as part of the US-08 audit fix (AC-3 / B11) — the prior idle state was *literally* static, which the audit flagged as ambiguous against the wave-of-three working states. The opacity-only fix shipped, but a subsequent visual verification with Playwright at native 12px size + frozen-frame keyframe analysis showed the modulation was below the perceptual floor: at the small render size, a 0.4 → 0.7 opacity swing on low-contrast grey hexes is invisible to a casual glance.

Frozen-frame strip evidence (Playwright `animation-play-state: paused` + negative `animation-delay` to capture deterministic phases at 0%/25%/50%/75%/100% of the cycle):
- CURRENT (production v0.39.3): `transform: matrix(0.85, …)` *identical* across all five phases. Only opacity varies. Visually static.
- PROPOSED (v0.39.4): transform varies `0.78 → 0.85 → 0.92 → 0.85 → 0.78` (visible scale change), opacity varies `0.40 → 0.59 → 0.78 → 0.59 → 0.40`, halo varies `none → 4px shadow → none`. Visually breathes.

This is a one-keyframe-rule + one-comment-block CSS edit. No state-machine changes, no class-emit-site changes, no semantic changes — the same `.forge-pulse.idle` element renders, only its keyframe is richer.

## Goal (invariants that must hold when done)

- **G1.** Idle Forge Pulse pill demonstrably animates (visible scale + opacity + halo modulation) at native 12px hex size on the rendered dashboard.
- **G2.** No regression to working-green / working-amber / working-red animations — only the idle keyframe + idle `.hex` rule change.
- **G3.** `prefers-reduced-motion` fallback still parks idle hexes at `scale(0.85) opacity(0.55)` (the base shape, unchanged).
- **G4.** All vitest suites still pass (pre-edit baseline: 980+ tests across the suite, 0 failures).
- **G5.** The state classifier (`classifyForgePulse`) and HTML emit sites untouched — this is purely a CSS keyframe upgrade.

## Binary AC (observable from outside the diff)

- [ ] **AC-1.** `grep -c '@keyframes forge-respire-idle' server/lib/dashboard-renderer.ts` returns `1` (single source of truth, no dupes).
- [ ] **AC-2.** `grep '@keyframes forge-respire-idle' server/lib/dashboard-renderer.ts | grep -c 'transform: scale'` returns `>= 1` (proves scale modulation present, not opacity-only).
- [ ] **AC-3.** `grep '@keyframes forge-respire-idle' server/lib/dashboard-renderer.ts | grep -c 'filter: drop-shadow'` returns `>= 1` (proves halo modulation present via `filter: drop-shadow`, which respects the hex `clip-path` — `box-shadow` would be clipped invisibly inside the polygon and would not render).
- [ ] **AC-4.** `grep -c 'forge-respire-idle 4.8s' server/lib/dashboard-renderer.ts` returns `1` (proves cycle slowed from 4s → 4.8s).
- [ ] **AC-5.** `grep -E 'transform: scale\(0\.85\); opacity: 0\.55' server/lib/dashboard-renderer.ts` matches inside the `prefers-reduced-motion` block — proves accessibility fallback target preserved. (Source declaration order is `transform; opacity;` — matches CSS visual-grouping convention. Future plans should write order-independent regex if order isn't load-bearing.)
- [ ] **AC-6.** `npm run build` succeeds on the worktree (TypeScript compile clean).
- [ ] **AC-7.** `npx vitest run server/lib/dashboard-renderer.test.ts server/lib/dashboard-renderer-grounding.test.ts` exits 0.
- [ ] **AC-8.** `git diff master -- server/lib/dashboard-renderer.ts | wc -l` reports a small focused diff (≤ 30 changed lines) — proves the edit is surgical, not a drive-by refactor.
- [ ] **AC-9.** PR diff touches only: `server/lib/dashboard-renderer.ts`, `package.json`, `CHANGELOG.md`, plus `dist/**` rebuild artifacts. No drive-bys.

## Out of scope

- Rebalancing working-green / working-amber / working-red keyframes. Those animate *visibly* already (frame-by-frame analysis confirmed); only idle was below the perceptual floor.
- Changing the IDLE caption color, container background, or border. Those are already correct per v0.39.2 audit fix.
- Introducing new CSS variables for the halo color. Inlined `rgba(138,138,138,0.55)` is a direct match to the existing `var(--grey)` (`#8a8a8a`) plus 55% alpha — adding a `--grey-rgb` variable for one keyframe usage would be premature abstraction. (Filed as a tracking issue — when a second alpha-modulated grey lands, introduce `--grey-rgb` and rewrite both sites to `rgba(var(--grey-rgb), <alpha>)`.)
- Filing a follow-up perceptual-floor benchmark for the working states. Out of scope; defer until evidence shows a working-state ambiguity.

## Verification procedure (reviewer's one-shot)

```bash
# AC-1 to AC-5: grep gates
grep -c '@keyframes forge-respire-idle' server/lib/dashboard-renderer.ts            # → 1
grep '@keyframes forge-respire-idle' server/lib/dashboard-renderer.ts | grep -c 'transform: scale'  # → >= 1
grep '@keyframes forge-respire-idle' server/lib/dashboard-renderer.ts | grep -c 'filter: drop-shadow' # → >= 1
grep -c 'forge-respire-idle 4.8s' server/lib/dashboard-renderer.ts                  # → 1
grep -nE 'transform: scale\(0\.85\); opacity: 0\.55' server/lib/dashboard-renderer.ts | head        # → match in prefers-reduced-motion block

# AC-6 + AC-7: build + tests
npm run build
npx vitest run server/lib/dashboard-renderer.test.ts server/lib/dashboard-renderer-grounding.test.ts

# AC-8 + AC-9: diff hygiene
git diff master -- server/lib/dashboard-renderer.ts | wc -l
gh pr view <PR> --json files -q '.files[].path'
```

## Critical files (planner names paths; executor picks edit shape)

### Modified
- `server/lib/dashboard-renderer.ts` — three edits:
  1. Comment block at lines ~1097-1103: explain the v0.39.4 multi-axis upgrade and why opacity-only failed at 12px.
  2. `.forge-pulse.idle .hex` animation duration `4s` → `4.8s` (line ~1105).
  3. `@keyframes forge-respire-idle` (line ~1134): add `transform: scale(0.78 ↔ 0.92)` and `filter: drop-shadow(0 ↔ 4px)` modulation alongside the existing opacity stops. (Use `filter: drop-shadow`, not `box-shadow` — the `.forge-pulse .hex` base rule applies a hexagonal `clip-path` that clips `box-shadow` invisibly, making the halo dead CSS; `filter: drop-shadow` respects `clip-path` and paints a halo that follows the silhouette. Caught in stateless review of PR #494, fixed pre-merge.)
- `package.json` — bump `0.39.3` → `0.39.4` (driven by /ship Stage 7 conventional-commit detection).
- `CHANGELOG.md` — /ship Stage 7 prepends a v0.39.4 entry under `### Bug Fixes`.
- `dist/**` — rebuilt by /ship Stage 7 (or post-merge `npm run build` per the auto-pull-rebuild rule).

### Not touched
- `server/lib/dashboard-renderer.test.ts` — no test asserts on the keyframe interior; classifier + emit-site coverage is unchanged.
- `server/lib/dashboard-renderer-grounding.test.ts` — orthogonal to pulse animations.
- Any state classifier (`classifyForgePulse`, `classifyStaleness`) — purely cosmetic CSS upgrade.

## Checkpoint (living)

- [x] Visual evidence captured (Playwright frozen-frame strip — current vs proposed at 5 phases).
- [x] Edit applied to `server/lib/dashboard-renderer.ts` (comment + animation + keyframe).
- [ ] /coherent-plan run on this plan.
- [ ] Worktree created under `.claude/worktrees/v0394-idle-pulse/`.
- [ ] vitest + build local pre-flight green.
- [ ] /ship from worktree (PR + stateless review + merge + release v0.39.4).
- [ ] Post-merge: `git pull && npm run build` on the master clone (auto-pull-rebuild rule).
- [ ] Worktree removed.
- [ ] Working-memory tier-b card written.

## ELI5 of the trick (for future sessions reading this plan)

Why is this CSS-level fix worth a patch ship rather than a same-day re-roll into v0.39.5 / v0.40.0? Because the *audit fix that introduced this regression* (v0.39.2) had its own AC declared satisfied by the opacity-only change, but the perceptual-verification step happened *after* the ship. The lesson — visible animation is not the same thing as keyframed animation; verify at native render size, not at debug-zoom — is the kind of thing that earns its own dot release rather than getting buried in a feature mix.

