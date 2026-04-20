---
title: "v0.33.0 PR A1 — setup-config polish"
date: 2026-04-20
owner: forge-plan (planner)
status: in-flight (delegated)
parent-triage: .ai-workspace/plans/2026-04-20-v0-33-0-polish-bundle-triage.md
closes: #306 #307 #308 #309 #311
---

## ELI5

We're polishing the setup-config script and its acceptance wrapper — the code that registers the forge MCP server into Claude Code. Five cosmetic nits that came out of the v0.32.5 `/ship` reviewer. None are bugs; the script works today. The fixes tighten error messages, add a "did we leave a mess on the host?" assertion, and kill a dead variable. Roughly 30 lines across two files, plus two plan files riding along so master has the triage record.

## Context

Parent triage plan `.ai-workspace/plans/2026-04-20-v0-33-0-polish-bundle-triage.md` grouped 20 post-release polish issues into 5 focused PRs. This is **PR A1** — smallest surface, lowest risk, deliberately picked as the warm-up.

**Baseline** (measured 2026-04-20 against HEAD `1186754`):
- `bash scripts/setup-config-acceptance.sh` — exits 0, 11 checks pass.
- `grep -r 'setup-config' .github/workflows/` — no matches. **The wrapper is a LOCAL acceptance gate, not a CI check.** ACs in this plan must not claim CI enforcement.
- `scripts/setup-config.cjs` — 158 lines. Two entry paths: primary via `claude mcp add` (line 40), fallback via direct `~/.claude.json` write (line 47).
- `scripts/setup-config-acceptance.sh` — 251 lines, 10 AC (AC-1..AC-8, AC-10; AC-9 host-pollution is referenced but not asserted — that's exactly what #308 is about).

**Issues closed by this PR:**
- **#306** — `scripts/setup-config-acceptance.sh:54` assigns `EXPECTED_DIST` but never references it. Either delete, or use it to assert `args[0] === EXPECTED_DIST` exactly.
- **#307** — `scripts/setup-config-acceptance.sh:121` concatenates `SYS32_MSYS=/c/Windows/System32` unconditionally. Guard behind OS check or declare wrapper MSYS-only at top.
- **#308** — AC-9 says "wrapper leaves no files outside scratch dir" but has no positive assertion. Add a pre/post sha256 of `~/.claude.json` on the host and fail loud if they differ.
- **#309** — `scripts/setup-config.cjs:49` prints "claude CLI was unavailable" in the fallback branch, but the fallback is also reached when the CLI is present and `claude mcp add` failed. Distinct wording for the two cases speeds up diagnosis.
- **#311** — `scripts/setup-config.cjs:146-148` silently catches parse errors on `settings.json`. A stderr note tells the user a known-stale surface wasn't inspected.

## Goal

When PR A1 closes:

1. The two files `scripts/setup-config.cjs` and `scripts/setup-config-acceptance.sh` carry the five fixes.
2. `bash scripts/setup-config-acceptance.sh` still exits 0 with **≥ 12 checks** (11 pre-existing + at least 1 new for host-pollution).
3. The triage plan and this A1 plan are both committed to master.
4. Issues #306, #307, #308, #309, #311 auto-close via the PR body's `fixes` trailer.

## Binary AC

### AC-1 — wrapper still green (regression guard)
`bash scripts/setup-config-acceptance.sh` exits 0. The passed-check count line reports `Passed: N checks` with `N ≥ 12`. Baseline is 11; #308 adds at least one.

### AC-2 — #306 dead variable gone
`EXPECTED_DIST` is either deleted entirely OR appears in a check (not just an assignment). `grep -c 'EXPECTED_DIST' scripts/setup-config-acceptance.sh` returns 0 (deleted) OR ≥ 2 (assignment + use). `== 1` fails.

### AC-3 — #307 System32 not hard-coded on non-Windows
Either the path is set inside an OS conditional, OR the wrapper header declares MSYS-only requirement. Observable via `grep -B3 '/c/Windows/System32' scripts/setup-config-acceptance.sh | grep -qE '(OSTYPE|msys|MSYS|uname|MINGW|cygwin)'` OR `head -20 scripts/setup-config-acceptance.sh | grep -qE 'MSYS|Git Bash|Windows-only'`. Either branch true = pass.

### AC-4 — #308 host-pollution asserted
Wrapper computes sha256 of the real `~/.claude.json` before and after its run (or declares the file absent in both snapshots). Observable:
- `grep -cE 'sha256.*\.claude\.json' scripts/setup-config-acceptance.sh` ≥ 2
- Wrapper output contains a new labelled check: `bash scripts/setup-config-acceptance.sh 2>&1 | grep -qiE 'host.*(unchanged|pollut|pure|untouched)'`

### AC-5 — #309 distinct fallback wording on different lines
```bash
L_MISSING=$(grep -nE 'CLI (was )?(unavailable|not (on PATH|found))|missing' scripts/setup-config.cjs | head -1 | cut -d: -f1)
L_FAILED=$(grep -nE 'CLI (was )?present.*(failed|error)|(mcp add|registration) failed' scripts/setup-config.cjs | head -1 | cut -d: -f1)
[ -n "$L_MISSING" ] && [ -n "$L_FAILED" ] && [ "$L_MISSING" != "$L_FAILED" ]
```

### AC-6 — #311 stderr note on invalid settings.json
```bash
SCRATCH=$(mktemp -d); mkdir -p "$SCRATCH/.claude"
printf '{broken json\n' > "$SCRATCH/.claude/settings.json"
HOME="$SCRATCH" USERPROFILE="$SCRATCH" node scripts/setup-config.cjs "$PWD" 2>&1 \
  | grep -qiE '(settings\.json).*(invalid|parse|malformed|not valid|JSON)'
rm -rf "$SCRATCH"
```

### AC-7 — triage plan on master (satisfied at merge)
`MSYS_NO_PATHCONV=1 git show HEAD:.ai-workspace/plans/2026-04-20-v0-33-0-polish-bundle-triage.md | grep -cE '^\| [0-9]+ \|'` ≥ 20 (verdict table has a data row per issue — header row `| # |` is deliberately not counted).

### AC-8 — this A1 plan landed on master (satisfied at merge)
`test -f .ai-workspace/plans/2026-04-20-v0-33-0-pr-a1-setup-config-polish.md`.

## Out of scope

- **Any other polish issue** from the 20-issue triage (#314-#331 land in PR A2/B/C/D).
- **Any refactor of `setup-config.cjs`'s core logic** — `tryClaudeMcpAdd`, `fallbackDirectWrite`, `emitMigrationWarnings` structure is untouched. Only stderr wording and a new `console.error` call inside the `catch` block.
- **Changing the list or count of AC in the wrapper beyond adding the host-pollution check** — AC-1..AC-8, AC-10 stay as-is.
- **`setup.sh` itself** — AC-10 of the wrapper already asserts `setup.sh` unchanged vs `origin/master`; don't touch it.
- **Deleting the stale `~/.claude/settings.json` / `~/.claude/mcp.json` files in real migrations** — current behaviour (warn, don't auto-delete) is deliberate.
- **AST-based or JSON-reporter approach** — those land in PR A2 (#315, #321, #323) and PR B (#327 is deferred).

## Ordering constraints

None internally. The five fixes touch disjoint regions. PR A1 has no ordering dependency on A2/B/C/D either.

## Critical files

- `scripts/setup-config.cjs` — #309 stderr wording (line 49), #311 parse-error stderr (line 146-148 catch). Core logic untouched.
- `scripts/setup-config-acceptance.sh` — #306 `EXPECTED_DIST` (line 54), #307 System32 guard (line 121), #308 host-pollution AC (append at end of file, before summary block).
- `.ai-workspace/plans/2026-04-20-v0-33-0-polish-bundle-triage.md` — triage plan.
- `.ai-workspace/plans/2026-04-20-v0-33-0-pr-a1-setup-config-polish.md` — this plan.

## Checkpoint

- [x] Baseline-check wrapper against master (11 checks passing)
- [x] Run `/coherent-plan` on this file
- [x] Present ELI5 to user; user approved
- [x] `/delegate` invoked
- [ ] Executor ships feature branch green
- [ ] `/ship` → stateless reviewer verifies
- [ ] Merge + auto-close #306 #307 #308 #309 #311

Last updated: 2026-04-20T06:20:00+00:00 — delegated to executor.
