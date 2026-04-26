# Plan: Dashboard dark mode — "Forge at Night"

## ELI5

The dashboard right now is a warm-paper light theme — beige background, dark-grey text, hex-shaped status indicators. Great for daylight; harsh for late-night sessions. We're adding a **dark-mode sibling** that auto-flips based on the user's OS preference (no toggle button, no settings). The aesthetic is "ironworks at twilight": deep cold-blue iron base instead of pure black, ember-copper accents on the active states, the hex-pulse indicator glows instead of filling. The light theme keeps every pixel of its current character; the dark theme is its night-shift twin.

No new files in the runtime path. No JS toggle. No render-time branch. The whole feature ships as one CSS block scoped under `@media (prefers-color-scheme: dark)` inside the existing `DASHBOARD_CSS` constant in `server/lib/dashboard-renderer.ts`.

## Context

`server/lib/dashboard-renderer.ts` builds `.forge/dashboard.html` as a single self-contained file with inline CSS and meta-refresh polling every 5s. The current theme is hard-coded into a `:root { --white: #f7f5f0; ... }` block (lines 566-577) and consumed by ~50 selectors below it. There is no theming layer, no `data-theme` attribute, no JS branch — colors flow purely through CSS variables.

This makes dark-mode a **mechanical exercise**, not an architecture refactor: drop a `@media (prefers-color-scheme: dark) :root { ... }` block that re-points the same variable names at dark-tuned values, plus targeted overrides for the few rules that bake in light-specific values (the `top-bar::before` gradient, the `.empty-hex` and `.hex-dot` defaults, and the four `.forge-pulse.working-*` shadow halos that need re-tuning at lower base luminance).

Why this matters: operators run multi-hour `forge_coordinate` sessions. The dashboard is open in a browser tab the whole time. A blazing beige background at 11pm is operationally hostile. Auto-detect-via-`prefers-color-scheme` is the default behavior every modern UI has — the dashboard standing out by *not* having it is conspicuous.

### Why no toggle button

- The dashboard is render-time-only — no setInterval, no JS branch logic (line 105: "no in-browser branch logic, no IIFE — render-time classification is sufficient because the dashboard auto-refreshes every 5s"). A toggle button would force JS state.
- `prefers-color-scheme` covers >95% of operator intent: the OS already knows whether it's daytime or nighttime mode. Honoring that preference is the strict-superset solution.
- If someone wants to override, browsers expose per-site dev-tools controls; we'd be reinventing them.

## Goal (invariants that must hold when done)

- **G1.** When the user-agent's `prefers-color-scheme` is `dark`, opening `.forge/dashboard.html` in a browser shows dark backgrounds (no white/beige bleed) on the page body, top bar, stat cards, kanban columns, story cards, activity feed, and forge-pulse cluster.
- **G2.** When `prefers-color-scheme` is `light` or unspecified, every pixel of the rendered HTML is byte-identical to the pre-change output. The light theme is the unchanged baseline.
- **G3.** Every existing test in the four current `dashboard-renderer*.test.ts` files passes unchanged. Tests assert markup structure, class names, and content — not color hex values — so no test churn is expected; G3 is the canary that proves no markup regression slipped in. The fifth file added by AC-5 (`dashboard-renderer-dark-mode.test.ts`) must also pass, but its first-run pass is part of AC-5/AC-1 rather than G3.
- **G4.** The Forge Pulse indicator's four states (idle / working-green / working-amber / working-red) remain visually distinguishable in dark mode. The dying-ember vs steady-ember vs no-ember semantic is preserved.
- **G5.** WCAG AA contrast: body text on body background ≥ 4.5:1; `--text-dim` on background ≥ 3:1 (large/dim text floor). Verified by reading the chosen variable values, not by automated tooling (the renderer has no DOM at test time).
- **G6.** No new runtime dependencies. No new files on the runtime path (i.e. nothing new under `server/lib/` that gets compiled into `dist/server/lib/` and imported by the running MCP server). The runtime diff stays inside `server/lib/dashboard-renderer.ts` (CSS edit only). One new vitest file is permitted alongside the existing test files at `server/lib/dashboard-renderer-dark-mode.test.ts` — test files are excluded from the runtime build by `tsconfig`/`vitest.config` convention, so they don't violate "no new runtime files."
- **G7.** `prefers-reduced-motion: reduce` continues to disable forge-pulse animations in BOTH themes. The existing `@media (prefers-reduced-motion: reduce)` block at lines 637-644 must keep its current shape unmodified, and must NOT be duplicated under the dark-theme block. (Aligns with the Out-of-scope row "Reduced-motion changes" — no edits to that block.)

## Binary AC (observable from outside the diff)

- [ ] **AC-1.** `npx vitest run server/lib/dashboard-renderer.test.ts server/lib/dashboard-renderer-polish.test.ts server/lib/dashboard-renderer-reconciliation.test.ts server/lib/dashboard-renderer-declarations.test.ts server/lib/dashboard-renderer-dark-mode.test.ts` exits 0 with no skips, no test count regression vs master in the first four files, and the fifth file (added by AC-5) contributes at least 4 new passing tests.
- [ ] **AC-2.** `npx vitest run server/smoke/mcp-surface.test.ts` exits 0 (per `feedback_local_vs_ci_smoke_tests.md` — explicitly run before any /ship).
- [ ] **AC-3.** The rendered dashboard HTML contains exactly one `@media (prefers-color-scheme: dark)` block in its `<style>` content. Source-level observable check (no build required): `grep -c '@media (prefers-color-scheme: dark)' server/lib/dashboard-renderer.ts` returns `1`. Because `DASHBOARD_CSS` is a static template literal embedded verbatim into the rendered HTML, source occurrence-count equals rendered occurrence-count. (If a future refactor splits the CSS into a builder function the AC needs an updated form, but for the v0.36.x renderer this grep is exact.)
- [ ] **AC-4.** That `@media (prefers-color-scheme: dark)` block redefines AT LEAST the following CSS variables: `--white`, `--off-white`, `--border`, `--border-light`, `--text`, `--text-secondary`, `--text-dim`, `--green`, `--green-bg`, `--amber`, `--amber-bg`, `--red`, `--red-bg`, `--grey`. Verifiable by grepping the rendered HTML's dark-media block for each name.
- [ ] **AC-5.** A new vitest file `server/lib/dashboard-renderer-dark-mode.test.ts` exists and contains at least four assertions: (a) HTML contains the `@media (prefers-color-scheme: dark)` block exactly once; (b) every variable named in AC-4 appears redefined inside that block; (c) the existing `@media (prefers-reduced-motion: reduce)` block also still appears exactly once (no duplication regression); (d) the light-theme `:root` block at the top of `DASHBOARD_CSS` still sets the original `--off-white: #efece5` value (G2 byte-identity canary — proves we didn't accidentally edit the light theme variables).
- [ ] **AC-6.** Manual verification step recorded in PR description: open `.forge/dashboard.html` in Chrome with DevTools → Rendering → "Emulate CSS media feature prefers-color-scheme: dark" — header, stats row, kanban board, activity feed, and forge-pulse cluster all render with dark backgrounds and lifted-lightness accent colors. Screenshot attached to PR body.
  - `allow-diff-inspection: visual aesthetic verification has no automated channel in this codebase; the dashboard has no Playwright snapshot or visual-regression infrastructure (verified by Glob — no snapshot fixtures, no Storybook, no chromatic config). Manual screenshot in PR body is the only observable channel for prefers-color-scheme rendering. Reviewer (human or PR-comment skim) confirms presence of the screenshot and the visual cues it captures.`
- [ ] **AC-7.** Build completes: `npm run build` exits 0; `dist/server/lib/dashboard-renderer.js` exists with a non-zero size delta vs master (proves the CSS string grew).

## Out of scope

- **JS toggle button.** No `<button>`, no `localStorage`, no `data-theme` attribute. `prefers-color-scheme` only.
- **Per-component dark variants beyond color.** The kanban-column hex-clip silhouette stays the same; layout is unchanged; spacing tokens are unchanged; font stack is unchanged.
- **Light-theme refinements.** The plan must not touch any value inside the existing `:root { ... }` block. If the light theme has flaws, file separately.
- **Dashboard-reference.html files** in `.ai-workspace/plans/` and worktrees — those are stale snapshots, not part of the runtime. Do not edit them.
- **Print stylesheet** (`@media print`). Not requested; out of scope.
- **High-contrast mode** (`prefers-contrast: more`). Out of scope; if eventually added it's a separate slice.
- **Storybook / visual regression / Playwright snapshot.** The codebase has no visual-regression infra; AC-6 manual screenshot is sufficient.
- **Reduced-motion changes.** The existing `@media (prefers-reduced-motion: reduce)` block keeps its current shape unmodified.
- **README / changelog narrative beyond the standard /ship-generated entry.** /ship Stage 7 generates the patch-bump and CHANGELOG line; do not hand-author additional docs.

## Aesthetic direction (intent the executor implements)

**"Forge at Night"** — the dashboard is an ironworks at twilight, not a terminal. Specific intent:

- **Iron base, not pure black.** Background tones cluster around `#0e1419` (page) → `#161d24` (cards) → `#1f2731` (elevated surfaces). The blue tint reads as "cold metal cooling," not "I forgot to set a background color."
- **Ember accents on active state.** The `--amber` accent in dark mode shifts toward copper (`#d97757`-ish, not pure orange). It's the "live forge" color — used on the in-progress kanban accent, the working-amber forge-pulse, the active story card's border.
- **Glow, don't fill.** The hex-clip indicators and the forge-pulse hexes use lifted lightness + a low-spread `box-shadow` glow rather than saturated fills. On dark backgrounds, fills look like stickers; glows look like incandescence.
- **Greens at lower saturation.** `--green` in dark mode is `#5eb88a`-ish (desaturated, lifted lightness) rather than `#16a34a` (which is the WCAG-AA color from the light theme — too saturated for dark backgrounds, becomes neon).
- **Reds darker base, lighter foreground.** `--red-bg` becomes a deep oxblood (`#3a1818`-ish), `--red` becomes a softer salmon (`#e88078`-ish). The "blocking" replanning-note still reads as alarming, but doesn't rip the eye.
- **Borders fade, not vanish.** Borders shift from `#ccc8be` (medium-grey on warm cream) to `#2a3340`-ish (slightly-lighter-than-card slate). Visible enough to define edges, dim enough to recede.

The executor has discretion to fine-tune the exact hex values within these intent envelopes. Any value that satisfies G5 (WCAG AA contrast) is acceptable.

## Critical files (planner names paths; executor picks edit shape)

### Modified
- `server/lib/dashboard-renderer.ts` — extend the `DASHBOARD_CSS` constant string. Add a `@media (prefers-color-scheme: dark) { :root { ... } /* + targeted overrides */ }` block AFTER the existing `:root { ... }` block (line 577) and BEFORE the next selector (`html { font-size: 15px; }` at line 578). Keep the existing `:root` block byte-identical. Targeted overrides will likely be needed for: the `top-bar::before` gradient (line 582 — uses `var(--green)` already, so should auto-flow if the variables are well-defined), `.empty-hex` and `.hex-dot` defaults if their backgrounds reference `--border-light` (already do — should auto-flow), and the four `.forge-pulse.working-*` shadow rules at lines 614, 622, 628 (the `box-shadow` colors there hard-code `var(--green/amber/red)` — auto-flows). Most overrides will be variable-only; expect ≤5 selector-level overrides total.

### New
- `server/lib/dashboard-renderer-dark-mode.test.ts` — single new vitest file. Mirrors the structure of `dashboard-renderer-polish.test.ts` (which is the closest analogue — small file, render-once-then-grep style). Houses AC-5's four assertions. Do NOT add cases to the existing four test files (keeps the dark-mode change isolated from the existing test files' git-blame).

### NOT touched
- `server/lib/dashboard-renderer.test.ts` — must not change. Existing 999-line file.
- `server/lib/dashboard-renderer-polish.test.ts` — must not change.
- `server/lib/dashboard-renderer-reconciliation.test.ts` — must not change.
- `server/lib/dashboard-renderer-declarations.test.ts` — must not change.
- Any file under `.ai-workspace/plans/` other than this plan file.
- Any worktree under `.claude/worktrees/`.
- `package.json` (no new dependencies; /ship Stage 7 handles the version bump).
- The existing `:root { ... }` block lines 566-577 — light-theme variables are frozen.
- The `@media (prefers-reduced-motion: reduce)` block lines 637-644 — must keep current shape.

## Reused functions / utilities

- **CSS variable cascade** — already in place; the entire renderer's color story flows through `var(--name)` references. No refactor needed; the dark-mode block re-points the same names.
- **Existing `@media` query convention** — the file already has `@media (prefers-reduced-motion: reduce)` (line 637). The new block is the next sibling, same convention.
- **Existing `prefers-color-scheme` standard** — supported in every browser ≥2019. No polyfill; no fallback path needed.

## Verification procedure (reviewer's one-shot)

1. **Local pre-push** from forge-harness root:
   ```
   npx vitest run server/lib/dashboard-renderer.test.ts \
                 server/lib/dashboard-renderer-polish.test.ts \
                 server/lib/dashboard-renderer-reconciliation.test.ts \
                 server/lib/dashboard-renderer-declarations.test.ts \
                 server/lib/dashboard-renderer-dark-mode.test.ts   # AC-1, AC-5
   npx vitest run server/smoke/mcp-surface.test.ts                  # AC-2
   npm run build                                                     # AC-7
   ```
2. **Render a fixture dashboard** by invoking `renderDashboardHtml({brief: null, activity: null, auditEntries: [], renderedAt: new Date().toISOString()})` in a Node REPL or scratch script, write to a temp file.
3. **AC-3 grep:** rendered HTML contains exactly one `@media (prefers-color-scheme: dark)` substring.
4. **AC-4 grep:** rendered HTML's dark-media block contains every variable name listed.
5. **AC-6 visual:** open the rendered file in Chrome, DevTools → Rendering pane → set "prefers-color-scheme" to "dark" and "light" alternately. Confirm: dark mode shows dark backgrounds + ember accents on active states; light mode is byte-identical to current production output. Capture two screenshots (one per theme); attach to PR body.
6. **/ship** from the feature branch: standard 11-stage pipeline. Stage 5 stateless review reads the diff + runs both vitest invocations + verifies the grep ACs. Stage 7 generates the patch-bump CHANGELOG entry referencing this PR.

## Considered alternatives (so the user can redirect)

- **(a) `@media (prefers-color-scheme: dark)` only — chosen.** Smallest diff, no JS, no state, honors OS preference. Acceptance test trivially observable.
- **(b) JS toggle button + `localStorage`.** Larger diff (HTML + JS + storage seam + persistence semantics + render-time branch). Defeats "no in-browser branch logic" line 105 invariant. Rejected unless explicitly requested.
- **(c) Ship as a separate "dashboard-dark.css" file linked conditionally.** The dashboard is a single self-contained HTML file by design (line 13: "single self-contained HTML file with inline CSS and JS"). Adding an external link breaks the self-contained invariant. Rejected.
- **(d) Replace the light theme entirely with dark.** User asked for dark mode, not theme replacement. Rejected.
- **(e) Use the same hex values as the existing light theme but invert luminance via `filter: invert()`.** Produces nausea-inducing colors (greens become magentas). Rejected on aesthetic grounds.

## Execution model

`/delegate --via subagent` per `feedback_delegate_subagent_default.md`. The plan is non-trivial (architectural decision: where the `@media` block goes, what variables to override, how to tune the four traffic-light colors for dark-mode contrast) but constrained (single file modified + single test file new). One round of stateless executor work, then `/ship` from the executor's branch. No mailbox; no two-session split.

Why subagent and not single-session-switching-hats: the planner (this session) has been steeped in the v0.36.x living-docs ship arc all day. A fresh subagent context starts from the plan + binary AC alone, picks the exact hex values, and ships — matches the planner-owns-what / executor-owns-how split.

## Checkpoint (living)

- [x] Inspect `server/lib/dashboard-renderer.ts` (1335 lines read end-to-end).
- [x] Confirm tests don't grep CSS color hex values (verified — they assert markup structure only).
- [x] Commit to "Forge at Night" aesthetic direction.
- [x] Plan drafted at `.ai-workspace/plans/2026-04-26-dashboard-dark-mode.md`.
- [x] `/coherent-plan` critique pass — 5 findings (3 major, 2 minor), all fixed in-place. No critical findings.
- [ ] `/delegate --via subagent` handoff.
- [ ] Subagent: branch + edit + test + screenshot + /ship.
- [ ] PR merged on master.

Last updated: 2026-04-26 — plan drafted + /coherent-plan critique pass (5 findings, 3 major + 2 minor, all fixed in-place); awaiting /delegate handoff.
