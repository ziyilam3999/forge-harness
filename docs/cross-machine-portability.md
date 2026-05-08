# Cross-machine state portability

forge-harness keeps its working state in a `.forge/` directory at the project root. That directory is gitignored on most consumer projects, so when an operator moves between machines (e.g. Windows desktop to macOS laptop) they end up hand-copying state. This guide classifies each artifact so you copy what's portable and skip what isn't.

## Per-artifact classification

| Path | Class | Notes |
|---|---|---|
| `.forge/runs/*.json` | **Portable** | Historical run records (one per `forge_*` invocation). Machine-agnostic JSON; safe to copy verbatim. Preserves history continuity (`forge_status` enumerates these). |
| `.forge/audit/*.jsonl` | **Portable** | Append-only decision trail. Machine-agnostic; safe to copy verbatim. |
| `.forge/coordinate-brief.json` | **Portable** | Phase brief written by `forge_coordinate`. Machine-agnostic; copy if you want the next coordinate call to resume from prior state. |
| `.forge/staging/adr/*` | **Portable but transient** | Staging ADRs awaiting canonicalization. Safe to copy, but the next PASS evaluate clears them as part of canonicalization. Copy only if you have an in-flight ADR mid-migration. |
| `.forge/dashboard.html` | **Regenerable** | Rendered HTML output. Either copy (cosmetic continuity) or skip and let the next forge call regenerate it. Either choice is correct. |
| `.forge/.dashboard-opened` | **NOT portable** | Host-specific marker that suppresses the dashboard auto-open after first view. Copying it across machines makes the new host think the dashboard was already opened locally, suppressing the auto-open on first use there. Skip — it regenerates per-host on the next dashboard event. |
| `.forge/activity.json` | **NOT portable** | Process-scoped activity state. The next `forge_*` call on the new host overwrites it anyway, so copying is wasted work and risks stale-state confusion. Skip. |

## Recommended migration recipe

When migrating `.forge/` from machine A to machine B:

- Copy `.forge/runs/`, `.forge/audit/`, `.forge/staging/`, and `.forge/coordinate-brief.json` if you want history + in-flight state continuity.
- Skip `.forge/.dashboard-opened` and `.forge/activity.json` — both regenerate per-host on next use.
- `.forge/dashboard.html` is your call: copy for cosmetic continuity, or skip and let the next forge call rebuild it.
- After the copy, run `forge_status` on the new host. Expect to see prior runs enumerated correctly and recent activity reflected; if not, the copy is incomplete or the new host's `.forge/` permissions are wrong.

A minimal "history-only" copy is just `runs/` + `audit/` — enough for `forge_status` to show prior runs and for cairn-style retrospectives to find the trail.

## Cross-reference: F2 host-aware dashboard marker

If you accidentally copy `.forge/.dashboard-opened` across machines on a recent forge-harness version, the host-aware dashboard marker (see CHANGELOG) detects the foreign host and re-opens the dashboard once on the new machine, then rewrites the marker with the local hostname. This makes accidental copies recoverable rather than silently broken — but the safe rule above still applies: don't copy the marker, let it regenerate per-host.

## Out of scope

This document is the manual recipe. There is no `forge migrate` command and no automation script — if you want one, file an enhancement issue. Until then, the bullet list above is the supported path.
