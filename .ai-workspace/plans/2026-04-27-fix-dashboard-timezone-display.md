# Fix dashboard timestamps to render in viewer-local timezone

## ELI5

The dashboard's activity feed shows timestamps in a clock that lives in London (UTC), but the user's laptop clock is 8 hours ahead. So the dashboard says "2:54 AM" when the user's actual clock says "10:54 AM" — confusing. We're going to teach the page to translate those London times into whatever timezone the viewer actually lives in, so the numbers match the wall clock the user is staring at. We do this in the *browser*, not on the server, so two viewers in different timezones can each see their own correct time without us having to know which timezone the server is in.

## Context

`server/lib/dashboard-renderer.ts:449-462` defines `formatTimeOfDay(iso)` which renders ISO timestamps as `YYYY-MM-DD HH:MM:SS` using `getUTC*` getters. This was a deliberate choice in v0.35.1 (AC-5) to keep server-side HTML deterministic — the existing `dashboard-renderer-polish.test.ts` AC-5 test (`/2026-04-20.{0,200}13:10:43/`) and `dashboard-renderer.test.ts` AC-08 test both assert the literal UTC tokens in the rendered HTML, which only holds if `getUTC*` is used.

The trade-off: human viewers see UTC regardless of where they live. Reporter is at UTC+8 — every audit-feed row reads 8 hours behind their wall clock. Screenshot evidence: `forge_generate` row shows `02:54:21` while the laptop's clock reads `10:54 AM`.

Two approaches:
- **(A) Replace `getUTC*` with `get*` (server-side local).** Smaller diff but breaks both tests on any non-UTC CI runner. Also brittle — server's TZ ≠ viewer's TZ in any deployment that isn't single-machine.
- **(B) Server emits UTC, browser converts via `data-iso` attribute + inline `<script>`.** Server-side HTML stays deterministic (tests pass with a tiny regex tweak that doesn't change the *content* assertion); each viewer sees their own local time on their own browser. Hover reveals the original UTC for cross-machine comparison.

Choosing (B). It's the same pattern GitHub, Slack, etc. use for activity feeds.

## Goal (invariants that must hold when done)

- **G1.** Activity feed timestamps render in the viewer's browser-local timezone.
- **G2.** Server-side rendered HTML still contains the UTC `YYYY-MM-DD HH:MM:SS` tokens — preserves test determinism on any CI runner regardless of its TZ.
- **G3.** A user can recover the original UTC value from a feed row (tooltip via `title` attribute) so cross-machine debugging stays possible.
- **G4.** No new dependencies. No `Intl.DateTimeFormat` reliance — Date.prototype's no-prefix getters return local time and are universally supported.
- **G5.** Full test suite stays green (only the two regexes that asserted on `<span class="feed-time">` shape are widened to allow extra attributes).

## Binary AC

- **AC-1.** `<span class="feed-time">` tags emitted by `renderFeed` carry a `data-iso="<raw-iso>"` attribute. Reviewer command: `grep -c 'class="feed-time" data-iso=' dist/lib/dashboard-renderer.js` returns ≥1.
- **AC-2.** The dashboard HTML contains an inline `<script>` block that selects `[data-iso]` and rewrites text content using local-time `Date` getters. Reviewer command: `grep -c 'data-iso' dist/lib/dashboard-renderer.js` returns ≥2 (one for the attribute write, one for the script's selector).
- **AC-3.** Server-rendered HTML still contains UTC tokens for the existing fixture timestamps. Existing tests `dashboard-renderer-polish.test.ts:AC-5` and `dashboard-renderer.test.ts:AC-08` pass without changing their content assertions (only the regex outer shape is updated to `<span class="feed-time"[^>]*>` to allow extra attributes).
- **AC-4.** Tooltip preserves UTC: each `[data-iso]` element has `title="UTC: <iso>"` after the script runs. Verifiable in DevTools after page load.
- **AC-5.** `npm test` exits 0 (full suite green; the previously flaky `run-record.test.ts:112` is a pre-existing concurrency flake unrelated to this change — passes 12/12 in isolation).

## Out of scope

- Localizing other timestamps (header `renderedAt`, story freshness chips, etc.). The audit feed is the user-reported issue; other surfaces stay UTC for this PR.
- Adding a TZ selector or user-preference store. Browser-local is sufficient.
- Switching to `Intl.DateTimeFormat`. The `pad`-and-concatenate approach has zero locale ambiguity and matches the server's format byte-for-byte.
- Touching activity.json schema or any storage format.

## Verification procedure

1. `npx vitest run server/lib/dashboard-renderer.test.ts server/lib/dashboard-renderer-polish.test.ts` → 47/47 pass.
2. `npm test` → exits 0 (modulo the pre-existing run-record concurrency flake noted above; it passes in isolation).
3. `npm run build` → exits 0; `dist/lib/dashboard-renderer.js` contains both `data-iso=` and `Localize feed timestamps`.
4. After session restart + a forge_* tool call to trigger a render: open the dashboard, confirm a row that was `02:54:21` now reads `10:54:21` (UTC+8 viewer), hover the row to confirm tooltip shows `UTC: 2026-04-27T02:54:21.xxxZ`.

## Critical files

- `server/lib/dashboard-renderer.ts` — adds `data-iso=` attribute to feed-time span (line 867); injects inline script before `</body>` (line 1109); updates `formatTimeOfDay` doc to reflect the new architecture.
- `server/lib/dashboard-renderer-polish.test.ts` — widens AC-5 regex from `<span class="feed-time">` to `<span class="feed-time"[^>]*>` so it tolerates the new attribute. Content assertion unchanged.
- `server/lib/dashboard-renderer.test.ts` — same widening for the AC-08 ordering regex.

## Checkpoint

- [x] Cause located: `formatTimeOfDay` uses `getUTC*` deliberately for test determinism (line 449-462).
- [x] Approach picked: browser-side conversion via `data-iso` + inline `<script>`.
- [x] Source edited (3 files).
- [x] Renderer suites green (47/47).
- [x] Full suite measured (965/970 + 4 skipped + 1 pre-existing flake confirmed unrelated).
- [x] Dist rebuilt; both markers present.
- [ ] /ship pipeline (this turn).

Last updated: 2026-04-27.
