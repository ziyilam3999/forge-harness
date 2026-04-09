# forge_coordinate S3 Dogfood Findings (running log)

**Purpose:** Rolling capture of dogfood findings discovered while implementing PH-01 stories using `forge_generate`. Each finding is a concrete, actionable gap or wart in the brief-assembly / spec-accuracy / implementation-plan chain. The final dogfood report at S3 ship time (`forge-coordinate-dogfood-report.md`) rolls these up with per-story brief quality scores and wall-clock timing.

**Rule of the log:** Every finding must have WHAT, WHERE FOUND, WHY IT MATTERS, FIX PROPOSAL, and SOURCE (which story / which brief call surfaced it). No vague "brief was ok" entries — those go in the per-story brief-quality scoreboard at the bottom, not here.

---

## Findings

### F-01 — `codebaseContext` is 90% noise from `.claude/worktrees/*`

- **Story surfaced in:** PH01-US-00a (iteration 0)
- **Severity:** brief-quality (high — eats context budget)
- **What:** `forge_generate`'s returned `brief.codebaseContext` devotes the first ~3500 of ~4900 brief tokens to listing 7 `.claude/worktrees/*` subdirectories (ritchie, wescoff, elion, dhawan, raman, wright, festive) line-by-line before reaching the real `server/` tree. Each worktree repeats the same `.github/`, `docs/`, `schema/`, `scripts/`, `server/` subtree structure.
- **Why it matters:** Worktrees are scratch directories from prior `/ship` runs — they contain stale copies of the repo that are never relevant to the brief's target story. The noise (a) wastes ~70% of the brief's codebase-context budget, (b) pushes the actual signal (real `server/` tree) below the scan's truncation line, and (c) inflates prompt tokens on downstream consumers that feed the brief into another LLM. The `[truncated]` marker at the end of my PH01-US-00a brief confirms the real tree was cut short.
- **Fix proposal:** `server/lib/codebase-scan.ts` should add `.claude/worktrees/` (and probably also `dist/`, `node_modules/`, `.git/`, `.ai-workspace/`) to its ignore list. This is a one-line fix in the directory walker's prune list, plus a unit test asserting that a fixture repo with a `.claude/worktrees/stale/` subdir produces a scan output that does not contain the worktree path.
- **Source:** `forge_generate({storyId: "PH01-US-00a", projectPath: ".../forge-harness", iteration: 0})` — returned brief's `codebaseContext` field, first ~3500 tokens.

---

### F-02 — Brief reproduces phase-plan story text but omits reference-pattern code

- **Story surfaced in:** PH01-US-00a (iteration 0)
- **Severity:** brief-quality (medium — forces implementer to read source anyway)
- **What:** The brief correctly copies the story's `description`, `acceptanceCriteria`, and `affectedPaths` from the phase plan, but does NOT extract the reference-pattern code the story description explicitly points at. The PH01-US-00a description says "matching the handleCoherenceEval pattern at server/tools/evaluate.ts lines 226" — but the brief does not include those lines. Nor does it include the current `RunRecord` interface body, the current `handleStoryEval` body, or the `RunContext` constructor signature. The implementer has to read 4+ source files to discover *how* to do the work the brief tells them to do.
- **Why it matters:** The dogfood directive says "Implement ONLY from the brief — do not re-read the phase plan or PRD mid-story." The brief is self-sufficient for *what* (story goal, AC list) but not for *how* (reference pattern code, target file shapes). This forces implementers to either (a) read target source files anyway (technically permitted — the directive only bans re-reading upstream *docs*) or (b) fabricate plausible-looking code from memory, which is exactly what the brief-first discipline is supposed to prevent. The gap undermines the S7 divergence measurement because implementers are silently supplementing with out-of-brief knowledge.
- **Fix proposal:** Extend `forge_generate` brief assembly to include a `referencePatterns` section when the story description contains file:line references (e.g., regex `\S+\.ts:\d+` or `at <path> line \d+`). Extract the referenced function body (or ±20 lines around the pointer) into the brief. This is a new brief field, not a codebase-context expansion — keep it scoped. Alternatively: extend brief assembly to include the full contents of every file listed in `affectedPaths` when the story is in "extend existing" mode (identifiable by description keywords like "extend", "add to", "matching the X pattern").
- **Source:** `forge_generate({storyId: "PH01-US-00a", ...})` brief's `story.description` (references `server/tools/evaluate.ts lines 150-166` and `line 226`) combined with the absence of those line ranges in the brief's `codebaseContext`.

---

### F-03 — PRD/phase-plan reference `EvalReport.findings` / `failedAcId` that do not exist in the code

- **Story surfaced in:** PH01-US-00a
- **Severity:** spec-accuracy (high — silent spec-vs-code drift)
- **What:** Both `docs/forge-coordinate-prd.md` (REQ-01 "Deterministic serialization AC") and `.ai-workspace/plans/forge-coordinate-phase-PH-01.json` (PH01-US-00a description) repeatedly reference `EvalReport.findings` sorted by `(failedAcId, description)`. The actual `server/types/eval-report.ts` defines:
    ```ts
    interface EvalReport {
      storyId: string;
      verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
      criteria: CriterionResult[];
      warnings?: string[];
    }
    interface CriterionResult {
      id: string;
      status: "PASS" | "FAIL" | "SKIPPED" | "INCONCLUSIVE";
      evidence: string;
    }
    ```
  There is no `findings` array, no `failedAcId` field, and no `description` field. The direct analog is `criteria[].id` and `criteria[].evidence`.
- **Why it matters:** An implementer following the brief literally would fabricate a `findings` field and a `failedAcId` attribute, neither of which compiles. The PH-01 plan's AC list does not catch this because its ACs are all grep-based on `run-record.ts` interface declarations (not on `eval-report.ts` field shapes). Silent drift between spec vocabulary and type definitions is a classic way for plan-first workflows to produce code that *looks* spec-compliant but references nonexistent fields. This is the exact kind of wart the dogfood loop is supposed to surface.
- **Fix proposal:** (a) Update PRD REQ-01 and phase-plan PH01-US-00a description to reference `EvalReport.criteria` (the actual field name) sorted by `(id, evidence)`. Also update REQ-01's "Storage/performance note" which references "~50 findings × ~200 bytes each" — should say "~50 criteria × ~200 bytes each". (b) Add a coherence-mode `forge_evaluate` check that greps for spec vocabulary against the current type definitions — any REQ that mentions a field name not present in any TypeScript interface under `server/types/` should fail coherence. This is P31-ish (mechanical consistency check). (c) For this implementation: I'm proceeding with `criteria` as the canonicalization target, noting the deviation in my S3 reply contract item 5 as an interview surprise.
- **Source:** Cross-reference between `docs/forge-coordinate-prd.md:70-71` (REQ-01 deterministic serialization AC, Storage/performance note) and `server/types/eval-report.ts` (actual type).

---

### F-05 — `forge_evaluate` story mode is broken on Windows (`spawn bash ENOENT`)

- **Story surfaced in:** PH01-US-00a (verification step)
- **Severity:** CRITICAL — story-mode verification is unusable on the primary author's dev environment
- **What:** Calling `mcp__forge__forge_evaluate({evaluationMode: "story", storyId: "PH01-US-00a", planPath: "...forge-coordinate-phase-PH-01.json"})` returned `verdict: "INCONCLUSIVE"` on ALL 10 ACs, every one with the identical evidence `"Command execution failed: spawn bash ENOENT"`. The ACs themselves are correct (I verified every single one manually via the harness's Bash tool: grep hits land on lines 20-32 of `run-record.ts`, `tsc --noEmit` is clean, `vitest run` passes 35/35 evaluate tests and 390/390 full suite). The tool simply cannot execute ANY shell command on Windows.
- **Root cause (hypothesis):** `server/lib/executor.ts` (or wherever story-mode AC commands are dispatched) is calling `child_process.spawn("bash", ["-c", command], ...)` without `shell: true` and without resolving `bash` to its absolute path. On Windows, `spawn` with a bare executable name does not consult PATH the way a Unix shell does — it tries the exact name as a file in the current directory first, then uses a restricted lookup, and fails with ENOENT even when Git Bash is installed at `C:\Program Files\Git\bin\bash.exe` and fully resolvable via `which bash` in any Git Bash prompt.
- **Why it matters:**
    1. **NFR-C05 "Windows compatibility" is false in practice** for `forge_evaluate` story mode. The PRD explicitly lists `windows-latest` in CI and the primary author's dev env IS Windows 11 / Git Bash (MINGW64). The PRD's own shell-portability note even acknowledges the Windows env. Yet the tool that executes every AC command cannot spawn a shell there.
    2. **The entire dogfood loop for S3 is degraded.** The S3 prompt prescribes `forge_evaluate` as the verdict source for every story: "If verdict: PASS → commit. If verdict: FAIL or INCONCLUSIVE → call forge_generate again with eval report for fix guidance." With every story returning INCONCLUSIVE regardless of actual correctness, the loop is noise — the implementer MUST fall back to manually running AC commands themselves, which defeats the "prove don't claim" design intent.
    3. **`forge_generate` retry loop would misfire.** A post-PH-01 coordinator running in advisory mode would see the INCONCLUSIVE verdict, count it toward `retryCount` per REQ-04 v1.1 ("Retry counter includes INCONCLUSIVE"), and exhaust all 3 retries on a story that is actually passing — producing a phantom `failed` classification and a spurious `needs-replan` escalation. This is exactly the "flaky eval" scenario §7 out-of-scope table identifies as a known limitation, but it is in fact a Windows-universal bug, not a flake.
- **Fix proposal:** Audit the story-mode command executor (likely `server/lib/executor.ts` or `server/lib/evaluator.ts`). Change the spawn pattern to one of:
    - `spawn("bash", [...], { shell: true })` — simplest, lets the OS resolve the shell
    - Or resolve `bash.exe` at startup via a `which`-like lookup (e.g. check `C:\Program Files\Git\bin\bash.exe`, `C:\Program Files (x86)\Git\bin\bash.exe`, `$MSYS_ROOT\usr\bin\bash.exe`, `wslpath` fallback) and cache the absolute path
    - Or detect Windows at startup and fall back to `cmd.exe /c` + PowerShell for non-bash commands; this is more invasive because the AC commands use bash-specific syntax (`\|` alternation, `2>/dev/null`, `test -z "$(...)"`).
    Add a Windows-matrix CI test in `.github/workflows/ci.yml` that invokes `forge_evaluate` in story mode on a fixture plan with at least one `grep`-based AC and asserts the verdict is NOT INCONCLUSIVE with `spawn bash ENOENT`. This is the missing integration test that would have caught F-05 at ship time.
- **Verification workaround for PH01-US-00a:** I verified every AC manually by running each command via the harness Bash tool (see the batched grep check at commit time). All 10 ACs pass. The implementation itself is correct; the tool tasked with verifying it is broken.
- **Source:** `mcp__forge__forge_evaluate({evaluationMode: "story", storyId: "PH01-US-00a", planPath: ".../forge-coordinate-phase-PH-01.json"})` returned all 10 criteria as `INCONCLUSIVE` with evidence `"Command execution failed: spawn bash ENOENT"` on Windows 11 / Git Bash MINGW64.

---

### F-04 — PRD says `writeRunRecord` must canonicalize, but test infrastructure mocks `writeRunRecord` fully

- **Story surfaced in:** PH01-US-00a
- **Severity:** design trade-off (low — workable, but an inconsistency)
- **What:** REQ-01 wording: "If the existing `EvalReport` type does not guarantee stable internal ordering, `writeRunRecord` is responsible for canonicalizing before serialization." This places the canonicalization inside `writeRunRecord` itself. However, `server/tools/evaluate.test.ts` mocks `writeRunRecord` completely (via `vi.mock("../lib/run-record.js", ...)`). PH01-US-00a-AC08 requires a test in `evaluate.test.ts` that asserts byte-identical `evalReport` output across two calls with different input orders. A sort that lives inside the (mocked) `writeRunRecord` is invisible to the test — the mock receives the un-canonicalized input.
- **Why it matters:** Putting canonicalization inside `writeRunRecord` would make AC08 permanently unobservable in `evaluate.test.ts` (where AC08 explicitly lives), so either the AC has to move to a different test file or the canonicalization has to move to the handler. I chose to put it in the handler via an exported helper `canonicalizeEvalReport` from `run-record.ts` — this makes the sort observable via the mock-received record, and the helper becomes the convention future call sites use. But it technically violates the PRD's "writeRunRecord is responsible" wording.
- **Fix proposal:** (a) Update PRD REQ-01 to say "every canonical `writeRunRecord` call site is responsible for passing a canonicalized `EvalReport`, using the exported `canonicalizeEvalReport` helper from `server/lib/run-record.ts`." (b) Alternatively, put the sort in `writeRunRecord` AND move AC08 to `server/lib/run-record.test.ts` where the real function runs. (c) For v1.1 I'm going with (a) — the helper-at-handler pattern — and will note it in the S3 reply.
- **Source:** Tension between `docs/forge-coordinate-prd.md:70` (REQ-01 "writeRunRecord is responsible for canonicalizing") and `server/tools/evaluate.test.ts:21-23` (full mock of writeRunRecord) + PH01-US-00a-AC08's explicit targeting of `evaluate.test.ts`.

---

## Per-story brief-quality scoreboard (rolling)

| Story | Brief tokens | Useful % | Wall-clock | Self-sufficient? | Re-reads needed | forge_evaluate verdict |
|-------|--------------|----------|------------|------------------|-----------------|------------------------|
| PH01-US-00a | 4929 | ~10% (codebase-context noise) | ~25 min | No — had to read 6 source files | run-record.ts, evaluate.ts, eval-report.ts, run-context.ts, cost.ts, evaluate.test.ts | INCONCLUSIVE (F-05 Windows bug — all 10 ACs verified manually: tsc clean, 35/35 evaluate tests green, 390/390 full suite green) |

---

## Running TODO (findings to fix post-S3)

- [ ] **F-05 (CRITICAL)**: fix `forge_evaluate` story-mode `spawn bash ENOENT` on Windows — audit `server/lib/executor.ts` / `server/lib/evaluator.ts`, add `shell: true` or absolute bash path resolution, add Windows CI test asserting story-mode verdict is not ENOENT-INCONCLUSIVE
- [ ] F-01: prune `.claude/worktrees/` (and friends) from `codebase-scan.ts` walker
- [ ] F-02: add `referencePatterns` brief field OR include `affectedPaths` file contents for "extend existing" stories
- [ ] F-03: update PRD REQ-01 + PH01-US-00a description to use `criteria`/`id`/`evidence` vocabulary instead of `findings`/`failedAcId`/`description`
- [ ] F-04: reconcile PRD "writeRunRecord is responsible" wording with the helper-at-handler pattern chosen for PH01-US-00a
