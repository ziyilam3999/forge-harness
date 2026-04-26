import { z } from "zod";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";

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
  type RunRecord,
  type CriticEvalReport,
} from "../lib/run-record.js";
import { generateSpecForStory } from "../lib/spec-generator.js";
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
  const report = await evaluateStory(plan, input.storyId, {
    timeoutMs: input.timeoutMs,
    cwd: input.projectPath,
  });

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

    // v0.36.0 Phase B (AC-B1..B6): synchronously generate or update the
    // story's section in `docs/generated/TECHNICAL-SPEC.md`. Mandated sync
    // (plan §122) so the file exists by the time forge_evaluate returns.
    // Failures are logged and swallowed — a doc-gen hiccup MUST NOT mask
    // the underlying eval verdict (analogous to the dashboard hooks in
    // `writeRunRecord`).
    let generatedDocs: NonNullable<RunRecord["generatedDocs"]> | undefined;
    if (report.verdict === "PASS") {
      try {
        // v0.36.x grounding: surface the story's affectedPaths to the
        // spec-generator so it can extract a source-vocabulary and ground
        // the LLM. Empty/missing → spec-generator falls back to "(none)".
        const story = plan.stories.find((s) => s.id === input.storyId);
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
        };
      } catch (err) {
        console.error(
          `forge_evaluate: spec-generator failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
        );
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
        } else if (adr.newAdrPaths.length > 0) {
          // spec-generator failed but ADR-extractor produced canonical files.
          // Synthesise a minimal generatedDocs so the ADR work is still
          // surfaced on the RunRecord. Empty adrPaths here means "nothing
          // to record" — leave generatedDocs undefined so the existing
          // contract holds (a spec-gen failure with no ADRs ⇒ no
          // generatedDocs field).
          generatedDocs = {
            specPath: "",
            adrPaths: adr.newAdrPaths,
            genTimestamp: new Date().toISOString(),
            genTokens: { inputTokens: 0, outputTokens: 0 },
            contracts: [],
            warnings: [],
          };
        }
      } catch (err) {
        console.error(
          `forge_evaluate: adr-extractor failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await writeRunRecord(input.projectPath, {
      ...base,
      storyId: input.storyId,
      evalVerdict: report.verdict,
      evalReport: canonicalizeEvalReport(report),
      ...(gitSha ? { gitSha } : {}),
      ...(generatedDocs ? { generatedDocs } : {}),
    });
  }

  return {
    content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
  };
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
