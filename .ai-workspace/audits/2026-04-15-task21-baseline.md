# Task #21 — PH01-US-06 pre-rewrite baseline

Captured on master `@ 919e0a7` before any rewrite. Each line records the exit
code of the ORIGINAL (pre-rewrite) `command` field for the 5 hazardous ACs
under `stories[id=PH01-US-06].acceptanceCriteria` in
`.ai-workspace/plans/forge-coordinate-phase-PH-01.json`.

The rewrite is semantics-preserving (AC-4 contract): each rewritten command
must match the exit code recorded here, or be flagged `latent-prior-failure`
(none were).

Measurement procedure: each original command was executed verbatim in the
project root via MSYS bash; `$?` was captured immediately after.

PH01-US-06-AC01b: 0
PH01-US-06-AC02b: 0
PH01-US-06-AC03b: 0
PH01-US-06-AC04: 0
PH01-US-06-AC05: 0

All five originals pass on master. The rewrite must therefore produce
exit-0 for all five rewritten commands on this PR branch.
