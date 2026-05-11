import { z } from "zod";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveWindowsBashPath } from "../lib/executor.js";
import { notifyForgeStateWrite } from "../lib/dashboard-render-loop.js";

/**
 * Compute a deterministic `reverseFindings[].id` from its identifying fields.
 * Stability invariant: same (location, classification, description) → same id
 * across runs, so downstream id-only diffs (reconcile-remnants) remain meaningful.
 */
export function computeReverseFindingId(
  location: string,
  classification: string,
  description: string,
): string {
  const hash = createHash("sha256")
    .update(`${location}|${classification}|${description}`)
    .digest("hex")
    .slice(0, 12);
  return `rev-${hash}`;
}
import { evaluateStory } from "../lib/evaluator.js";
import { smokeTestPlan } from "../lib/smoke-runner.js";
import { scanCodebase } from "../lib/codebase-scan.js";
import { loadPlan } from "../lib/plan-loader.js";
import { RunContext, trackedCallClaude } from "../lib/run-context.js";
import {
  writeRunRecord,
  canonicalizeEvalReport,
  computeSpecGenCostUsd,
  generateRunId,
  type RunRecord,
  type CriticEvalReport,
  type SpecGeneratorWarning,
} from "../lib/run-record.js";
import {
  buildSpecGenBrief,
  extractCurrentSectionContent,
  generateSpecForStory,
  hasHandAuthoredMarker,
} from "../lib/spec-generator.js";
import type { SpecGenBrief } from "../types/evaluate-result.js";
import { processStory as processAdrStory } from "../lib/adr-extractor.js";
import {
  buildCriticPrompt,
  buildCriticUserMessage,
} from "../lib/prompts/critic.js";
import {
  buildCoherenceEvalPrompt,
  buildCoherenceEvalUserMessage,
} from "../lib/prompts/coherence-eval.js";
import {
  buildDivergenceEvalPrompt,
  buildDivergenceEvalUserMessage,
} from "../lib/prompts/divergence-eval.js";
import type { CoherenceReport, CoherenceGap } from "../types/coherence-report.js";
import { verifySpecVocabularyFromContent } from "../lib/spec-vocabulary-check.js";
import type {
  DivergenceReport,
  ForwardDivergence,
  ReverseDivergence,
} from "../types/divergence-report.js";

// ── Input Schema ──────────────────────────────────────────

export const evaluateInputSchema = {
  evaluationMode: z
    .enum(["story", "coherence", "divergence", "smoke-test", "critic"])
    .optional()
    .describe(
      'Evaluation mode. "story": run AC shell commands (default). ' +
        '"coherence": LLM-judged tier alignment (PRD <-> master <-> phase). ' +
        '"divergence": forward (AC failures) + reverse (unplanned capabilities). ' +
        '"smoke-test": authoring-time characterization of every AC — runs once per AC, classifies as ok/slow/empty-evidence/hung/skipped-suspect. Writes a sidecar {plan}.smoke.json file when planPath is provided. ' +
        '"critic": LLM-judged plan review — runs the critic prompt against one or more execution plan JSON files, returns per-plan findings. If planPaths is omitted, globs `.ai-workspace/plans/*.json` under projectPath.',
    ),

  // ── Critic mode params ──
  planPaths: z
    .array(z.string())
    .optional()
    .describe(
      'Plan file paths to critique. Used only by critic mode. If omitted, ' +
        'critic mode globs `.ai-workspace/plans/*.json` under projectPath (or cwd ' +
        'as a fallback). Required only when the caller wants to scope the sweep.',
    ),

  // ── Story mode params ──
  storyId: z
    .string()
    .optional()
    .describe("Story ID to evaluate (e.g., US-01). Required for story mode."),
  planPath: z
    .string()
    .optional()
    .describe("Absolute path to execution plan JSON file"),
  planJson: z
    .string()
    .optional()
    .describe(
      "Inline execution plan JSON string. Takes precedence over planPath.",
    ),
  timeoutMs: z
    .number()
    .positive()
    .optional()
    .describe("Timeout per AC command in milliseconds. Default: 30000"),

  // ── Coherence mode params ──
  prdContent: z
    .string()
    .optional()
    .describe(
      "PRD/vision document content. Required for coherence mode.",
    ),
  masterPlanContent: z
    .string()
    .optional()
    .describe("Master plan JSON string. Used by coherence mode."),
  phasePlans: z
    .array(
      z.object({
        phaseId: z.string(),
        content: z.string(),
      }),
    )
    .optional()
    .describe(
      "Phase plan contents for coherence checking against master plan.",
    ),

  // ── Divergence mode params ──
  projectPath: z
    .string()
    .optional()
    .describe(
      "Absolute path to project root. Required for divergence mode (codebase scanning).",
    ),
  reverseFindings: z
    .string()
    .optional()
    .describe(
      "Pre-computed reverse divergence findings as a JSON string (array of ReverseDivergence objects). " +
        "When provided, replaces the LLM reverse scan entirely. projectPath is still used for " +
        "forward AC execution but not for reverse analysis. Each object must have: id, description, " +
        "location, classification (method-divergence|extra-functionality|scope-creep), alignsWithPrd (boolean).",
    ),

  // ── Self-healing ──
  maxSelfHealingCycles: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe(
      "Maximum self-healing cycles for divergence mode. Default: 2. Set to 0 to disable.",
    ),
};

// v0.36.0 Phase D (AC-D5): canonical named export — see coordinate.ts for rationale.
export const ToolInputSchemaShape = evaluateInputSchema;

// ── Types ─────────────────────────────────────────────────

type EvaluateInput = {
  evaluationMode?: "story" | "coherence" | "divergence" | "smoke-test" | "critic";
  storyId?: string;
  planPath?: string;
  planJson?: string;
  planPaths?: string[];
  timeoutMs?: number;
  prdContent?: string;
  masterPlanContent?: string;
  phasePlans?: Array<{ phaseId: string; content: string }>;
  projectPath?: string;
  reverseFindings?: string;
  maxSelfHealingCycles?: number;
};

type McpResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  /**
   * v0.43.0 — caller-action directive for the spec-gen path on story-mode PASS.
   * When `"generate-spec-inline"`, the calling Claude Code session is expected
   * to (1) read `specGenBrief.systemPrompt` and `specGenBrief.userPrompt`,
   * (2) do ONE LLM round-trip with those prompts, (3) call the companion
   * `forge_apply_spec_gen` MCP tool with the parsed JSON result + `runId`
   * echoed from the brief. The MCP child does NOT call Anthropic itself.
   * Absent on non-story modes, non-PASS verdicts, hand-author-marker short-
   * circuit (AC-3b), and the legacy `FORGE_SPEC_CALLER_ACTION=0` opt-out path.
   */
  callerAction?: "generate-spec-inline";
  /**
   * v0.43.0 — companion payload for the `callerAction` directive. Contains
   * everything the caller needs to perform the spec-gen LLM round-trip.
   * Absent when `callerAction` is absent (same condition set).
   */
  specGenBrief?: SpecGenBrief;
  /**
   * v0.38.0 I3 — top-level spec-generator warnings on story-mode responses.
   * Byte-identical to the on-disk run record's `generatedDocs.warnings`.
   * Empty array when no warnings; absent on non-story modes.
   */
  specGenWarnings?: SpecGeneratorWarning[];
  /**
   * v0.40.x I1 — canonicalized ADR triples surfaced on story-mode PASS
   * responses so the calling agent can stage + commit the canonical ADR
   * file(s) without `git status`-discovering the path.
   *
   * Each entry carries:
   *   - `from`: absolute path of the staging stub that was consumed
   *     (`.forge/staging/adr/<storyId>/<short-slug>.md`).
   *   - `to`: absolute path of the canonical
   *     `docs/decisions/ADR-NNNN-*-<storyId>.md` produced this call.
   *   - `adrId`: the canonical four-digit ADR identifier
   *     (e.g. `"ADR-0007"`).
   *
   * Field is set ONLY in story-mode responses (the `processAdrStory` call
   * site); coherence-mode and divergence-mode handlers do not populate it.
   * Empty array when story-mode ran but produced zero new ADRs (no staging
   * stubs or non-PASS verdict). Additive optional per P50 — backward-compat,
   * no version bump.
   */
  adrCanonicalized?: Array<{ from: string; to: string; adrId: string }>;
};

// ── Shared helpers ────────────────────────────────────────

/** Build a RunRecord for evaluate handlers (coherence / divergence share shape). */
function buildRunRecord(
  ctx: RunContext,
  startTime: number,
  findingsTotal: number,
): RunRecord {
  const costSummary = ctx.cost.summarize();
  return {
    timestamp: new Date().toISOString(),
    tool: "forge_evaluate",
    documentTier: null,
    mode: null,
    tier: null,
    metrics: {
      inputTokens: costSummary.inputTokens,
      outputTokens: costSummary.outputTokens,
      critiqueRounds: 0,
      findingsTotal,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: Date.now() - startTime,
      estimatedCostUsd: costSummary.estimatedCostUsd,
    },
    outcome: "success",
  };
}

// ── Build-dedup helper (v0.38.0 B3) ───────────────────────

/**
 * Detect the longest leading `<setup-cmd> &&` prefix shared verbatim by ALL
 * acceptance criteria commands in the story. Currently only matches the
 * exact form `npm run build &&` (with optional surrounding whitespace) — the
 * audit's case (US-06) was 4 ACs each prefixed `npm run build && <cmd>`. The
 * plan keeps the scope narrow: "all-share case" only; partial-share is out
 * of scope.
 *
 * Returns:
 *   - `{ prefix, prefixCommand }` when every AC starts with the same
 *     `npm run build &&` prefix (`prefix` = the prefix to strip including
 *     trailing whitespace; `prefixCommand` = the bare command to run once
 *     up-front, e.g. `npm run build`).
 *   - `null` when no shared prefix exists (e.g., one AC is `node foo.js`
 *     while the others are `npm run build && node foo.js`).
 *
 * Exported so tests can verify the detection rule directly without going
 * through the full evaluate pipeline.
 */
export function detectSharedBuildPrefix(
  acCommands: ReadonlyArray<string>,
): { prefix: string; prefixCommand: string } | null {
  if (acCommands.length < 2) return null;
  // Match `<setup-cmd> &&<whitespace>` where setup-cmd is `npm run build`.
  // Lock the regex to `npm run build` for now to keep the slice narrow.
  const PREFIX_RE = /^(\s*npm\s+run\s+build\s*&&\s*)/;
  const firstMatch = acCommands[0].match(PREFIX_RE);
  if (!firstMatch) return null;
  const prefix = firstMatch[1];
  for (const cmd of acCommands) {
    if (!cmd.startsWith(prefix)) return null;
  }
  return { prefix, prefixCommand: "npm run build" };
}

// ── git HEAD capture helper ───────────────────────────────

/**
 * Capture the 40-char hex SHA at HEAD of the given directory. Returns
 * `undefined` if (a) `cwd` is not a git working copy, (b) the `git` binary
 * is missing, or (c) the call fails for any other reason. Never throws — the
 * caller treats absence the same as null.
 *
 * Added v0.35.1 for AC-2 (RunRecord.gitSha captured at PASS time, surfaced
 * via `forge_status.stories[i].lastGitSha`).
 */
function captureGitSha(cwd: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^[0-9a-f]{40}$/.test(out)) return out;
    return undefined;
  } catch {
    return undefined;
  }
}

// ── Story Mode Handler ────────────────────────────────────

async function handleStoryEval(input: EvaluateInput): Promise<McpResponse> {
  if (!input.storyId) {
    return {
      content: [{ type: "text", text: "forge_evaluate error: storyId is required for story mode" }],
      isError: true,
    };
  }

  // REQ-01 v1.1: full RunContext infrastructure for story-eval runs,
  // matching the handleCoherenceEval pattern. Enables populating
  // storyId / evalVerdict / evalReport / estimatedCostUsd on the RunRecord
  // so forge_coordinate's state reader can classify stories.
  const ctx = new RunContext({
    toolName: "forge_evaluate",
    projectPath: input.projectPath,
    stages: ["story-eval"],
  });
  const startTime = Date.now();

  const plan = loadPlan(input.planPath, input.planJson);

  // v0.38.0 B3 — build-dedup: when ALL ACs of the story share an identical
  // `npm run build &&` prefix, run `npm run build` once up-front and strip
  // the prefix from each AC's command. Partial-share is out of scope per
  // the plan; mixed-prefix scenarios fall through to the per-AC behavior.
  let buildInvocationCount: number | undefined;
  let evaluatedPlan = plan;
  const targetStory = plan.stories.find((s) => s.id === input.storyId);
  if (targetStory && targetStory.acceptanceCriteria.length >= 2) {
    const acCommands = targetStory.acceptanceCriteria.map((ac) => ac.command);
    const shared = detectSharedBuildPrefix(acCommands);
    if (shared) {
      try {
        // v0.38.x — On Windows, `sh` is not on PATH; resolve Git-Bash absolute
        // path the same way executor.ts does for per-AC commands. Without this,
        // the up-front build throws ENOENT, falls through to per-AC builds, and
        // B3's intended N→1 build savings is silently lost on Windows ships.
        const shellPath =
          platform() === "win32" ? resolveWindowsBashPath() : "sh";
        execFileSync(shellPath, ["-c", shared.prefixCommand], {
          cwd: input.projectPath,
          stdio: ["ignore", "pipe", "pipe"],
        });
        buildInvocationCount = 1;
      } catch (err) {
        // If the up-front build fails, leave the prefixes intact so each AC
        // sees its own build failure (preserves observable behavior — a
        // failing build still surfaces as a per-AC FAIL rather than a
        // single hidden setup error).
        console.error(
          `forge_evaluate: shared-prefix build failed (falling back to per-AC build): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (buildInvocationCount === 1) {
        // Rewrite the plan in-memory: drop the shared prefix from each AC of
        // the target story. New plan object — the original `plan` ref stays
        // unchanged so callers (and the run record) see the original commands.
        const rewrittenStories = plan.stories.map((s) => {
          if (s.id !== input.storyId) return s;
          return {
            ...s,
            acceptanceCriteria: s.acceptanceCriteria.map((ac) => ({
              ...ac,
              command: ac.command.slice(shared.prefix.length),
            })),
          };
        });
        evaluatedPlan = { ...plan, stories: rewrittenStories };
      }
    }
  }

  const report = await evaluateStory(evaluatedPlan, input.storyId, {
    timeoutMs: input.timeoutMs,
    cwd: input.projectPath,
  });

  // v0.38.0 I3 — captured for the top-level MCP response field.
  let storyEvalSpecGenWarnings: SpecGeneratorWarning[] | undefined;

  // v0.43.0 — captured for the top-level MCP response field. Set when the
  // PASS-path defaults to the new caller-action directive flow (env var
  // `FORGE_SPEC_CALLER_ACTION` unset OR not "0") AND no hand-author marker
  // short-circuit fired (AC-3b).
  let storyEvalCallerAction: "generate-spec-inline" | undefined;
  let storyEvalSpecGenBrief: SpecGenBrief | undefined;

  // v0.43.0 — runId reserved at brief-build time and stamped into the run
  // record filename so the caller's follow-up `forge_apply_spec_gen` call
  // can locate + append its merge event onto the SAME run record file (AC-14).
  // Stays undefined on the legacy `FORGE_SPEC_CALLER_ACTION=0` opt-out path
  // and on hand-author short-circuits — the writeRunRecord call falls back
  // to its random suffix in those cases.
  let storyEvalRunId: string | undefined;

  // v0.40.x I1 — captured for the top-level MCP response field. Populated
  // ONLY by story-mode PASS runs that called `processAdrStory`. Stays
  // `undefined` on non-PASS verdicts and when projectPath is missing — in
  // both cases the field is omitted from the response (additive optional).
  let storyEvalAdrCanonicalized:
    | Array<{ from: string; to: string; adrId: string }>
    | undefined;

  // Write run record with the four REQ-01 v1.1 additive fields populated.
  // canonicalizeEvalReport sorts criteria by (id, evidence) so two runs
  // with the same criteria in different input orders produce byte-identical
  // JSON output (NFR-C02 determinism, NFR-C10 golden-file byte-identity).
  if (input.projectPath) {
    const base = buildRunRecord(ctx, startTime, report.criteria.length);
    // v0.35.1 AC-2: capture git HEAD sha so forge_status.lastGitSha is
    // populated for shipped stories. Best-effort — missing repo / missing
    // binary / non-PASS verdict all simply omit the field.
    const gitSha = captureGitSha(input.projectPath);

    // v0.43.0 — read the caller-action env-var ONCE per call so tests can
    // mutate `process.env.FORGE_SPEC_CALLER_ACTION` between cases. Default
    // path is the new directive flow; `FORGE_SPEC_CALLER_ACTION=0` opts back
    // to the legacy in-MCP `generateSpecForStory` call.
    const useLegacyInMcpPath = process.env.FORGE_SPEC_CALLER_ACTION === "0";

    // v0.36.0 Phase B (AC-B1..B6): synchronously generate or update the
    // story's section in `docs/generated/TECHNICAL-SPEC.md`. Mandated sync
    // (plan §122) so the file exists by the time forge_evaluate returns.
    // Failures are logged and swallowed — a doc-gen hiccup MUST NOT mask
    // the underlying eval verdict (analogous to the dashboard hooks in
    // `writeRunRecord`).
    let generatedDocs: NonNullable<RunRecord["generatedDocs"]> | undefined;
    if (report.verdict === "PASS") {
      const story = plan.stories.find((s) => s.id === input.storyId);

      if (!useLegacyInMcpPath) {
        // v0.43.0 NEW PATH (default) — emit the `generate-spec-inline`
        // directive instead of making a direct Anthropic API call from
        // the MCP child. AC-1, AC-2, AC-3, AC-3b.
        //
        // Step 1 (AC-3b): server-side hand-author marker short-circuit.
        // Sample on-disk content for the four canonical sub-sections.
        // If ANY contains the `<!-- hand-authored ` marker, refuse to
        // emit a directive AND a brief — the caller never gets work.
        let currentSectionContent: ReturnType<typeof extractCurrentSectionContent>;
        try {
          currentSectionContent = extractCurrentSectionContent(
            input.projectPath,
            input.storyId,
          );
        } catch (err) {
          // Sampling failure (e.g. malformed spec file) — fall through to
          // the directive flow rather than blocking. Empty snapshot is
          // observationally identical to "no prior content".
          console.error(
            `forge_evaluate: extractCurrentSectionContent failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
          );
          currentSectionContent = {
            "api-contracts": "",
            "data-models": "",
            invariants: "",
            "test-surface": "",
          };
        }

        if (hasHandAuthoredMarker(currentSectionContent)) {
          // AC-3b — refuse to emit a directive; loud warning on BOTH the
          // on-disk run record's `generatedDocs.warnings` AND the MCP
          // top-level `specGenWarnings` (P64 dual-surface).
          generatedDocs = {
            specPath: "",
            adrPaths: [], // populated below by Phase C's ADR extractor
            genTimestamp: new Date().toISOString(),
            genTokens: { inputTokens: 0, outputTokens: 0 },
            contracts: [],
            warnings: [
              {
                kind: "spec-gen-short-circuited-hand-author",
                message:
                  "TECHNICAL-SPEC.md contains a `<!-- hand-authored ... -->` marker on at least one sub-section of `## story: " +
                  input.storyId +
                  "`; forge-harness will not regenerate.",
              },
            ],
            specGenMode: "short-circuited-hand-author",
          };
        } else {
          // No hand-author marker — emit the directive + brief.
          storyEvalRunId = generateRunId();
          const briefPayload = buildSpecGenBrief(
            {
              projectPath: input.projectPath,
              storyId: input.storyId,
              evalReport: report,
              affectedPaths: story?.affectedPaths,
              gitSha,
            },
            storyEvalRunId,
          );
          storyEvalCallerAction = "generate-spec-inline";
          // The lib-layer payload is structurally compatible with the
          // wire-shape `SpecGenBrief`. Pin the literal type at the
          // boundary so the response field carries the readonly tuple.
          storyEvalSpecGenBrief = {
            storyId: briefPayload.storyId,
            runId: briefPayload.runId,
            specPath: briefPayload.specPath,
            affectedPaths: briefPayload.affectedPaths,
            systemPrompt: briefPayload.systemPrompt,
            userPrompt: briefPayload.userPrompt,
            vocabularyPrompt: briefPayload.vocabularyPrompt,
            diffSummary: briefPayload.diffSummary,
            evalReport: briefPayload.evalReport,
            expectedSections: [
              "api-contracts",
              "data-models",
              "invariants",
              "test-surface",
            ],
            currentSectionContent: briefPayload.currentSectionContent,
            gitSha: briefPayload.gitSha,
          };
          // Brief-emit event lands in run record with structural marker
          // (`specGenMode: "caller-action"`) so observability shows the
          // directive was emitted; the merge event from `forge_apply_spec_gen`
          // will OVERWRITE this envelope on the same file via the
          // `findAndMergeRunRecord` path.
          generatedDocs = {
            specPath: briefPayload.specPath,
            adrPaths: [],
            genTimestamp: new Date().toISOString(),
            genTokens: { inputTokens: 0, outputTokens: 0 },
            contracts: [],
            warnings: [],
            specGenMode: "caller-action",
          };
        }
      } else {
        // v0.42.x LEGACY PATH (opt-out) — direct Anthropic API call from the
        // MCP child via `generateSpecForStory`. F4 fix — when the spec-generator
        // throws, mint typed warnings that surface on BOTH the on-disk run
        // record's `generatedDocs.warnings` AND the MCP top-level
        // `specGenWarnings` (P64 producer/consumer seam, P44 loud-failure).
        try {
          const spec = await generateSpecForStory({
            projectPath: input.projectPath,
            storyId: input.storyId,
            evalReport: report,
            affectedPaths: story?.affectedPaths,
            gitSha,
            ctx,
          });
          generatedDocs = {
            specPath: spec.specPath,
            adrPaths: [], // populated below by Phase C's ADR extractor
            genTimestamp: spec.genTimestamp,
            genTokens: spec.genTokens,
            contracts: spec.contracts,
            warnings: spec.warnings ?? [],
            specGenMode: "in-mcp",
          };
        } catch (err) {
          // Un-swallow: PASS verdict + spec-generator threw is surfaced via
          // typed warnings on the run record + the MCP top-level field.
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `forge_evaluate: spec-generator failed (continuing with warning surfaced): ${message}`,
          );
          const failureWarnings: SpecGeneratorWarning[] = [
            { kind: "spec-gen-failed", message },
            {
              kind: "spec-gen-skipped-on-pass",
              message:
                "PASS verdict but spec-generator threw; TECHNICAL-SPEC.md was NOT regenerated for this story",
            },
          ];
          generatedDocs = {
            specPath: "",
            adrPaths: [], // populated below by Phase C's ADR extractor
            genTimestamp: new Date().toISOString(),
            genTokens: { inputTokens: 0, outputTokens: 0 },
            contracts: [],
            warnings: failureWarnings,
            specGenMode: "in-mcp",
          };
        }
      }

      // v0.36.0 Phase C (AC-C1..C6): canonicalise any subagent-staged ADR
      // stubs into `docs/decisions/ADR-NNNN-*.md` and rebuild INDEX.md. Runs
      // synchronously AFTER spec-generator and BEFORE writeRunRecord so the
      // resulting `adrPaths` lands in the same RunRecord as `specPath`.
      // Deterministic — no LLM call, no token cost. Failures are logged and
      // swallowed (same posture as spec-generator).
      try {
        const adr = processAdrStory({
          projectPath: input.projectPath,
          storyId: input.storyId,
          gitSha,
        });
        if (generatedDocs) {
          generatedDocs.adrPaths = adr.newAdrPaths;
        }
        // v0.40.x I1 — surface the (from → to → adrId) triples on the MCP
        // top-level response so the calling agent can stage + commit the
        // canonical ADR file(s) as a follow-up. Always set (even when
        // empty) so consumers can rely on field presence on story-mode PASS.
        // The data is the same one-pass derivation `processStory` already
        // built — no recomputation here.
        storyEvalAdrCanonicalized = adr.canonicalized;
      } catch (err) {
        console.error(
          `forge_evaluate: adr-extractor failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // v0.38.0 I3 + F4 fix: capture warnings reference for the top-level
      // response. Same array as `generatedDocs.warnings` so the MCP
      // top-level field is byte-identical to the on-disk record. P64
      // producer/consumer seam — both surfaces carry the same warning set.
      if (generatedDocs) {
        storyEvalSpecGenWarnings = generatedDocs.warnings;
      }
    }

    // v0.38.0 B3 — buildInvocationCount lands on metrics when build-dedup
    // fired. The plan only specifies the field for the all-share case; we
    // omit it in mixed-prefix scenarios so legacy consumers that probe
    // `metrics.buildInvocationCount === undefined` still treat that as
    // "no dedup happened".
    if (buildInvocationCount !== undefined) {
      base.metrics.buildInvocationCount = buildInvocationCount;
    }

    // v0.38.0 B5 — totalCostUsd rolled-up: run-level estimatedCostUsd
    // (captured BEFORE spec-gen ran) + spec-gen sub-LLM cost (computed from
    // generatedDocs.genTokens). Omit when run-level cost is null (consumers
    // can't meaningfully sum unknown). When generatedDocs is absent, the
    // spec-gen contribution is 0 and totalCostUsd = estimatedCostUsd.
    let totalCostUsd: number | null | undefined;
    if (base.metrics.estimatedCostUsd !== null && base.metrics.estimatedCostUsd !== undefined) {
      totalCostUsd =
        base.metrics.estimatedCostUsd +
        computeSpecGenCostUsd(generatedDocs?.genTokens);
    } else {
      totalCostUsd = base.metrics.estimatedCostUsd ?? null;
    }

    // v0.38.0 I2 — capture `affectedPaths` snapshot so the dashboard can
    // render per-path ✓/✗ existence indicators without re-parsing the plan.
    const affectedPathsSnapshot = targetStory?.affectedPaths;

    await writeRunRecord(
      input.projectPath,
      {
        ...base,
        storyId: input.storyId,
        evalVerdict: report.verdict,
        // v0.38.0 B2 — top-level `verdict` alias of `evalVerdict`. Same string,
        // additive.
        verdict: report.verdict,
        evalReport: canonicalizeEvalReport(report),
        ...(gitSha ? { gitSha } : {}),
        ...(generatedDocs ? { generatedDocs } : {}),
        ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
        ...(affectedPathsSnapshot && affectedPathsSnapshot.length > 0
          ? { affectedPaths: affectedPathsSnapshot }
          : {}),
      },
      // v0.43.0 (AC-14) — when the caller-action directive flow emitted a
      // runId at brief-build time, pin the run record's filename suffix to
      // it so the caller's follow-up `forge_apply_spec_gen` invocation
      // can locate + append its merge event onto the SAME file.
      storyEvalRunId ? { runId: storyEvalRunId } : undefined,
    );
  }

  // v0.38.0 I3 — surface spec-generator warnings at the top level of the
  // forge_evaluate MCP response. Byte-identical to the on-disk run record's
  // `generatedDocs.warnings` (same array reference at this point — array
  // copy here just to avoid downstream mutation).
  // The `specGenWarnings` field is also set on records that omit
  // `generatedDocs` entirely (non-PASS verdicts, spec-gen failure) — empty
  // array in that case so consumers can rely on field presence.
  const specGenWarnings: SpecGeneratorWarning[] =
    storyEvalSpecGenWarnings ?? [];

  // v0.40.x I1 — surface the canonicalized ADR triples at the top level of
  // the response when story-mode PASS ran the adr-extractor. Field is
  // omitted (not set to []) on non-PASS verdicts so consumers can use
  // field presence as a "did the canonicalizer run?" signal. Coherence-mode
  // and divergence-mode handlers do NOT set this field — see McpResponse
  // type doc.
  //
  // v0.43.1 — merge `callerAction`, `specGenBrief`, and `specGenWarnings`
  // INTO the JSON-stringified `content[0].text` payload alongside the eval
  // report so standard MCP clients (which render `content`, not envelope
  // siblings) can reach them via `JSON.parse(content[0].text)`. The v0.43.0
  // envelope-sibling shape is RETAINED as belt-and-suspenders for any
  // envelope-aware MCP client (same data, both surfaces). Mirrors the
  // working pattern in forge_generate (`server/tools/generate.ts`, live
  // since v0.36.0). Spread order pins eval-report keys (storyId, verdict,
  // criteria, …) FIRST so directive fields never shadow them. See
  // `.ai-workspace/plans/2026-05-11-spec-gen-directive-mcp-content-surfacing.md`
  // and AC-11 live smoke run record
  // `monday-bot/.forge/runs/forge_evaluate-2026-05-11T09-34-10-439Z-bc5b.json`.
  const contentPayload: Record<string, unknown> = {
    ...report,
    specGenWarnings,
  };
  if (storyEvalCallerAction !== undefined) {
    contentPayload.callerAction = storyEvalCallerAction;
  }
  if (storyEvalSpecGenBrief !== undefined) {
    contentPayload.specGenBrief = storyEvalSpecGenBrief;
  }

  const response: McpResponse = {
    content: [{ type: "text", text: JSON.stringify(contentPayload, null, 2) }],
    specGenWarnings,
  };
  if (storyEvalAdrCanonicalized !== undefined) {
    response.adrCanonicalized = storyEvalAdrCanonicalized;
  }
  // v0.43.0 — surface the caller-action directive + brief on the response
  // envelope when the new path emitted them. Absent on the legacy path,
  // non-PASS verdicts, and hand-author short-circuits. Retained at v0.43.1
  // as belt-and-suspenders alongside the content-payload surface above.
  if (storyEvalCallerAction !== undefined) {
    response.callerAction = storyEvalCallerAction;
  }
  if (storyEvalSpecGenBrief !== undefined) {
    response.specGenBrief = storyEvalSpecGenBrief;
  }
  return response;
}

// ── Coherence Mode Handler ────────────────────────────────

async function handleCoherenceEval(
  input: EvaluateInput,
): Promise<McpResponse> {
  if (!input.prdContent) {
    return {
      content: [
        {
          type: "text",
          text: "forge_evaluate error: prdContent is required for coherence mode",
        },
      ],
      isError: true,
    };
  }

  const stages = ["coherence-eval"];
  const ctx = new RunContext({
    toolName: "forge_evaluate",
    projectPath: input.projectPath,
    stages,
  });

  const startTime = Date.now();

  try {
    const system = buildCoherenceEvalPrompt();
    const userMessage = buildCoherenceEvalUserMessage({
      prdContent: input.prdContent,
      masterPlanContent: input.masterPlanContent,
      phasePlans: input.phasePlans,
    });

    const result = await trackedCallClaude(ctx, "coherence-eval", "coherence-evaluator", {
      system,
      messages: [{ role: "user", content: userMessage }],
      jsonMode: true,
    });

    const parsed = result.parsed as Record<string, unknown>;

    // Validate the response structure
    const gaps = Array.isArray(parsed.gaps) ? parsed.gaps as CoherenceGap[] : [];

    // Mechanical spec-vocabulary-drift check (F-03 secondary, PH-04 US-05).
    // Runs alongside LLM coherence — zero LLM calls, pure regex matching.
    if (input.prdContent && input.projectPath) {
      try {
        const sourceDirs = [
          join(input.projectPath, "server", "types"),
          join(input.projectPath, "server", "lib"),
        ];
        const driftResults = await verifySpecVocabularyFromContent(input.prdContent, sourceDirs);
        const unknownFields = driftResults.filter((r) => r.kind === "unknown-field");
        let vocabIdx = 1;
        for (const drift of unknownFields) {
          gaps.push({
            id: `VOCAB-${vocabIdx++}`,
            severity: "MAJOR",
            sourceDocument: "prd",
            targetDocument: "phasePlan",
            description: `spec-vocabulary-drift: PRD references \`${drift.type}.${drift.field}\` (line ${drift.line}) but field '${drift.field}' does not exist on type '${drift.type}'`,
            missingRequirement: `Type ${drift.type} has no field named '${drift.field}' — possible vocabulary drift from an older spec revision`,
          });
        }
      } catch (err) {
        console.error(
          `forge_evaluate: spec-vocabulary-check failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const summary =
      typeof parsed.summary === "string"
        ? parsed.summary
        : `Found ${gaps.length} gap(s)`;

    const report: CoherenceReport = {
      evaluationMode: "coherence",
      status: "complete",
      gaps,
      summary,
    };

    // Write run record if projectPath available
    if (input.projectPath) {
      await writeRunRecord(
        input.projectPath,
        buildRunRecord(ctx, startTime, gaps.length),
      );
    }

    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  } catch (err) {
    // Graceful degradation per plan D4: warn and return empty findings
    const message = err instanceof Error ? err.message : String(err);
    console.error(`forge_evaluate: coherence eval failed: ${message}`);

    const report: CoherenceReport = {
      evaluationMode: "coherence",
      status: "eval-failed",
      gaps: [],
      summary: `Coherence evaluation failed: ${message}`,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  }
}

// ── Divergence Mode Handler ───────────────────────────────

async function handleDivergenceEval(
  input: EvaluateInput,
): Promise<McpResponse> {
  if (!input.planPath && !input.planJson) {
    return {
      content: [
        {
          type: "text",
          text: "forge_evaluate error: planPath or planJson is required for divergence mode",
        },
      ],
      isError: true,
    };
  }

  const stages = ["forward-eval", "reverse-eval"];
  const ctx = new RunContext({
    toolName: "forge_evaluate",
    projectPath: input.projectPath,
    stages,
  });

  const startTime = Date.now();

  // ── Forward divergence: mechanical AC failures ──
  const plan = loadPlan(input.planPath, input.planJson);
  const forwardDivergences: ForwardDivergence[] = [];

  ctx.progress.begin("forward-eval");
  for (const story of plan.stories) {
    try {
      const report = await evaluateStory(plan, story.id, {
        timeoutMs: input.timeoutMs,
        cwd: input.projectPath,
      });
      for (const criterion of report.criteria) {
        if (criterion.status === "FAIL" || criterion.status === "INCONCLUSIVE") {
          forwardDivergences.push({
            storyId: story.id,
            acId: criterion.id,
            status: criterion.status,
            evidence: criterion.evidence,
            reliability: criterion.reliability,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      forwardDivergences.push({
        storyId: story.id,
        acId: "EVAL-ERROR",
        status: "INCONCLUSIVE",
        evidence: `Evaluation error: ${message}`,
      });
    }
  }
  ctx.progress.complete("forward-eval");

  // ── Reverse divergence: LLM-judged unplanned capabilities ──
  let reverseDivergences: ReverseDivergence[] = [];
  let reverseSummary = "No codebase context available for reverse divergence scan.";

  if (input.reverseFindings) {
    // Pre-computed reverse findings from the calling session (architectural split:
    // session does LLM judgment, MCP does mechanical validation).
    // When provided, replaces the LLM reverse scan entirely.
    ctx.progress.begin("reverse-eval");
    try {
      const parsed = JSON.parse(input.reverseFindings);
      if (!Array.isArray(parsed)) {
        throw new Error("reverseFindings must be a JSON array");
      }

      const VALID_CLASSIFICATIONS = new Set([
        "method-divergence",
        "extra-functionality",
        "scope-creep",
      ]);
      const REQUIRED_FIELDS = ["description", "location", "classification", "alignsWithPrd"] as const;

      for (const item of parsed) {
        for (const field of REQUIRED_FIELDS) {
          if (item[field] === undefined || item[field] === null) {
            throw new Error(`reverseFindings item missing required field: ${field}`);
          }
        }
        if (!VALID_CLASSIFICATIONS.has(item.classification)) {
          throw new Error(
            `reverseFindings item has invalid classification "${item.classification}". ` +
              `Must be one of: ${[...VALID_CLASSIFICATIONS].join(", ")}`,
          );
        }
        if (typeof item.alignsWithPrd !== "boolean") {
          throw new Error(
            `reverseFindings item "${item.id ?? "(unknown)"}" has non-boolean alignsWithPrd: ${typeof item.alignsWithPrd}`,
          );
        }
        // Overwrite id with a deterministic hash so cross-run diffs stay meaningful.
        item.id = computeReverseFindingId(
          String(item.location),
          String(item.classification),
          String(item.description),
        );
      }

      reverseDivergences = parsed as ReverseDivergence[];
      reverseSummary = `${reverseDivergences.length} pre-computed reverse finding(s) from caller`;
      ctx.progress.complete("reverse-eval");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`forge_evaluate: reverseFindings parse failed: ${message}`);
      reverseSummary = `reverseFindings parse failed: ${message}`;
      ctx.progress.fail("reverse-eval");
    }
  } else if (input.projectPath) {
    try {
      const codebaseSummary = await scanCodebase(input.projectPath);
      const system = buildDivergenceEvalPrompt();
      const planContent = input.planJson ?? readFileSync(input.planPath!, "utf-8");
      const userMessage = buildDivergenceEvalUserMessage({
        planContent,
        codebaseSummary,
        prdContent: input.prdContent,
      });

      const result = await trackedCallClaude(
        ctx,
        "reverse-eval",
        "divergence-evaluator",
        {
          system,
          messages: [{ role: "user", content: userMessage }],
          jsonMode: true,
        },
      );

      const parsed = result.parsed as Record<string, unknown>;
      reverseDivergences = Array.isArray(parsed.reverse)
        ? (parsed.reverse as ReverseDivergence[])
        : [];
      reverseSummary =
        typeof parsed.summary === "string"
          ? parsed.summary
          : `Found ${reverseDivergences.length} reverse divergence(s)`;
    } catch (err) {
      // Graceful degradation: warn and return empty reverse findings
      const message = err instanceof Error ? err.message : String(err);
      console.error(`forge_evaluate: reverse divergence scan failed: ${message}`);
      reverseSummary = `Reverse divergence scan failed: ${message}`;
    }
  } else {
    ctx.progress.skip("reverse-eval");
  }

  const totalDivergences = forwardDivergences.length + reverseDivergences.length;

  // Q0.5/A3 — split forward count by reliability so analytics can separate
  // real failures (trusted) from suspect (ac-lint short-circuit) and
  // unverified (fired lintExempt override). Undefined reliability is
  // treated as "trusted" for backward compatibility with pre-A3 reports.
  let trustedCount = 0;
  let suspectCount = 0;
  let unverifiedCount = 0;
  for (const fd of forwardDivergences) {
    if (fd.reliability === "suspect") suspectCount++;
    else if (fd.reliability === "unverified") unverifiedCount++;
    else trustedCount++;
  }

  const report: DivergenceReport = {
    evaluationMode: "divergence",
    status: "complete",
    forward: forwardDivergences,
    reverse: reverseDivergences,
    selfHealingCycles: 0, // incremented by calling agent across invocations
    maxCyclesReached: false, // set by calling agent based on cycle count vs max
    summary:
      `Forward: ${forwardDivergences.length} AC failure(s) ` +
      `(${trustedCount} trusted / ${suspectCount} suspect / ${unverifiedCount} unverified). ` +
      `Reverse: ${reverseDivergences.length} unplanned capability(ies). ` +
      reverseSummary,
  };

  // Write run record if projectPath available
  if (input.projectPath) {
    await writeRunRecord(
      input.projectPath,
      buildRunRecord(ctx, startTime, totalDivergences),
    );
  }

  return {
    content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
  };
}

// ── Smoke-Test Mode Handler ───────────────────────────────

/**
 * Q0.5/B1 — smoke-test handler. Exact identifier `handleSmokeTest` is
 * load-bearing: `scripts/smoke-gate-check.sh` detects the bootstrap-exempt
 * state by grepping for `^export function handleSmokeTest\b` on both master
 * and HEAD. Do NOT rename, do NOT inline — the structural signal is the
 * presence of this function.
 *
 * Sidecar write contract: if `planPath` is supplied AND ends in `.json`, the
 * report is written to `{planPath}.replace(/\.json$/, ".smoke.json")`. If
 * planPath is missing (inline `planJson` case) or lacks the `.json` suffix,
 * the write is a no-op and the report is returned in-band only.
 */
export async function handleSmokeTest(
  input: EvaluateInput,
): Promise<McpResponse> {
  const plan = loadPlan(input.planPath, input.planJson);
  const report = await smokeTestPlan(plan, {
    cwd: input.projectPath,
  });

  // Sidecar write — only when we have a real `.json` path on disk.
  if (input.planPath) {
    if (/\.json$/.test(input.planPath)) {
      const sidecarPath = input.planPath.replace(/\.json$/, ".smoke.json");
      try {
        // Sort entries by acId for byte-stable output — two runs of the
        // same plan produce byte-identical sidecar files. 2-space indent
        // matches the rest of the repo's JSON conventions.
        const sorted = {
          ...report,
          entries: [...report.entries].sort((a, b) =>
            a.acId.localeCompare(b.acId),
          ),
        };
        writeFileSync(sidecarPath, JSON.stringify(sorted, null, 2));
      } catch (err) {
        // Defensive: sidecar write failure should not break the in-band
        // response — the caller still needs the report.
        console.error(
          `forge_evaluate(smoke-test): sidecar write to ${sidecarPath} failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      console.error(
        `forge_evaluate(smoke-test): planPath "${input.planPath}" does not end in .json; skipping sidecar write`,
      );
    }
  }

  return {
    content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
  };
}

// ── Critic Mode Handler ───────────────────────────────────

/**
 * Q0.5/C1 — critic eval mode. Loads N plan files, fans out N critic prompt
 * calls via `trackedCallClaude`, aggregates findings into a `CriticEvalReport`.
 *
 * Per-plan failure tolerance: if a single plan fails to read, parse, or the
 * LLM call errors, the corresponding result carries an `error` field with
 * `findings: []`; the overall run continues with the remaining plans. Mirrors
 * the coherence-eval graceful-degradation pattern.
 *
 * No new prompt files: reuses `buildCriticPrompt(1)` + `buildCriticUserMessage`
 * from `server/lib/prompts/critic.ts` (same prompt that forge_plan uses for
 * its internal round-1 critique).
 */
async function handleCriticEval(input: EvaluateInput): Promise<McpResponse> {
  const ctx = new RunContext({
    toolName: "forge_evaluate",
    projectPath: input.projectPath,
    stages: ["critic-eval"],
  });
  const startTime = Date.now();

  // Resolve plan paths: explicit list, or glob `.ai-workspace/plans/*.json`
  // under projectPath (BUG-DIV-CWD fix from PR #151: honor projectPath, not cwd).
  let resolvedPaths: string[];
  if (input.planPaths && input.planPaths.length > 0) {
    resolvedPaths = input.planPaths;
  } else {
    const root = input.projectPath ?? process.cwd();
    const plansDir = join(root, ".ai-workspace", "plans");
    try {
      resolvedPaths = (readdirSync(plansDir, { recursive: true }) as string[])
        .filter((f) => f.endsWith(".json"))
        .map((f) => join(plansDir, f))
        .sort();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `forge_evaluate(critic) error: could not read ${plansDir}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  const results: CriticEvalReport["results"] = [];

  for (const planPath of resolvedPaths) {
    try {
      const planJson = readFileSync(planPath, "utf-8");
      // Parse-validate: a non-JSON plan file is a per-plan failure, not a crash.
      JSON.parse(planJson);

      const system = buildCriticPrompt(1);
      const userMessage = buildCriticUserMessage(planJson);
      const result = await trackedCallClaude(ctx, "critic-eval", "critic", {
        system,
        messages: [{ role: "user", content: userMessage }],
        jsonMode: true,
      });

      const parsed = result.parsed;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("critic response was not a JSON object");
      }
      const findings = Array.isArray((parsed as Record<string, unknown>).findings)
        ? ((parsed as Record<string, unknown>).findings as unknown[])
        : [];
      results.push({ planPath, findings });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `forge_evaluate(critic): ${planPath} failed (continuing): ${message}`,
      );
      results.push({ planPath, findings: [], error: message });
    }
  }

  const report: CriticEvalReport = {
    evaluationMode: "critic",
    results,
  };

  if (input.projectPath) {
    const findingsTotal = results.reduce(
      (n, r) => n + r.findings.length,
      0,
    );
    const base = buildRunRecord(ctx, startTime, findingsTotal);
    const outcome = results.every((r) => r.error)
      ? "failure"
      : results.some((r) => r.error)
        ? "partial"
        : "success";
    await writeRunRecord(input.projectPath, {
      ...base,
      outcome,
      criticReport: report,
    });
  }

  return {
    content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
  };
}

// ── Main Router ───────────────────────────────────────────

export async function handleEvaluate(input: EvaluateInput): Promise<McpResponse> {
  const mode = input.evaluationMode ?? "story";

  // v0.40.2 — wake the dashboard render loop on tool entry. Idempotent:
  // if the loop is already running for this projectPath this is a no-op.
  // Uses input.projectPath when provided; otherwise falls back to the
  // boot-registered default. See `dashboard-render-loop.ts` for the gate
  // contract and AC-6 for the call-expression invariant.
  notifyForgeStateWrite(input.projectPath);

  try {
    switch (mode) {
      case "story":
        return await handleStoryEval(input);
      case "coherence":
        return await handleCoherenceEval(input);
      case "divergence":
        return await handleDivergenceEval(input);
      case "smoke-test":
        return await handleSmokeTest(input);
      case "critic":
        return await handleCriticEval(input);
      default:
        return {
          content: [
            {
              type: "text",
              text: `forge_evaluate error: unknown evaluationMode "${mode}"`,
            },
          ],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `forge_evaluate error: ${message}` }],
      isError: true,
    };
  }
}
