/**
 * Q0.5/C1-bis — plan-level `lintExempt` variant for bootstrap absorption of
 * pre-existing drift backlogs. Separate from the per-AC `lintExempt` on
 * `AcceptanceCriterion` (different semantics: plan-level DROPS findings,
 * per-AC KEEPS them with `exempt: true` flag). Validated and consumed by
 * `server/validation/ac-lint.ts`.
 *
 * Keep this shape in byte-identical sync with `LintExemptPlan` in
 * `server/validation/ac-lint.ts` — the two live in separate modules to keep
 * the types module free of validation imports.
 */
export interface LintExemptPlan {
  scope: "plan";
  rules: string[];
  batch: string;
  rationale: string;
}

export interface ExecutionPlan {
  schemaVersion: "3.0.0";
  prdPath?: string; // Reserved for future use; not populated by the planner in Phase 1.
  documentTier?: "phase"; // Three-tier system: marks this plan as a phase-level document.
  phaseId?: string; // PH-XX reference linking this plan to a MasterPlan phase.
  baselineCheck?: string; // Shell command to verify project health before generation (e.g. "npm run build && npm test").
  /**
   * Q0.5/C1-bis — plan-level bootstrap-absorption exemptions. See
   * `LintExemptPlan` for field semantics and
   * `server/validation/ac-lint.ts` for the validator + filter behavior.
   */
  lintExempt?: LintExemptPlan[];
  stories: Story[];
}

export interface StoryLineage { tier: "phase-plan" | "master-plan" | "prd"; sourceId: string }

export interface Story {
  id: string;
  title: string;
  dependencies?: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  affectedPaths?: string[];
  lineage?: StoryLineage;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  command: string;
  /**
   * Q0.5/C2 — runtime-flaky marker. When `true`, the evaluator retries the AC
   * once if the first run returns `status: FAIL`, waiting `flakyRetryGapMs`
   * between runs (default 500ms). Retry semantics:
   *   - run-1 PASS → PASS (no retry spawned)
   *   - run-1 FAIL + run-2 PASS → PASS with `reliability: "suspect"` (flake
   *     detected; the run passed but the trust level is degraded so callers
   *     can surface the soft signal)
   *   - run-1 FAIL + run-2 FAIL → FAIL (real failure, two signals)
   *
   * Lint-flagged suspect ACs (A1b short-circuit) do NOT enter this retry
   * path — they are skipped before the retry gate because the command shape
   * itself is broken and retrying would just burn CPU for the same wrong
   * answer. The `flaky` field should only be set on ACs whose commands pass
   * ac-lint clean but are known to vary across runs for reasons outside the
   * code under test (network, wall-clock, race conditions).
   */
  flaky?: boolean;
  /**
   * Per-rule ac-lint exemptions (Q0.5/A1). When an AC's command matches a
   * deny-list pattern but the author has a justified reason (e.g. an
   * intentional-looking pattern that is not actually subprocess-unsafe in
   * this context), they can attach a `lintExempt` entry naming the specific
   * `ruleId`. The lint module honors the exemption: matching findings are
   * still reported, but `exempt: true` downgrades the overall `suspect`
   * verdict for that rule. Other rules still fire normally. See
   * `server/validation/ac-lint.ts`. Governance cap: plans with >3 total
   * lintExempt entries across all ACs are flagged for review.
   */
  lintExempt?: { ruleId: string; rationale: string } | Array<{ ruleId: string; rationale: string }>;
  /**
   * Q0.5/B1 — per-AC smoke-test timeout override, in milliseconds. Consulted
   * only by `forge_evaluate(mode: "smoke-test")`, ignored in story/coherence/
   * divergence modes.
   *
   * The smoke-runner clamps every value at runtime (single source of truth,
   * NOT enforced via TypeScript range types — see B1 plan D2):
   *   - undefined / null / NaN / !Number.isFinite(v) → default 30000ms
   *   - v < 0  → default 30000ms (negative = "use default", not instant-fail)
   *   - v === 0 → default 30000ms (same reason)
   *   - v > 180000 → 180000ms (hard cap: 3 min)
   *   - otherwise → v
   *
   * Setting this field explicitly also suppresses the `timeoutRisk: true`
   * modifier on `slow` verdicts — opt-in consent that the AC is expected to
   * use the larger budget. Authors should only set this when they understand
   * why a particular command legitimately needs more than 30 seconds.
   */
  smokeTimeoutMs?: number;
}
