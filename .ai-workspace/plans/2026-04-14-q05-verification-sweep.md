# Plan: #20 Q0.5 Verification Sweep — delegate to lucky-iris

## Intent

Forge-plan (me, the planner) is drafting this plan and a brief for lucky-iris (the implementer) to execute task #20: audit all forge-harness plan/docs files for stale or incorrect hive-mind-persist citations, and verify the one SUPERSEDED note that #20 names.

This is pure doc-hygiene. No production code is touched. No behavior changes. The deliverable is a set of citation fixes across .ai-workspace plan files, plus a short audit report.

## ELI5

Our plan files cite hive-mind "pattern IDs" like P62, P63, F55, F56, F59. Think of them like Wikipedia article IDs — if we cite the wrong one, future readers chase a dead link. Last week someone wrote a plan that cited "F59" as if it existed; it turns out F59 was never written. Every forge-harness plan that mentions F59 is now a broken link. We're asking lucky-iris to go find all those broken links and fix them.

She also needs to double-check that P62, P63, F55, F56 — which DO exist — are cited for the right reason in each place they appear. It's a short, mechanical job with a clear right/wrong answer for every citation.

## Source-of-truth facts (verified in research phase)

### Valid hive-mind-persist entries (as of 2026-04-14)

| ID | Location | What it's about |
|----|----------|-----------------|
| **P62** | `case-studies/2026-04-13-q0-plan-writeback-loop.md:154` + `knowledge-base/01-proven-patterns.md` | "Running Beats Reading" — static inspection misses execution failures. Evidence from L1a/L1b/L2/L4/L5. |
| **P63** | same case study | "Cold-Read Critique with Reductio Qualifiers" — the fix for F62 (subagent self-report confidence is uncorrelated with AC satisfaction). |
| **F55** | `knowledge-base/02-anti-patterns.md:430` | "AC Grep Regex Fails in MCP Subprocess Context (TTY-Dependent Output)" |
| **F56** | `knowledge-base/02-anti-patterns.md:438` | "AC Pipe Chain Stdin Bug Causes Infinite Hang" |

### Retracted / non-existent entry

| ID | Status |
|----|--------|
| **F59** | **DOES NOT EXIST.** Highest F entry in `02-anti-patterns.md` is F58. Retraction recorded at `proposals/cairn/2026-04-13-cairn-charter.md:502` and `2026-04-13-wholesome-self-improvement-loop.md:376`. Any forge-harness plan that cites F59 is citing a phantom. |

### SUPERSEDED note status

`.ai-workspace/plans/2026-04-10-ac-authoring-guidelines.md:3` already carries a SUPERSEDED note pointing at `2026-04-12-next-execution-plan.md §Q0.5`. **The note exists.** Task #20's "add SUPERSEDED note" item is therefore a *verify*, not a *create*. Lucky-iris's job here is to confirm wording, not to author one.

## Files in scope (from research grep)

### P62 / P63 / F59 citations (4 files)

- `.ai-workspace/plans/2026-04-12-next-execution-plan.md`
- `.ai-workspace/plans/2026-04-07-forge-coordinate-plan.md`
- `.ai-workspace/plans/2026-04-13-q05-c2-flaky-retry.md`
- `.ai-workspace/plans/2026-04-12-execution-overview.md`

### F55 / F56 citations (16 files — including 9 generated JSON phase files)

Plan docs (7 editable):
- `.ai-workspace/plans/2026-04-12-next-execution-plan.md`
- `.ai-workspace/plans/2026-04-13-q05-c1-bis-lint-exempt-plan-scope.md`
- `.ai-workspace/plans/2026-04-13-ship-review-1.md`
- `.ai-workspace/plans/2026-04-13-q05-b1-smoke-test.md`
- `.ai-workspace/plans/2026-04-11-f55-planner-validation.md`
- `.ai-workspace/audits/2026-04-12-divergence-false-negatives-diagnosis.md`
- `.ai-workspace/PROJECT-INDEX.md`

Generated artifacts (read-only — do NOT edit, only report if citations are stale):
- `forge-generate-phase-PH-01.json` … `PH-04.json`
- `forge-coordinate-phase-PH-01.json` … `PH-04.json`
- `2026-04-02-phase2-forge-plan-output.json`

### Already-verified

- `.ai-workspace/plans/2026-04-10-ac-authoring-guidelines.md` — SUPERSEDED note on line 3. Lucky-iris confirms wording matches task spec, then moves on.

## Scope boundaries

**In scope:**
- Read every listed file.
- For each P62/P63 citation: verify it names the correct pattern (Running Beats Reading / Cold-Read Critique) and matches one of the two facts in the table above. If the citation is used in a context where the pattern doesn't fit, flag it.
- For each F55/F56 citation: verify it names the correct anti-pattern (grep TTY drift / pipe-stdin hang). Flag mis-uses.
- For every F59 citation: **replace or annotate.** F59 is a phantom ID.
- Confirm `2026-04-10-ac-authoring-guidelines.md` SUPERSEDED note exists and points at the right successor plan.

**Out of scope:**
- Generated `forge-generate-phase-*.json` and `forge-coordinate-phase-*.json` artifacts. Do NOT edit these — they regenerate from primitives. Only *report* stale citations in a "generator drift" section of the audit output.
- CHANGELOG.md — only has one reference, not a plan file. Skip unless it cites F59.
- Any file not on the list above.
- Any source code under `server/`.

## Test Cases & AC (binary)

- **AC-1:** `grep -rn '\bF59\b' .ai-workspace/plans/ .ai-workspace/audits/ .ai-workspace/PROJECT-INDEX.md` returns zero matches after the sweep.
- **AC-2:** Every P62 citation in the 4 listed files, when compared against `case-studies/2026-04-13-q0-plan-writeback-loop.md:154`, describes "Running Beats Reading" or an entailed sub-pattern. Any mismatch is flagged in the audit report.
- **AC-3:** Every P63 citation describes "Cold-Read Critique" or its reductio qualifiers. Mismatches flagged.
- **AC-4:** Every F55 citation in the 7 editable files describes "AC grep regex fails in subprocess / TTY-dependent output". Mismatches flagged.
- **AC-5:** Every F56 citation in the 7 editable files describes "AC pipe chain with second grep hangs on stdin". Mismatches flagged.
- **AC-6:** `sed -n '3p' .ai-workspace/plans/2026-04-10-ac-authoring-guidelines.md` contains the literal string `SUPERSEDED 2026-04-12` and references `2026-04-12-next-execution-plan.md`. Binary: yes/no.
- **AC-7:** Audit report written to `.ai-workspace/audits/2026-04-14-q05-verification-sweep.md` with sections: `## F59 replacements`, `## P62/P63 mis-citations`, `## F55/F56 mis-citations`, `## Generator drift (read-only)`, `## SUPERSEDED note verification`. Empty sections explicitly say "none found."
- **AC-8:** `git diff --stat` after implementation touches only files on the allowlist (the 4 P62/P63/F59 files + the 7 F55/F56 plan docs + the new audit report). No server/, no generated JSON, no CHANGELOG.
- **AC-9:** No behavior change. `npm test --run` (if dev dependencies are installed) exits 0. If deps not installed, skip with explicit note — this is doc-only work, test suite is not load-bearing.

## Allowlist (files that may be edited)

1. `.ai-workspace/plans/2026-04-12-next-execution-plan.md`
2. `.ai-workspace/plans/2026-04-07-forge-coordinate-plan.md`
3. `.ai-workspace/plans/2026-04-13-q05-c2-flaky-retry.md`
4. `.ai-workspace/plans/2026-04-12-execution-overview.md`
5. `.ai-workspace/plans/2026-04-13-q05-c1-bis-lint-exempt-plan-scope.md`
6. `.ai-workspace/plans/2026-04-13-ship-review-1.md`
7. `.ai-workspace/plans/2026-04-13-q05-b1-smoke-test.md`
8. `.ai-workspace/plans/2026-04-11-f55-planner-validation.md`
9. `.ai-workspace/audits/2026-04-12-divergence-false-negatives-diagnosis.md`
10. `.ai-workspace/PROJECT-INDEX.md`
11. `.ai-workspace/audits/2026-04-14-q05-verification-sweep.md` (new, audit report)

Any edit outside this list = AC-8 failure, stop and report.

## F59 replacement guidance for lucky-iris

When you find an F59 citation, read its surrounding context to decide:

- **"Shelved infrastructure / dead code reserved for future use"** → replace with "shelved-for-future-use anti-pattern (no formal ID; see retraction at hive-mind-persist/proposals/cairn/2026-04-13-cairn-charter.md:502)". Do not invent an F number.
- **"Grep / AC subprocess / TTY"** → the author probably meant F55 or F56. Pick the closer match based on the code example nearby.
- **"Self-report confidence uncorrelated with AC satisfaction"** → the author meant F62.
- **Unclear** → leave the text in place but prefix with `<!-- STALE CITATION: F59 does not exist (retracted 2026-04-13). Original author intent unclear; flagging for human review. -->` and list it in the audit report's `## F59 replacements` section.

Never delete the sentence; always replace or annotate. Preserving the reasoning chain matters more than scrubbing the broken link.

## Checkpoint

- [x] Research: confirmed SUPERSEDED note already present on line 3 of 2026-04-10-ac-authoring-guidelines.md
- [x] Research: confirmed F59 is retracted (retraction at cairn-charter.md:502 and wholesome-self-improvement-loop.md:376)
- [x] Research: grep identified 4 files with P62/P63/F59 citations, 16 files with F55/F56 citations (7 plan docs + 9 read-only generated artifacts)
- [x] ExitPlanMode approval
- [x] Copy this plan to `.ai-workspace/plans/2026-04-14-q05-verification-sweep.md` (persistent, committed)
- [x] Send brief to lucky-iris via mailbox (reply_expected: true, SLA 1500s, thread_id q05-verification-sweep) — SHA cc3eec7, mail at 2026-04-14T2040
- [ ] Reactive-idle on the mailbox awaiting lucky-iris's completion report (wakeup armed for 21:37)
- [ ] Stateless review of lucky-iris's audit + diff (per Working Principle #7)
- [ ] Close task #20 in TaskList

Last updated: 2026-04-14T20:50:00+08:00 — brief delivered, reactive-idle awaiting lucky-iris.

---

## Brief for lucky-iris (to be sent as mailbox after ExitPlanMode approval)

**Subject:** q05-verification-sweep (#20) — doc-hygiene audit, 11 files allowlist
**Thread:** q05-verification-sweep
**Reply expected:** true, SLA 1500s
**Priority:** normal

### Body

You are picking up forge-harness task #20: a Q0.5 doc-hygiene verification sweep. Zero code changes. Zero behavior changes. Pure citation audit + fix.

**What to do (mechanical):**

1. **Verify SUPERSEDED note** — confirm line 3 of `.ai-workspace/plans/2026-04-10-ac-authoring-guidelines.md` contains `SUPERSEDED 2026-04-12` and names `2026-04-12-next-execution-plan.md` as successor. If yes, record PASS in audit report. If not, stop and report back — do not edit (that would be scope creep into authoring the note).

2. **F59 sweep** — F59 is a **phantom ID**. It does not exist in `hive-mind-persist/knowledge-base/02-anti-patterns.md` (highest F entry is F58). Retraction at `hive-mind-persist/proposals/cairn/2026-04-13-cairn-charter.md:502`. Find all F59 citations in these 4 files and replace/annotate per the guidance below:
   - `.ai-workspace/plans/2026-04-12-next-execution-plan.md`
   - `.ai-workspace/plans/2026-04-07-forge-coordinate-plan.md`
   - `.ai-workspace/plans/2026-04-13-q05-c2-flaky-retry.md`
   - `.ai-workspace/plans/2026-04-12-execution-overview.md`

   **F59 replacement rules:**
   - Context about "shelved / dead / reserved-for-future" → replace with "shelved-for-future-use anti-pattern (no formal ID; see retraction at hive-mind-persist/proposals/cairn/2026-04-13-cairn-charter.md:502)". Do NOT invent an F number.
   - Context about "grep / AC subprocess / TTY" → replace with F55 or F56 (pick closer match).
   - Context about "self-report confidence uncorrelated" → replace with F62.
   - Unclear context → prefix the line with `<!-- STALE CITATION: F59 does not exist (retracted 2026-04-13). Original author intent unclear; flagging for human review. -->` and list in audit report.

3. **P62 / P63 mis-citation check** — in the same 4 files above, read every P62 and P63 citation. Source of truth:
   - **P62** = "Running Beats Reading (Static Inspection Misses What Execution Surfaces)" — evidence from L1a/L1b/L2/L4/L5 in `case-studies/2026-04-13-q0-plan-writeback-loop.md:154`.
   - **P63** = "Cold-Read Critique with Reductio Qualifiers" — the fix for F62 (subagent self-report uncorrelated with AC satisfaction).

   If a citation is used in a context where the pattern doesn't fit (e.g., citing P62 for a test-authoring rule), flag it in the audit report under `## P62/P63 mis-citations`. Do NOT auto-correct — flagging is enough.

4. **F55 / F56 citation check** — in these 7 plan docs, read every F55/F56 citation:
   - `.ai-workspace/plans/2026-04-12-next-execution-plan.md`
   - `.ai-workspace/plans/2026-04-13-q05-c1-bis-lint-exempt-plan-scope.md`
   - `.ai-workspace/plans/2026-04-13-ship-review-1.md`
   - `.ai-workspace/plans/2026-04-13-q05-b1-smoke-test.md`
   - `.ai-workspace/plans/2026-04-11-f55-planner-validation.md`
   - `.ai-workspace/audits/2026-04-12-divergence-false-negatives-diagnosis.md`
   - `.ai-workspace/PROJECT-INDEX.md`

   Source of truth:
   - **F55** (`hive-mind-persist/knowledge-base/02-anti-patterns.md:430`) = "AC Grep Regex Fails in MCP Subprocess Context (TTY-Dependent Output)" — grep patterns break because vitest formats differently without a TTY.
   - **F56** (`hive-mind-persist/knowledge-base/02-anti-patterns.md:438`) = "AC Pipe Chain Stdin Bug Causes Infinite Hang" — second grep in `cmd | grep -q X && ! grep -q Y` has no stdin and hangs.

   Flag any mis-citation in `## F55/F56 mis-citations`. Do NOT auto-correct.

5. **Generator drift report** — these 9 files are read-only (they regenerate from primitives). Do NOT edit them. Just grep them for P62/P63/F55/F56/F59 and report any stale citations in `## Generator drift (read-only)` section so we know to re-run the generator later:
   - `forge-generate-phase-PH-01.json` … `PH-04.json`
   - `forge-coordinate-phase-PH-01.json` … `PH-04.json`
   - `2026-04-02-phase2-forge-plan-output.json`

6. **Write audit report** to `.ai-workspace/audits/2026-04-14-q05-verification-sweep.md` with these sections (empty sections explicitly say "none found"):
   - `## F59 replacements` — each entry: `{file}:{line} — old text → new text`
   - `## P62/P63 mis-citations` — each entry: `{file}:{line} — citation text — why it doesn't fit`
   - `## F55/F56 mis-citations` — same format
   - `## Generator drift (read-only)` — each entry: `{file}:{line} — stale citation — suggested regenerate`
   - `## SUPERSEDED note verification` — PASS/FAIL with line 3 content

**Allowlist (any file edit outside this list = failure, stop and ask):**

11 files total: the 4 P62/P63/F59 plan files + the 7 F55/F56 plan docs + the new audit report at `.ai-workspace/audits/2026-04-14-q05-verification-sweep.md`.

**Binary acceptance (all must pass):**

- AC-1: `grep -rn '\bF59\b' .ai-workspace/plans/ .ai-workspace/audits/ .ai-workspace/PROJECT-INDEX.md` returns zero matches (after sweep).
- AC-2..5: P62/P63/F55/F56 mis-citations all flagged in audit report (0 auto-corrections).
- AC-6: SUPERSEDED note verification = PASS.
- AC-7: audit report exists with all 5 required sections.
- AC-8: `git diff --stat` touches only allowlist files.
- AC-9: no code changes. `npm test --run` still exits 0 if deps are installed (skip with note if not).

**Cite-don't-recall:** every finding in the audit report must include `{file}:{line}` references. If you can't cite, say "did not verify". Do NOT trust memory of prior session context.

**Stop conditions** (report back instead of pushing through):

- SUPERSEDED note missing or wrong
- An F59 citation whose context is genuinely unclear (prefix with the STALE CITATION comment, flag in report, don't block on it)
- Any proposed edit would touch a file outside the allowlist
- Any generator-drift entry you think requires a code-side regen rather than a citation fix

**Reply format:**

Mailbox reply on thread `q05-verification-sweep`, `reply_to:` this mail's filename. Include:
- One-line verdict: `PASS` / `PASS with flags` / `BLOCK`
- Audit report path (committed or uncommitted)
- Counts: `N F59 replacements, M mis-citations flagged, K generator-drift entries`
- `git diff --stat` output
- Any stop-condition triggers

Forge-plan will stateless-review your report + diff before closing task #20.

— forge-plan
