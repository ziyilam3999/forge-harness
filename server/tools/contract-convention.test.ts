// v0.36.0 Phase D — AC-D6: tool input-schema convention guard.
//
// Asserts: for every registered MCP tool, `ToolInputSchemaShape` (the named
// export the contract-harvester imports) is functionally equivalent to the
// schema actually passed to `server.registerTool`. We prove this by feeding
// a fixture set of valid + invalid inputs into both paths and asserting
// identical accept/reject verdicts.
//
// Per AC-D6 wording: "the test imports both, runs them through `safeParse`
// against a fixture set of valid + invalid inputs per tool, and asserts
// identical accept/reject verdicts."
//
// Implementation note: each tool's `ToolInputSchemaShape` is a named alias
// for the same object passed to `server.registerTool` — they reference one
// runtime literal, so equivalence holds by construction. The test still
// runs real `safeParse` calls so the AC's "functional equivalence via
// safeParse" requirement is observable in test output, not just claimed.

import { describe, expect, test } from "vitest";
import { z, type ZodRawShape } from "zod";

// Registration-site schemas (what `server/index.ts` passes to registerTool).
import { coordinateInputSchema } from "./coordinate.js";
import { declareStoryInputSchema } from "./declare-story.js";
import { evaluateInputSchema } from "./evaluate.js";
import { generateInputSchema } from "./generate.js";
import { lintRefreshInputSchema } from "./lint-refresh.js";
import { planInputSchema } from "./plan.js";
import { reconcileInputSchema } from "./reconcile.js";
import { statusInputSchema } from "./status.js";

// Harvester-import path (what AC-D5's named export resolves to).
import {
  ToolInputSchemaShape as coordinateExport,
} from "./coordinate.js";
import {
  ToolInputSchemaShape as declareStoryExport,
} from "./declare-story.js";
import {
  ToolInputSchemaShape as evaluateExport,
} from "./evaluate.js";
import {
  ToolInputSchemaShape as generateExport,
} from "./generate.js";
import {
  ToolInputSchemaShape as lintRefreshExport,
} from "./lint-refresh.js";
import {
  ToolInputSchemaShape as planExport,
} from "./plan.js";
import {
  ToolInputSchemaShape as reconcileExport,
} from "./reconcile.js";
import {
  ToolInputSchemaShape as statusExport,
} from "./status.js";

type ToolEntry = {
  toolName: string;
  registrationSite: ZodRawShape;
  namedExport: ZodRawShape;
  /** At least one valid fixture (must accept). */
  valid: unknown[];
  /** At least one invalid fixture (must reject). */
  invalid: unknown[];
};

// Inline fixtures — one valid + one invalid per tool. Required fields are
// derived from each tool's ts source (read at plan time, not at runtime).
const TOOLS: ToolEntry[] = [
  {
    toolName: "forge_coordinate",
    registrationSite: coordinateInputSchema as ZodRawShape,
    namedExport: coordinateExport as ZodRawShape,
    valid: [
      { planPath: "/p/plan.json", phaseId: "PH-01" },
      { planPath: "/p/plan.json", phaseId: "PH-01", budgetUsd: 10, maxTimeMs: 60000 },
    ],
    invalid: [
      { phaseId: "PH-01" }, // missing planPath
      { planPath: "/p/plan.json", phaseId: "PH-01", budgetUsd: -1 }, // negative budget
    ],
  },
  {
    toolName: "forge_declare_story",
    registrationSite: declareStoryInputSchema as ZodRawShape,
    namedExport: declareStoryExport as ZodRawShape,
    valid: [
      { storyId: "US-03" },
      { storyId: "US-03", phaseId: "PH-02" },
    ],
    invalid: [
      {}, // missing storyId
      { storyId: "" }, // empty storyId
    ],
  },
  {
    toolName: "forge_evaluate",
    registrationSite: evaluateInputSchema as ZodRawShape,
    namedExport: evaluateExport as ZodRawShape,
    valid: [
      // All fields are optional in evaluateInputSchema — empty object passes.
      {},
      { evaluationMode: "story", storyId: "US-01" },
    ],
    invalid: [
      { evaluationMode: "not-a-real-mode" }, // bad enum value
      { timeoutMs: -5 }, // negative timeout
    ],
  },
  {
    toolName: "forge_generate",
    registrationSite: generateInputSchema as ZodRawShape,
    namedExport: generateExport as ZodRawShape,
    valid: [
      { storyId: "US-01" },
      { storyId: "US-01", iteration: 0, maxIterations: 3 },
    ],
    invalid: [
      {}, // missing storyId
      { storyId: "US-01", iteration: -1 }, // negative iteration
    ],
  },
  {
    toolName: "forge_lint_refresh",
    registrationSite: lintRefreshInputSchema as ZodRawShape,
    namedExport: lintRefreshExport as ZodRawShape,
    valid: [
      { planPath: "/p/plan.json" },
      { planPath: "/p/plan.json", force: true },
    ],
    invalid: [
      {}, // missing planPath
      { planPath: 123 }, // wrong type
    ],
  },
  {
    toolName: "forge_plan",
    registrationSite: planInputSchema as ZodRawShape,
    namedExport: planExport as ZodRawShape,
    valid: [
      { intent: "Build a thing" },
      { intent: "Build a thing", mode: "feature", tier: "thorough" },
    ],
    invalid: [
      {}, // missing intent
      { intent: "ok", mode: "not-a-mode" }, // bad enum
    ],
  },
  {
    toolName: "forge_reconcile",
    registrationSite: reconcileInputSchema as ZodRawShape,
    namedExport: reconcileExport as ZodRawShape,
    valid: [
      {
        projectPath: "/p",
        replanningNotes: [],
        masterPlanPath: "master.json",
        phasePlanPaths: { "PH-01": "phase-1.json" },
        currentMasterPlan: "{}",
        currentPhasePlans: { "PH-01": "{}" },
      },
    ],
    invalid: [
      // missing required masterPlanPath
      {
        projectPath: "/p",
        replanningNotes: [],
        phasePlanPaths: {},
        currentMasterPlan: "{}",
        currentPhasePlans: {},
      },
      // bad replanning-note category
      {
        projectPath: "/p",
        replanningNotes: [{ category: "not-a-category", severity: "blocking", description: "x" }],
        masterPlanPath: "master.json",
        phasePlanPaths: {},
        currentMasterPlan: "{}",
        currentPhasePlans: {},
      },
    ],
  },
  {
    toolName: "forge_status",
    registrationSite: statusInputSchema as ZodRawShape,
    namedExport: statusExport as ZodRawShape,
    valid: [
      {},
      { scope: { storyId: "US-03" }, since: "2026-04-25T00:00:00Z" },
    ],
    invalid: [
      { since: 12345 }, // wrong type
      { scope: { storyId: 999 } }, // wrong nested type
    ],
  },
];

describe("v0.36.0 Phase D · AC-D6 · tool input-schema convention", () => {
  test("ToolInputSchemaShape is functionally equivalent to the registration-site schema for every registered MCP tool", () => {
    expect(TOOLS).toHaveLength(8); // matches server/index.ts registerTool count

    for (const tool of TOOLS) {
      const fromSite = z.object(tool.registrationSite);
      const fromExport = z.object(tool.namedExport);

      // Each fixture must produce identical accept/reject verdicts on both paths.
      for (const v of tool.valid) {
        const a = fromSite.safeParse(v);
        const b = fromExport.safeParse(v);
        expect(
          a.success,
          `[${tool.toolName}] valid fixture rejected by registration-site schema: ${JSON.stringify(v)}`,
        ).toBe(true);
        expect(
          b.success,
          `[${tool.toolName}] valid fixture rejected by ToolInputSchemaShape: ${JSON.stringify(v)}`,
        ).toBe(true);
        expect(a.success, `[${tool.toolName}] verdict mismatch on ${JSON.stringify(v)}`).toBe(b.success);
      }
      for (const v of tool.invalid) {
        const a = fromSite.safeParse(v);
        const b = fromExport.safeParse(v);
        expect(
          a.success,
          `[${tool.toolName}] invalid fixture accepted by registration-site schema: ${JSON.stringify(v)}`,
        ).toBe(false);
        expect(
          b.success,
          `[${tool.toolName}] invalid fixture accepted by ToolInputSchemaShape: ${JSON.stringify(v)}`,
        ).toBe(false);
        expect(a.success, `[${tool.toolName}] verdict mismatch on ${JSON.stringify(v)}`).toBe(b.success);
      }
    }
  });
});
