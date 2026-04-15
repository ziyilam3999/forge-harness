Decision: AFFIRM
Date: 2026-04-15
Auditor: lucky-iris
Task: #22 — Q1 cross-phase audit (F-55/F-56 grep patterns in PH-02/03/04 phase JSONs)
Branch: fix/q22-c1-bootstrap-exemption-decision
Plan: .ai-workspace/plans/2026-04-15-q1-cross-phase-grep-audit.md
Files in scope: 9 (8 with `grep -q 'passed'` ACs totaling 177; 1 with 0 ACs)

# C1-Bootstrap Exemption Decision — AFFIRM with Refreshed Rationale

## Summary

The 9 phase JSONs tagged `batch: "2026-04-13-c1-bootstrap"` carry a `lintExempt[scope: "plan"]` block that was added in Q0.5/C1-bis as a temporary bootstrap concession. The question this audit answers: **does anything at runtime currently consume the AC commands inside those files such that removing the exemption would actually break something?**

Answer: **no**. The phase JSONs are historical execution records of work shipped under PH-01 through PH-04. No CI step, no test suite, no production source code, and no scheduled job loads them at runtime. The single voluntary consumer — a user manually invoking `forge_lint_refresh planPath=<phase-json>` — would only flag F-55/F-56 violations in those files, not break any execution.

The exemption block remains load-bearing in exactly that one voluntary-audit scenario. Removing it would force a pre-emptive rewrite of 177 AC commands across 8 files for files that nobody actually runs anymore. **AFFIRM** with a refreshed rationale citing the post-v0.20.0 / post-PR #208 measurement is the correct call: the contract stays, the rationale is updated to reflect the actual state of the world rather than the original "we'll get to this later" framing.

## Measurement

All commands run on `master @ 2d2b78d` (and re-confirmed on branch `fix/q22-c1-bootstrap-exemption-decision @ 908181f`), 2026-04-15.

### M1 — Source code does not reference the phase JSONs by filename

```
$ grep -rn "forge-coordinate-phase-PH-0\|forge-generate-phase-PH-0" server/
(no output)
```

**What this proves:** zero source code in `server/` mentions any of the 8 phase JSONs by name. There is no compile-time or import-time coupling. If we deleted all 8 files tomorrow, no `tsc` or `eslint` or `vitest` invocation would notice.

### M2 — `.ai-workspace/plans` references in source code are caller-driven, not auto-loaders

```
$ grep -rn ".ai-workspace/plans" server/ --include="*.ts"
server/lib/lint-audit.test.ts:35:  planPath: ".ai-workspace/plans/2026-04-14-sample.md",
server/lib/lint-audit.test.ts:90:  expect(computePlanSlug(".ai-workspace/plans/2026-04-14-foo.md")).toBe(
server/lib/smoke-runner.test.ts:18: * at `.ai-workspace/plans/2026-04-13-q05-b1-smoke-test.md`.
server/tools/evaluate.ts:64:        '"critic": LLM-judged plan review — runs the critic prompt against one or more execution plan JSON files, returns per-plan findings. If planPaths is omitted, globs `.ai-workspace/plans/*.json` under projectPath.',
server/tools/evaluate.ts:73:        'critic mode globs `.ai-workspace/plans/*.json` under projectPath (or cwd ' +
server/tools/evaluate.ts:638:  // Resolve plan paths: explicit list, or glob `.ai-workspace/plans/*.json`
server/tools/lint-refresh.ts:77:/** Default project root = the directory containing `.ai-workspace/plans/` */
server/tools/lint-refresh.ts:80:  // planPath = <root>/.ai-workspace/plans/<file>.json → go up two levels
server/validation/ac-lint.ts:31: * pre-existing drift backlogs (see `.ai-workspace/plans/2026-04-13-q05-c1-...`).
```

**What this proves:** every reference is one of:
- A test fixture string (`lint-audit.test.ts`, `smoke-runner.test.ts`) — hard-coded path, doesn't load the file.
- A doc comment (`evaluate.ts:64,73`, `lint-refresh.ts:77,80`, `ac-lint.ts:31`) — explanatory, no I/O.
- The `evaluate.ts:638` critic-mode loader — the *only* line in `server/` that auto-globs phase JSONs. Worth inspecting separately.

### M3 — Critic mode loads, parses, and ships to LLM. It does NOT shell-execute the AC commands.

```
$ sed -n '618,700p' server/tools/evaluate.ts | grep -nE "readFile|JSON.parse|exec|spawn|childProcess|shell|callClaude"
1: * Q0.5/C1 — critic eval mode. Loads N plan files, fans out N critic prompt
12:  if (input.planPaths && input.planPaths.length > 0) {
52:      const planJson = readFileSync(planPath, "utf-8");
54:      JSON.parse(planJson);
58:      const result = await trackedCallClaude(ctx, "critic-eval", "critic", {
```

**What this proves:** critic mode reads each plan JSON as a string, validates it parses, and ships the raw text to `trackedCallClaude` for LLM review. It never spawns a child process, never `eval`s any string, never touches `child_process.exec`. The grep-q AC commands inside the phase JSONs are just opaque string content from the loader's perspective. **There is no runtime execution path that interprets them as shell commands.**

### M4 — `ac-lint.ts` is a pure function library; it does not load files itself

```
$ grep -nE "readFile|readdir|glob" server/validation/ac-lint.ts
(no output)
```

**What this proves:** `ac-lint.ts` exposes pure functions (`lintAcCommand`, `lintPlan`, etc.) that operate on plan objects passed in by the caller. It performs no I/O. It only sees the phase JSONs if a caller (e.g., `lint-refresh`) loads them and passes the parsed object. So the `lintExempt` block is only consumed when a user actively invokes lint-refresh against one of those files — never proactively, never in CI.

### M5 — CI workflow never invokes critic mode or lint-refresh on plan JSONs

```
$ grep -i "plan\|critic\|lint-refresh\|evaluate\|.ai-workspace" .github/workflows/ci.yml
(no output)
```

**What this proves:** `.github/workflows/ci.yml` mentions none of: plan files, critic mode, `lint-refresh`, `evaluate`, or `.ai-workspace`. CI runs `npm run build`, `npm run lint`, `npm test`, and a smoke-gate — none of which load the phase JSONs. There is zero automated CI consumer for the 9 files.

### M6 — Test suites do not reference the phase JSONs by name

```
$ grep -rn "forge-coordinate-phase\|forge-generate-phase\|phase-PH-0" server/
(no output)
```

**What this proves:** no test in the `server/**/*.test.ts` suite mentions any of the 8 phase JSONs. They are not used as fixtures, not loaded by helper functions, not referenced in test descriptions. Zero test-time consumer.

### M7 — The 9-file enumeration matches the planner's amended baseline

```
$ grep -l 2026-04-13-c1-bootstrap .ai-workspace/plans/*.json
.ai-workspace/plans/2026-04-02-phase2-forge-plan-output.json
.ai-workspace/plans/forge-coordinate-phase-PH-01.json
.ai-workspace/plans/forge-coordinate-phase-PH-02.json
.ai-workspace/plans/forge-coordinate-phase-PH-03.json
.ai-workspace/plans/forge-coordinate-phase-PH-04.json
.ai-workspace/plans/forge-generate-phase-PH-01.json
.ai-workspace/plans/forge-generate-phase-PH-02.json
.ai-workspace/plans/forge-generate-phase-PH-03.json
.ai-workspace/plans/forge-generate-phase-PH-04.json
```

```
$ for f in $(grep -l 2026-04-13-c1-bootstrap .ai-workspace/plans/*.json); do
    echo "$f: $(grep -c \"grep -q 'passed'\" $f)"
  done
.ai-workspace/plans/2026-04-02-phase2-forge-plan-output.json: 0
.ai-workspace/plans/forge-coordinate-phase-PH-01.json: 35
.ai-workspace/plans/forge-coordinate-phase-PH-02.json: 19
.ai-workspace/plans/forge-coordinate-phase-PH-03.json: 29
.ai-workspace/plans/forge-coordinate-phase-PH-04.json: 29
.ai-workspace/plans/forge-generate-phase-PH-01.json: 30
.ai-workspace/plans/forge-generate-phase-PH-02.json: 15
.ai-workspace/plans/forge-generate-phase-PH-03.json: 10
.ai-workspace/plans/forge-generate-phase-PH-04.json: 10
```

Total: 35 + 19 + 29 + 29 + 30 + 15 + 10 + 10 = **177 grep-q ACs across 8 files**, plus 1 file (`2026-04-02-phase2-forge-plan-output.json`) with 0 ACs but the same exemption tag. **What this proves:** the 9-file population is correct, and the per-file counts reconcile to the amended Context section of the plan (after patch 4). 8/9 files with 177 ACs.

## Conclusion

M1 + M2 + M3 + M4 + M5 + M6 prove that no runtime consumer of the 9 phase JSONs exists in the codebase or CI pipeline. The only path on which the `lintExempt` block is load-bearing is a voluntary user-initiated `forge_lint_refresh planPath=<phase-json>`, which is an audit operation, not a production code path. Under that voluntary path, removing the exemption would surface pre-existing F-55/F-56 violations — **violations that describe shipped historical work and cannot break any future execution.**

The cost-benefit analysis falls clearly:

- **AFFIRM cost:** 9 small `rationale` field edits, 1 commit, no AC rewrites, no test changes. Zero risk to any consumer.
- **UNWIND cost:** 177 AC command rewrites across 8 files, careful regex-or-jq surgery to preserve JSON validity, hours of churn for files that nobody runs, and a measurable risk of accidentally breaking the lintExempt schema or introducing CRLF/encoding drift on files no human reads.

**Decision: AFFIRM.** The exemption stays. Rationale is refreshed across all 9 files to reflect the post-v0.20.0 / post-PR #208 measured reality: "PH-01 through PH-04 phase JSONs are shipped historical execution records with no automated runtime consumer; ac-lint does not scan them in CI; the only consumer is voluntary `forge_lint_refresh` against a specific path. Live drift in new plans is prevented by `npm run lint` (PR #208) plus ac-lint's per-call enforcement on freshly authored plans, not by retroactive cleanup of historical records. Original C1-bootstrap rationale is superseded by this measurement."

## Refreshed Rationale Text (applied to all 9 files)

The new `rationale` field that will be written to all 9 files' `lintExempt[batch: "2026-04-13-c1-bootstrap"]` blocks:

> Re-affirmed 2026-04-15 (task #22 audit, post-v0.20.0 / post-PR #208). These phase JSONs are shipped historical execution records of PH-01 through PH-04 work; no automated runtime consumer exists (verified: zero grep hits in `server/**`, zero references in `.github/workflows/ci.yml`, zero usage in test suites, ac-lint is a pure function library that only runs on caller-supplied plans). The only voluntary consumer is `forge_lint_refresh planPath=<this-file>`, which is an audit-time operation against a specific path and would only re-surface pre-existing F-55/F-56 violations describing already-shipped work. Live drift in newly authored plans is prevented by `npm run lint` (CI-enforced via PR #208) and per-call ac-lint, not by retroactive cleanup of historical records. Original C1-bootstrap "we'll unwind later" framing superseded — exemption retained as the correct end-state for shipped artifacts. Unwind via `grep -l 2026-04-13-c1-bootstrap .ai-workspace/plans/*.json` only if a future runtime consumer is added that would load these files automatically.

Length: 3 sentences. No code paths cited that don't exist. No promises of future cleanup. Cites the measurement that justifies the call.
