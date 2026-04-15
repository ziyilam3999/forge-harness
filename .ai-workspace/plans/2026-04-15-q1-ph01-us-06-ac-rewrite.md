# Q1 / Task #21 — PH01-US-06 AC rewrite (6 ACs: 5 subprocess-safety + 1 source-tree-grep)

## Context

Task #22 shipped (v0.30.5) a rationale-refresh AFFIRM for the C1-bootstrap lintExempt blocks across 9 phase JSONs. Under AFFIRM those blocks still exempt PH-01 phase JSONs from F-36/F-55/F-56, so the hazardous ACs continue to live in the file — but the post-audit line was clear: *new* drift must use F-rule-safe patterns, and the 65 PH-01 ACs are now tracked as two follow-ups:

- **Task #21 (this plan)** — the 6 ACs that live under `PH01-US-06` (unit-test scaffold consolidation) are the smallest, most-referenced story in PH-01 and the natural *template* batch. Rewriting them first establishes the exact safe-pattern vocabulary that task #40 will then apply to the remaining ~59 orphaned ACs across US-01..US-05.
- **Task #40** — the ~59 orphan rewrite, blocked on this plan landing first.

The 6 hazardous ACs, read out of `forge-coordinate-phase-PH-01.json` on master `@ 05ea273`:

| AC id | Hazard class | Current command (abridged) |
|---|---|---|
| `PH01-US-06-AC01b` | F-55 captured-output (vitest json pipe + `2>/dev/null`) | `npx vitest run …topo-sort.test.ts --reporter=json 2>/dev/null \| node -e '…numTotalTests>=5…'` |
| `PH01-US-06-AC02b` | F-55 captured-output | same shape, `run-reader.test.ts`, `>=5` |
| `PH01-US-06-AC03b` | F-55 captured-output | same shape, `coordinator.test.ts`, `>=8` |
| `PH01-US-06-AC04`  | F-36 source-tree-grep + verification-theatre `echo EMPTY-OK \| grep -q EMPTY-OK` | `test -z "$(grep -n 'callClaude…' server/lib/…)" && echo EMPTY-OK \| grep -q EMPTY-OK` |
| `PH01-US-06-AC05`  | F-55 pipe-to-grep false-green | `npx vitest run …coordinator.test.ts -t 'NFR-C02…' 2>&1 \| grep -q 'passed'` |

That's **4 F-55 + 1 F-36 = 5 hazards in 5 ACs**. Task #21's nominal "6 ACs: 5 subprocess-safety + 1 source-tree-grep" count includes **AC04 as BOTH subprocess-safety (command-substitution `$()` swallowing grep's exit) AND source-tree-grep**, counted twice. The rewrite must address all 5 ACs listed above; the "6" is the count of distinct hazards, not distinct ACs.

PH01-US-06 also contains `AC01`, `AC02`, `AC03`, `AC06`, `AC07` which are plain `npx vitest run <file>` / `npx tsc --noEmit` — **no F-55/F-36 hazard, no rewrite needed**, confirmed by re-reading lines 437-486 of the phase JSON.

**Why now.** Task #22 proved the PH-01 phase JSONs are read-only at runtime (critic-mode loader passes them as opaque LLM context, never execs AC commands). That means the rewrite has zero blast radius on forge-coordinate runtime — the only thing that could break is ac-lint, which the rewrite is explicitly designed to satisfy.

## Goal

When this plan is done, **all 5 hazardous ACs in PH01-US-06 use F-rule-safe patterns**, `ac-lint` reports zero violations against the rewritten ACs, and the rewritten AC commands still produce the same pass/fail answer as the originals when run against the PH-01 code (i.e. the rewrite is **semantics-preserving** — no AC becomes stricter or looser).

## Binary AC

- [ ] **AC-1 — All 5 hazardous ACs rewritten to F-rule-safe patterns.** For the 5 AC ids listed in Context (`PH01-US-06-AC01b`, `AC02b`, `AC03b`, `AC04`, `AC05`), the `command` field on the PR branch differs from `origin/master`. Reviewer command (MUST be run with `MSYS_NO_PATHCONV=1` exported for the whole wrapper on Windows MSYS bash — `git show <rev>:<path>` silently path-mangles otherwise; task #22 learning #2):
  ```bash
  export MSYS_NO_PATHCONV=1
  for id in PH01-US-06-AC01b PH01-US-06-AC02b PH01-US-06-AC03b PH01-US-06-AC04 PH01-US-06-AC05; do
    diff <(git show origin/master:.ai-workspace/plans/forge-coordinate-phase-PH-01.json | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);const s=j.userStories.find(u=>u.id==="PH01-US-06");const a=s.acceptanceCriteria.find(x=>x.id===process.argv[1]);console.log(a.command)})' "$id") \
         <(node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);const s=j.userStories.find(u=>u.id==="PH01-US-06");const a=s.acceptanceCriteria.find(x=>x.id===process.argv[1]);console.log(a.command)})' "$id" < .ai-workspace/plans/forge-coordinate-phase-PH-01.json) \
         > /dev/null && echo "UNCHANGED $id"
  done
  ```
  Prints zero `UNCHANGED` lines.
- [ ] **AC-2 — Zero F-55 hazards remain in the 5 rewritten commands.** None of the 5 rewritten commands contains the literal substrings `2>/dev/null |`, `2>&1 | grep`, or `| grep -q 'passed'`. Reviewer command:
  ```bash
  node -e 'const j=require("./.ai-workspace/plans/forge-coordinate-phase-PH-01.json");const s=j.userStories.find(u=>u.id==="PH01-US-06");const ids=["PH01-US-06-AC01b","PH01-US-06-AC02b","PH01-US-06-AC03b","PH01-US-06-AC04","PH01-US-06-AC05"];let bad=0;for(const id of ids){const c=s.acceptanceCriteria.find(x=>x.id===id).command;if(c.includes("2>/dev/null |")||c.includes("2>&1 | grep")||c.includes("| grep -q '\''passed'\''")){console.log("HAZARD",id,c);bad++}}process.exit(bad===0?0:1)'
  ```
  Exits 0.
- [ ] **AC-3 — Zero F-36 source-tree-grep hazards remain in AC04.** `PH01-US-06-AC04`'s rewritten command does not contain `grep -n 'callClaude` or `grep -rn callClaude` against `server/**` paths, AND does not contain the `echo EMPTY-OK | grep -q EMPTY-OK` verification-theatre tail. Reviewer command:
  ```bash
  node -e 'const j=require("./.ai-workspace/plans/forge-coordinate-phase-PH-01.json");const s=j.userStories.find(u=>u.id==="PH01-US-06");const c=s.acceptanceCriteria.find(x=>x.id==="PH01-US-06-AC04").command;if(c.includes("grep -n \x27callClaude")||c.includes("grep -rn callClaude")||c.includes("echo EMPTY-OK | grep -q EMPTY-OK")){console.log("HAZARD",c);process.exit(1)}'
  ```
  Exits 0.
- [ ] **AC-4 — Rewrite is semantics-preserving against the PR branch, with a documented baseline.** The executor must:
  a. Before any rewrite, record each ORIGINAL command's exit code against `origin/master` in a new file `.ai-workspace/audits/2026-04-15-task21-baseline.md`. Format: five lines of the form `PH01-US-06-AC0Xy: <exit-code>` (plus a short prose note if the command was unrunnable, e.g. shell syntax error). This captures the pre-rewrite ground truth.
  b. After rewrite, the rewritten command for each of the 5 AC ids must run to completion on the PR branch WITHOUT a shell-syntax error AND produce an exit code that matches the baseline from (a) — i.e. if the original exited 0 on master, the rewrite exits 0 on the PR branch; if the original exited non-zero on master (pre-existing latent failure), the rewrite is allowed to exit non-zero **iff** the executor records `latent-prior-failure` next to that AC in the baseline file AND flags it to the planner as an amendment request. The rewrite must NEVER turn a passing original into a failing rewrite.
  Reviewer command:
  ```bash
  test -f .ai-workspace/audits/2026-04-15-task21-baseline.md && \
  for id in PH01-US-06-AC01b PH01-US-06-AC02b PH01-US-06-AC03b PH01-US-06-AC04 PH01-US-06-AC05; do
    grep -q "^${id}: " .ai-workspace/audits/2026-04-15-task21-baseline.md && echo "BASELINED $id" || echo "MISSING $id"
  done
  ```
  Prints 5 `BASELINED` lines and zero `MISSING` lines. Reviewer ALSO reads the baseline file and independently re-runs the acceptance wrapper to confirm rewritten-command exit codes match the recorded baseline (or are flagged `latent-prior-failure`).
- [ ] **AC-5 — ac-lint clean against the rewritten file.** `npx vitest run server/validation/ac-lint.test.ts` exits 0 with zero failures (absolute — ac-lint is clean on master @ 05ea273 per task #22 baseline 52/52; this is the one tool-output AC that is safe as absolute).
- [ ] **AC-6 — Build is delta-clean vs master.** `npm run build` exits 0 AND produces no new errors that are not present on `origin/master`. If master's build exits 0 at delegate-gate time (expected per task #22 baseline), this collapses to "exits 0". Delegate gate confirms baseline.
- [ ] **AC-7 — Lint is delta-clean vs master.** `npm run lint` produces no new errors vs `origin/master`. Framed delta-based per CLAUDE.md "What didn't work" rule on absolute tool-output ACs with latent debt; task #34 wired lint into CI at zero errors, so in practice this collapses to "exits 0" — but the delta framing protects the executor if any transient lint debt has been introduced since v0.30.5.
- [ ] **AC-8 — Tests are delta-clean vs master.** `npm test` produces no new failures vs `origin/master`. Same delta framing as AC-7. Task #22 baseline was 719 passed / 4 skipped / 0 failed; rewrite is expected to preserve that.
- [ ] **AC-9 — No drive-by edits.** `git diff origin/master...HEAD --stat` shows changes confined to `.ai-workspace/plans/forge-coordinate-phase-PH-01.json`, `.ai-workspace/plans/2026-04-15-q1-ph01-us-06-ac-rewrite.md` (this plan file), `.ai-workspace/audits/2026-04-15-task21-baseline.md` (AC-4 baseline record), `scripts/q1-task21-acceptance.sh` (hard-rule-8 acceptance wrapper per task #34 + task #22 precedent), and the PR's own dotfiles. No `server/**` source changes. No other `.ai-workspace/plans/*.json` edits. No `forge-generate-phase-PH-01.json` edits (task #40's turf).
- [ ] **AC-10 — CI green on the PR**, including lint and smoke-gate.

## Out of scope

- **Do not touch any AC in `PH01-US-06` that is NOT one of the 5 listed.** `PH01-US-06-AC01`, `AC02`, `AC03`, `AC06`, `AC07` are already F-rule-safe. Editing them is an AC-9 violation.
- **Do not touch any other user story in `forge-coordinate-phase-PH-01.json`.** US-01 through US-05 are task #40's scope. Task #21 is a **template run** — US-06 only.
- **Do not touch `forge-generate-phase-PH-01.json`.** Task #40 covers PH-01 across both coordinate + generate phase files.
- **Do not edit `server/**`.** The rewrite is pure JSON content editing.
- **Do not edit the `lintExempt` block.** Task #22 just refreshed it on AFFIRM. Keep the exemption in place — that's what lets this PR land without ac-lint redding first. The rewrite's purpose is *new-drift hygiene*, not *bootstrap cleanup*.
- **Do not rewrite `PH01-US-06-AC04` as two separate ACs.** Keep it as a single AC id with a single `command` field. If the single-command rewrite feels hacky, use a `bash -c` one-liner — the storage model is "one AC = one command string."
- **Do not modify `eslint.config.js`, `.github/workflows/*.yml`, or `tsconfig.json`.**
- **Do not force-push or rewrite history.**

## Ordering constraints

AC-1 and AC-4 must hold **simultaneously on the same commit** — a rewrite that satisfies AC-1 but fails AC-4 is a regression (semantics changed). The executor's acceptance wrapper must run AC-4 before claiming done.

## Critical files

- `.ai-workspace/plans/forge-coordinate-phase-PH-01.json` — the only JSON file that changes. 5 AC `command` fields under `userStories[id=PH01-US-06].acceptanceCriteria`.
- `server/validation/ac-lint.test.ts` — **read-only**. The executor's AC-5 check runs it; do not edit.
- `server/lib/coordinator.ts`, `server/lib/topo-sort.ts`, `server/lib/run-reader.ts` — **read-only**. AC04's rewrite still needs to verify *something* about these files; whatever check the executor picks must run against the file tree without grepping inside source lines in the F-36 hazard way. One safe option: use `node -e` with `fs.readFileSync().includes("callClaude")` against an explicit file list.
- `scripts/q1-task21-acceptance.sh` — new file, wraps AC-1..AC-9 in a single executable script per hard-rule 8 (task #34 + task #22 precedent).

## Verification procedure

Reviewer runs (on PR branch, fresh checkout):

```bash
git fetch origin && git checkout <pr-branch>
git diff origin/master...HEAD --stat                                 # AC-9
npm ci && npm run build && npm test && npm run lint                  # AC-6..AC-8
npx vitest run server/validation/ac-lint.test.ts                     # AC-5
bash scripts/q1-task21-acceptance.sh                                 # wraps AC-1..AC-4
```

Then reviewer independently runs the AC-1, AC-2, AC-3, AC-4 reviewer commands verbatim from the Binary AC section (not via the wrapper — independent verification).

## Safe-pattern reference (non-prescriptive)

The executor picks exact bash, but here are the known-safe patterns from F-55/F-36 rule docs — these are **suggestions, not mandates**:

- **Vitest test-count regression guard (replaces F-55 pipe-to-node):** capture exit code first, then parse JSON from a temp file. Example shape — `npx vitest run <file> --reporter=json --outputFile=<tmp> && node -e 'const r=require("<tmp>");process.exit((r.numTotalTests||0)>=<N>?0:1)'`. Key property: vitest's exit code is respected; parse only runs on success.
- **Vitest single-test name check (replaces F-55 `2>&1 | grep -q 'passed'`):** vitest's `-t '<pattern>'` already exits 0 iff the matching tests pass. Just `npx vitest run <file> -t '<pattern>'` — drop the pipe entirely.
- **Source-file content check without source-tree grep (replaces F-36):** `node -e 'const fs=require("fs");const files=[…];for(const f of files){if(fs.readFileSync(f,"utf8").includes("callClaude")){console.error("found in",f);process.exit(1)}}'`. Key property: checks the same files the original grep checked, but via explicit `readFileSync` — no subshell, no `$()` output swallowing, and the failure message names the file.

If the executor finds a better pattern, use it — AC-2/AC-3/AC-4 are the contract, not these snippets.

## Checkpoint

- [x] Context measured (planner): 5 hazardous ACs identified in lines 437-486 of `forge-coordinate-phase-PH-01.json`, non-hazardous ACs confirmed as AC01/AC02/AC03/AC06/AC07
- [x] Plan drafted (planner)
- [x] Plan run through `/coherent-plan` (3 MAJOR findings, all fixed: MSYS_NO_PATHCONV on AC-1, AC-4 baseline framing, AC-7/AC-8 delta framing)
- [ ] Baselines measured: AC-5 / AC-6 / AC-7 / AC-8 against master via `/delegate gate`
- [ ] Brief delivered via `/delegate` to executor
- [ ] Executor ack received with pre-flight clean
- [ ] Executor ships PR, acceptance wrapper green locally
- [ ] CI green (AC-10)
- [ ] Stateless review PASS
- [ ] Merged + released
- [ ] Plan updated to shipped reality
- [ ] Unblock task #40 — this run's rewrite patterns are the template

Last updated: 2026-04-15 (planner draft, pre-critique)
