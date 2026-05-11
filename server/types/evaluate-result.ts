/**
 * evaluate-result.ts — types describing the *new* fields forge_evaluate
 * surfaces on its top-level MCP response envelope as of v0.43.0.
 *
 * Mirrors the `callerAction` discriminator pattern from `generate-result.ts`:
 * the field is optional on the wire (absent on legacy `FORGE_SPEC_CALLER_ACTION=0`
 * runs and on non-PASS verdicts), and a known string-literal value when present.
 *
 * v0.43.0 ships only one literal for evaluate — `"generate-spec-inline"` —
 * because spec-gen is the single LLM call we moved out of the MCP child.
 * Adding sibling directives later (e.g. for other LLM-class work) extends
 * the union without breaking back-compat per P50.
 */

import type { EvalReport } from "./eval-report.js";

/**
 * v0.43.0 evaluate-side caller-action discriminator. Distinct from
 * `generate-result.ts`'s `CallerAction` (which is for forge_generate's
 * brief-vs-inline split — `"spawn-subagent-and-await" | "execute-inline"`).
 * The evaluate-side literal is `"generate-spec-inline"`: the caller does
 * a single LLM round-trip with the provided prompts and posts the result
 * to the companion `forge_apply_spec_gen` MCP tool.
 */
export type EvaluateCallerAction = "generate-spec-inline";

/**
 * Payload accompanying the `callerAction: "generate-spec-inline"` directive.
 * Contains EVERY input the caller needs to do the spec-gen LLM call AND
 * to attach the resulting merge event back onto the same run record (via
 * `runId`).
 *
 * Field-level contracts:
 *   - `storyId`: the input.storyId (echoed for caller convenience).
 *   - `runId`:   stable 4-char hex suffix that `evaluate.ts` reserved when
 *                it wrote the brief-emit event. The caller MUST round-trip
 *                this value into `forge_apply_spec_gen({ runId })` so the
 *                merge event lands in the SAME `.forge/runs/forge_evaluate-*`
 *                file (AC-14 observability atomicity).
 *   - `specPath`: absolute path to `docs/generated/TECHNICAL-SPEC.md`.
 *   - `affectedPaths`: the story's `affectedPaths`. Surfaced for caller
 *                observability and for the source-vocabulary grounding
 *                check the caller may want to re-verify against.
 *   - `systemPrompt`: the `SYSTEM_PROMPT` constant from spec-generator,
 *                pre-rendered. The caller passes this verbatim as the
 *                system message to its LLM.
 *   - `userPrompt`: FULL pre-rendered output of `buildUserPrompt(req)`.
 *                The caller does NOT re-assemble; just sends this as the
 *                user message to its LLM.
 *   - `vocabularyPrompt`: pre-rendered output of
 *                `renderVocabularyForPrompt(vocab)`. Surfaced separately so
 *                the caller can inspect the grounding window without
 *                re-deriving it from `userPrompt`.
 *   - `diffSummary`: git diff stat captured at brief-build time.
 *   - `evalReport`: the PASS-verdict eval report. Surfaced for caller-side
 *                observability; the AC lines are already embedded in
 *                `userPrompt` so the caller does not need to re-render.
 *   - `expectedSections`: the four canonical sub-section names. The caller's
 *                LLM response MUST contain exactly these four keys under
 *                `sections`.
 *   - `currentSectionContent`: current content of each sub-section under
 *                `## story: <storyId>` from on-disk TECHNICAL-SPEC.md.
 *                OBSERVATIONAL ONLY — the server-side AC-3b short-circuit
 *                in `evaluate.ts` already sampled this and decided to emit
 *                the directive (i.e. no `<!-- hand-authored ` marker
 *                present at brief-emit time). AC-6 race-window check
 *                re-samples in `forge_apply_spec_gen`.
 */
export interface SpecGenBrief {
  storyId: string;
  runId: string;
  specPath: string;
  affectedPaths: string[];
  systemPrompt: string;
  userPrompt: string;
  vocabularyPrompt: string;
  diffSummary: string;
  evalReport: EvalReport;
  expectedSections: ["api-contracts", "data-models", "invariants", "test-surface"];
  currentSectionContent: {
    "api-contracts": string;
    "data-models": string;
    invariants: string;
    "test-surface": string;
  };
  /**
   * v0.43.0 — git HEAD sha captured at brief-build time. The caller MUST echo
   * this back through `forge_apply_spec_gen({gitSha})` so the spec front-matter's
   * `lastGitSha` field reflects the PASS-verdict commit (v0.35.1 AC-2 contract).
   * Optional because `captureGitSha` is best-effort (missing repo / missing
   * `git` binary / shallow clone all simply omit the field). When absent on
   * the brief, the apply tool stamps `lastGitSha: "unknown"`.
   */
  gitSha?: string;
}

/**
 * Run-record discriminator for the spec-gen path that ran for a given
 * `forge_evaluate` PASS. Additive-optional per P50; pre-v0.43.0 records
 * lack the field. New literal values may be added as the spec-gen
 * pipeline evolves; consumers should treat unknown values as
 * `"in-mcp"` (the legacy assumption).
 *
 * Values:
 *   - "in-mcp": legacy v0.42.x path — MCP child called Anthropic API
 *               directly via `generateSpecForStory`. Selected by
 *               `FORGE_SPEC_CALLER_ACTION=0`.
 *   - "caller-action": v0.43.0 default — MCP child emitted the directive
 *               and did NOT call Anthropic. The caller will follow up
 *               with `forge_apply_spec_gen` to merge.
 *   - "short-circuited-hand-author": evaluate.ts detected a
 *               `<!-- hand-authored ` marker in the on-disk spec at
 *               brief-build time and refused to emit either a directive
 *               OR a brief. No LLM call, no overwrite. Verdict still PASS.
 */
export type SpecGenMode =
  | "in-mcp"
  | "caller-action"
  | "short-circuited-hand-author";
