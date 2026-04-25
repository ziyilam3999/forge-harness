# Dashboard "Forge Pulse" — working/idle indicator

## ELI5

The dashboard shows what the forge-harness is doing. Right now it has a small green/amber/red word-pill that says "LIVE" or "IDLE" — but if you glance at the page, you can't really tell at a distance whether the forge is *currently working* or just sitting there waiting.

We're going to add a tiny three-hexagon cluster at the top of the dashboard. When forge tools are running, the hexagons "breathe" — they grow and shrink in a wave, and a glowing dot in the middle pulses like an ember in a forge. When nothing is running, the hexagons go grey, shrink slightly, and stop moving — visibly "cold." The motion has three speeds: smooth (everything's healthy), labored with a hitch (slow tick — something might be stuck), and frozen with a faint dying glow (probably hung). You can tell the state from across the room.

No backend changes — the signal we need (`isToolRunning(activity)` + `classifyStaleness(elapsedMs)`) already exists in the renderer. This is a render-side visual upgrade only.

## Context

`server/lib/dashboard-renderer.ts` produces `.forge/dashboard.html` — a single self-contained file with inline CSS that auto-refreshes every 5 seconds via `<meta http-equiv="refresh">`. It already computes two pieces of state at render time:

1. **`isToolRunning(activity)`** at `dashboard-renderer.ts:52` — single source of truth for "is a tool running right now."
2. **`classifyStaleness(elapsedMs)`** at `dashboard-renderer.ts:73` — pure function returning `"green" | "amber" | "red"` based on tick freshness.

The current liveness affordance is a small text pill (`.liveness-banner`) showing the band as a coloured background. It's accurate but visually weak: at a distance you can't distinguish between the four states without reading the text. The goal is to make working-vs-idle legible at a glance, with band sub-encoded in motion-shape (not just colour).

The visual concept is committed by the frontend-design skill output (recorded in this session): a three-hex honeycomb cluster with an ember dot. Working = staggered respiration wave + pulsing ember. Idle = static grey silhouette, no ember. Three working sub-bands encode liveness: smooth (green), labored with stutter (amber), frozen mid-cycle with dying ember (red). Full HTML+CSS + rationale in this session's transcript above.

## Goal (invariants that must hold when done)

- **G1.** A glance at `.forge/dashboard.html` from 3+ metres tells the viewer whether the forge is **working** or **idle** without reading text. Validation: the working state contains visible animation; the idle state contains zero animation and visibly different geometry/colour.
- **G2.** The three working sub-bands (green / amber / red) are distinguishable from each other in motion-shape alone, with colour as a secondary cue (so colourblind viewers still parse the state).
- **G3.** The new component replaces `.liveness-banner` in the top bar; the elapsed-time text is preserved as a mono caption inside the new component.
- **G4.** No backend or schema change. The render-side input is the same `(isToolRunning, classifyStaleness(elapsedMs), elapsedMs)` triple already computed; the output class is derived purely in the renderer.
- **G5.** Reduced-motion accessibility: with `prefers-reduced-motion: reduce`, all animations stop and the ember reduces to a static colour fill, preserving the working/idle binary without motion.
- **G6.** No regression in any existing dashboard test (`server/lib/dashboard-renderer*.test.ts`); test count grows by exactly 4 (one per state class).

## Binary AC (observable from outside the diff)

- [ ] **AC-1.** Rendered HTML contains exactly one `.forge-pulse` element, placed in the `.top-bar-right` region (not elsewhere). Verification: `grep -c 'class="forge-pulse' .forge/dashboard.html` equals `1`, AND the element appears between `<div class="top-bar-right">` and that div's closing tag (assertable by ordered grep with line numbers). A count > 1 indicates a render bug (duplicate indicator).
- [ ] **AC-2.** When `activeRun` is non-null and `classifyStaleness(elapsedMs)` returns `"green"`, the element has class `forge-pulse working-green` and contains exactly four child motion targets: three `.hex` spans + one `.ember` span. Verification: dashboard-renderer unit test with fixture inputs.
- [ ] **AC-3.** When `activeRun` is null, the element has class `forge-pulse idle` and contains three `.hex` spans (no `.ember`). Verification: same test file, separate fixture.
- [ ] **AC-4.** When `activeRun` is non-null and `classifyStaleness` returns `"amber"`, the element has class `forge-pulse working-amber`. When `"red"`, class `forge-pulse working-red`. Verification: two more unit-test cases.
- [ ] **AC-5.** The CSS shipped in the rendered HTML defines five `forge-*` keyframes (`forge-respire`, `forge-respire-stutter`, `forge-ember-green`, `forge-ember-amber`, `forge-ember-dying`) plus a `prefers-reduced-motion` media-query block. Verification: `grep -c '@keyframes forge-' .forge/dashboard.html` equals `5` AND `grep 'prefers-reduced-motion' .forge/dashboard.html` returns at least one match.
- [ ] **AC-6.** The old `.liveness-banner` element and its CSS rules are removed. Verification: `grep -c 'liveness-banner' .forge/dashboard.html` equals 0; same grep against `server/lib/dashboard-renderer.ts` equals 0.
- [ ] **AC-7.** `npx vitest run server/lib/dashboard-renderer*.test.ts` exits 0; test-count delta ≥ +4 (one per state).
- [ ] **AC-8.** Visual smoke (manual): open `.forge/dashboard.html` in a browser with at least one fresh `.forge/activity.json` containing a tool name → forge-pulse animates. Empty-out `.forge/activity.json` (or set `tool: ""`), reload → forge-pulse renders idle, no animation, geometry visibly different. Acceptance: a screenshot pair (working + idle) attached to the PR description.
- [ ] **AC-9.** `npm run build` passes; no TypeScript errors introduced.

## Out of scope

- **No new server-side liveness signals.** The existing `isToolRunning` + `classifyStaleness` pair is sufficient. If we later want a "starting up" or "draining" state, that is a follow-up plan with new signal definitions.
- **No JS-driven animation.** All motion lives in CSS keyframes. The 5-second meta-refresh is the only "tick" the page has — adding setInterval/requestAnimationFrame would conflict with the refresh-cut model.
- **No icon-font or external SVG.** The hex shape uses the same `clip-path: polygon(...)` already in the codebase (line 588 of dashboard-renderer.ts). One vocabulary, two ranks.
- **No theming / dark-mode toggle.** The current dashboard is light-only by design (parchment / olive); dark-mode is a separate product call.
- **No keyboard / focus interaction.** The component is a status indicator (`role="status"`, `aria-label`), not interactive. No tab-stop, no click target.
- **No `forge_*` runtime instrumentation changes.** Specifically, the meaning of "working" stays exactly what `isToolRunning` says today — we are not redefining liveness, only re-rendering it.

## Critical files (planner names paths; executor picks edit shape)

### Modified

- `server/lib/dashboard-renderer.ts` — three edits:
  1. **CSS block** (lines ~525-605): add ~80 lines of `.forge-pulse` rules + 5 keyframes + reduced-motion block. Remove the 6 `.liveness-banner` rules at ~549-553.
  2. **HTML builder** (around the top-bar render site — find by `grep -n 'top-bar-right' server/lib/dashboard-renderer.ts`): insert the new `<div class="forge-pulse ...">` markup as the *first* child of `.top-bar-right`. Remove the old `.liveness-banner` markup.
  3. **State classifier**: a small pure helper (e.g., `classifyForgePulse(activeRun, elapsedMs)`) returning one of `'idle' | 'working-green' | 'working-amber' | 'working-red'`. Place near `classifyStaleness`. Reuse `classifyStaleness` internally for the three working sub-bands.

- `package.json` — version bump on `/ship` Stage 7. Targets **v0.36.1** *if* shipped after v0.36.0 lands; if shipped before v0.36.0, this work folds into the v0.36.0 cumulative bundle and no separate bump occurs. Conventional-commit prefix: `fix(dashboard):` to keep the bump as a patch (the underlying surface — `forge_status` JSON — does not change; this is a polish on the existing rendering pipeline).
- `CHANGELOG.md` — `/ship` Stage 7 prepends the entry under `### Bug Fixes` (or `### Features` if the executor disagrees with the patch framing — confirm at ship time).

- Three existing dashboard test files: `server/lib/dashboard-renderer.test.ts`, `server/lib/dashboard-renderer-polish.test.ts`, `server/lib/dashboard-renderer-declarations.test.ts`. Executor must:
  1. `grep -l 'liveness-banner' server/lib/dashboard-renderer*.test.ts` to enumerate which existing tests assert against the old class. Migrate every match to `.forge-pulse` with appropriate sub-band class (these are intentional surface migrations, not regressions).
  2. Add 4 new fixture-driven cases (idle, working-green, working-amber, working-red) — each asserting the correct top-level class on the rendered element. Place in whichever test file is the closest semantic fit (most likely `dashboard-renderer.test.ts` for new fundamental-shape coverage).
  3. Net test-count delta must be ≥ +4 even after migrations.

### NOT touched

- `server/tools/status.ts` (the JSON shape stays exactly as today; `activeRun` and elapsed are already exposed).
- `server/lib/activity.ts` (the activity-file contract is unchanged).
- `server/lib/declaration-store.ts` (declarations participate in `buildActiveRun` only; renderer doesn't need a new path).
- `schema/*.json` (no schema-bumped surface).
- Any cross-cutting infra (cost / progress / audit).

## Reused functions

- `isToolRunning(activity)` (`dashboard-renderer.ts:52`) — already authoritative for working vs idle.
- `classifyStaleness(elapsedMs)` (`dashboard-renderer.ts:73`) — already returns `'green' | 'amber' | 'red'`. Compose it inside `classifyForgePulse`.
- `clip-path: polygon(...)` hex primitive (line 588) — same shape vocabulary, multi-instanced.
- Existing CSS variables `--green`, `--amber`, `--red`, `--green-bg`, `--amber-bg`, `--red-bg`, `--off-white`, `--white`, `--border`, `--border-light`, `--text-dim`, `--shadow-sm`, `--font-mono` — no new variables introduced.

## Verification procedure (reviewer's one-shot)

1. **Build + tests**:
   ```bash
   npm run build
   npx vitest run server/lib/dashboard-renderer
   ```
   Expect both green; test count up by 4.

2. **Render smoke** — drop a fixture activity file then render:
   ```bash
   mkdir -p .forge && echo '{"tool":"forge_evaluate","storyId":"US-FIXTURE","stage":"running","startedAt":"2026-04-25T12:00:00Z","lastUpdate":"2026-04-25T12:00:00Z"}' > .forge/activity.json
   node -e "import('./dist/lib/dashboard-renderer.js').then(m => m.renderDashboard('.'))"
   grep -c 'class="forge-pulse' .forge/dashboard.html   # expect ≥ 1
   grep -c 'liveness-banner' .forge/dashboard.html       # expect 0
   ```

3. **Visual smoke** — open `.forge/dashboard.html` in a browser. Cluster animates. Then `rm .forge/activity.json && node -e "..."` — cluster goes cold. Take screenshots; attach to PR.

4. **AC-X3-style allowlist** — diff confined to: `server/lib/dashboard-renderer.ts`, `server/lib/dashboard-renderer*.test.ts`, this plan file, `CHANGELOG.md`, `package.json`. Any path outside this list is a flag.

## Considered alternatives (so the user can redirect)

- **(a) Hex-cluster respiration (chosen).** Three hexes + ember, motion encodes both work/idle and three sub-bands. Reuses existing hex vocabulary. Recommended.
- **(b) Larger single hex with internal fill animation.** Simpler to implement (~30 fewer CSS lines) but doesn't read as "wave through a system" — and doesn't differ enough from the existing single `hex-pulse` empty-state dot. The user would still see "a hex, sometimes moving" in two places. Rejected.
- **(c) Spinning gear icon.** The "forge" metaphor *would* support gears, but a spinner reads as generic loading-screen affordance; provides no information beyond "something is happening." Rejected.
- **(d) Anvil + spark icon set.** Too literal / cute; clashes with the engineering-instrument tone of the existing dashboard. Rejected.
- **(e) Keep `.liveness-banner` text pill, just add a moving dot beside it.** Smaller change but also smaller payoff — colour-only differentiation persists, and the across-the-room glance test still fails. Rejected.

## Checkpoint (living)

- [x] Existing dashboard architecture mapped (HTML auto-refresh, CSS variables, `isToolRunning` + `classifyStaleness` signals, hex primitive vocabulary).
- [x] frontend-design skill invoked; bold direction committed (industrial respiration / 3-hex cluster + ember).
- [x] Plan drafted at `.ai-workspace/plans/2026-04-25-dashboard-forge-pulse-indicator.md`.
- [ ] `/coherent-plan` critique pass on this file.
- [ ] User approval to proceed.
- [ ] `/delegate --via subagent` to executor (or solo execute — small enough to consider inline).
- [ ] Modify `server/lib/dashboard-renderer.ts` (CSS + HTML + classifier helper).
- [ ] Add 4 unit-test cases (idle, working-green, working-amber, working-red).
- [ ] Run `npm run build` + `vitest run server/lib/dashboard-renderer` → both green.
- [ ] Render fixture-driven smoke + capture screenshots (working + idle).
- [ ] `/ship` PR (this is master-bound — full ship including release bump).

Last updated: 2026-04-25 — plan drafted; awaiting `/coherent-plan` critique + user approval.
