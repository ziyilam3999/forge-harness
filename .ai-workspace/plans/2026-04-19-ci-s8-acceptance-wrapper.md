# Plan: CI wrapper workflow for S8 Kanban dashboard acceptance

## ELI5

The S8 dashboard has a long acceptance test (`scripts/s8-kanban-dashboard-acceptance.sh`) that verifies the Kanban view renders correctly. Today, nobody runs it automatically — it's a manual-only artifact. That's how a fixture bug slipped past the original merge in #269 and had to be caught by PR #280 a day later. This plan adds a GitHub Actions workflow that runs the wrapper on any PR touching the dashboard stack, so the same class of drift can't hide again.

## Context

- Closes forge-harness issue #284 (filed during PR #280 ship-review as an enhancement).
- The wrapper already exists and exits 0 with 15/15 AC PASS on current master (verified at shipping of PR #280).
- PR #280's post-ship summary explicitly flagged this gap as "Follow-up worth considering (not in this PR)".
- Existing workflows follow a standard pattern: `actions/checkout@v4` → `actions/setup-node@v4` (node 20, npm cache) → `npm ci --ignore-scripts` → job-specific step. Build step uses `npm run build`.
- The wrapper internally runs `npm run build` + `npm test` + `npx vitest run server/smoke/mcp-surface.test.ts` as AC-17, then drives `handleCoordinate` against a fixture and greps the rendered HTML. Self-contained; no additional setup needed beyond `npm ci`.

## Goal

Invariants when this ships:
1. Any PR touching the dashboard stack (`server/lib/{dashboard-renderer,coordinator,progress,run-record,activity}.ts` or `scripts/s8-kanban-dashboard-acceptance.sh` or the new workflow file itself) runs the acceptance wrapper as a PR check.
2. The check passes on current master and on PR #280's merge commit — no false red.
3. The check is visible in `gh pr checks <pr-number>` output for gated PRs.

## Binary AC

1. **File exists:** `.github/workflows/s8-kanban-dashboard-acceptance.yml` present after merge. Check: `test -f .github/workflows/s8-kanban-dashboard-acceptance.yml`.
2. **Path filter applied:** the workflow's `on.pull_request.paths` array contains all 7 gated paths as literal strings. Check: `grep -c 'server/lib/dashboard-renderer.ts\|server/lib/coordinator.ts\|server/lib/progress.ts\|server/lib/run-record.ts\|server/lib/activity.ts\|scripts/s8-kanban-dashboard-acceptance.sh\|.github/workflows/s8-kanban-dashboard-acceptance.yml' .github/workflows/s8-kanban-dashboard-acceptance.yml` returns ≥ 7.
3. **Wrapper invocation:** workflow contains a step that runs `bash scripts/s8-kanban-dashboard-acceptance.sh`. Check: `grep -F 'bash scripts/s8-kanban-dashboard-acceptance.sh' .github/workflows/s8-kanban-dashboard-acceptance.yml` returns non-empty.
4. **Live PR run succeeds:** `gh pr checks <plan-pr-number>` includes a line whose check name matches the new workflow with `conclusion: SUCCESS`.
5. **No CI regression:** all pre-existing checks (`build (ubuntu-latest, 20)`, `build (windows-latest, 20)`, `smoke-gate (report-only)`) still appear with `conclusion: SUCCESS` on the PR.

## Out of scope

- Making the new workflow a required check under branch protection (that's an admin action, not a code change).
- Refactoring the wrapper (e.g., skipping AC-17 redundant with ci.yml) — stays self-contained.
- Cross-platform matrix (ubuntu-only is sufficient; the wrapper's bash-ism + bash-specific node-e patterns would complicate Windows setup and ci.yml already covers Windows build health).
- Speeding up the wrapper; the full run is ~90s on ubuntu which is acceptable for a path-filtered gate.
- Adjacent issues #281/#282/#283 — they each get their own PR later.

## Ordering constraints

None. This is a single-file workflow add; no dependencies on other in-flight work.

## Verification procedure

1. `test -f .github/workflows/s8-kanban-dashboard-acceptance.yml` — exit 0.
2. `grep -c 'server/lib/dashboard-renderer.ts' .github/workflows/s8-kanban-dashboard-acceptance.yml` ≥ 1 (and repeat for the other 6 gated paths).
3. After PR opens, `gh pr checks <pr-number>` shows the new check name with `pass` conclusion. Wait up to 10 min; the wrapper runs `npm test` which takes ~25s plus build + wrapper ACs.
4. Spot-check the workflow run log via `gh run view <run-id> --log` to confirm the wrapper's own 15/15 PASS summary appears.

## Critical files

- `.github/workflows/s8-kanban-dashboard-acceptance.yml` — new workflow. Single-file change.

## Checkpoint

- [ ] Plan written + critiqued
- [ ] Workflow file authored
- [ ] Local YAML syntax sanity-check (file parses as valid YAML)
- [ ] Ship via /ship — PR opened, CI runs on the PR (the workflow runs on itself because the workflow path is self-gated)
- [ ] New check passes on the PR
- [ ] Merge + close issue #284

Last updated: 2026-04-19T13:30:00+08:00 — plan draft, queued for critique.
