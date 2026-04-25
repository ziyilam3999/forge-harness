// v0.36.0 Phase D (AC-D5/D6) — contract harvester.
//
// Imports `ToolInputSchemaShape` from each `server/tools/*.ts` and emits a
// deterministic per-tool record. Used by:
//   - server/tools/contract-convention.test.ts (AC-D6 — convention guard)
//   - ai-brain/skills/project-index/lib/contract-harvester.mjs (AC-D2/D3 —
//     scaffold + drift detection)
//
// Why this exists. The MCP registration sites in `server/index.ts` pass
// Zod *literal-object* shapes (not full `z.object(...)` schemas) into
// `server.registerTool`. That means there is no single runtime symbol the
// harvester can introspect after registration — the schema only exists at
// the registration call site. Adding a parallel named export per tool gives
// us a stable import target without changing MCP behaviour.

import { z } from "zod";

import { ToolInputSchemaShape as coordinateShape } from "../tools/coordinate.js";
import { ToolInputSchemaShape as declareStoryShape } from "../tools/declare-story.js";
import { ToolInputSchemaShape as evaluateShape } from "../tools/evaluate.js";
import { ToolInputSchemaShape as generateShape } from "../tools/generate.js";
import { ToolInputSchemaShape as lintRefreshShape } from "../tools/lint-refresh.js";
import { ToolInputSchemaShape as planShape } from "../tools/plan.js";
import { ToolInputSchemaShape as reconcileShape } from "../tools/reconcile.js";
import { ToolInputSchemaShape as statusShape } from "../tools/status.js";

export type ZodRawShape = Record<string, z.ZodTypeAny>;

export interface ContractField {
  /** Field name as it appears at the MCP boundary. */
  name: string;
  /** True if the field is `.optional()` (or wrapped in `z.optional`). */
  optional: boolean;
  /** Coarse type label for drift detection (string|number|boolean|object|array|enum|record|union|unknown). */
  typeLabel: string;
}

export interface ToolContract {
  /** Canonical tool name as registered with `server.registerTool`. */
  toolName: string;
  /** The raw shape object — for callers that want full Zod access. */
  schemaShape: ZodRawShape;
  /** Stable, sorted list of field summaries for cheap diffing + scaffold rendering. */
  fields: ContractField[];
}

/**
 * Best-effort type label for a Zod type. Coarse on purpose: the goal is
 * drift detection (field removed, type narrowed), not full schema dump.
 */
export function zodTypeLabel(t: z.ZodTypeAny): string {
  // Unwrap optional / nullable / default chains so we get the inner type.
  let inner: z.ZodTypeAny = t;
  // Defensive loop — Zod chains can wrap several layers (default(optional(string()))).
  for (let depth = 0; depth < 6; depth++) {
    const def = (inner as { _def?: { typeName?: string; innerType?: z.ZodTypeAny } })._def;
    if (!def) break;
    if (def.typeName === "ZodOptional" && def.innerType) {
      inner = def.innerType;
      continue;
    }
    if (def.typeName === "ZodNullable" && def.innerType) {
      inner = def.innerType;
      continue;
    }
    if (def.typeName === "ZodDefault" && def.innerType) {
      inner = def.innerType;
      continue;
    }
    break;
  }

  const def = (inner as { _def?: { typeName?: string } })._def;
  const tn = def?.typeName ?? "ZodUnknown";
  switch (tn) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return "array";
    case "ZodObject":
      return "object";
    case "ZodEnum":
    case "ZodNativeEnum":
      return "enum";
    case "ZodRecord":
      return "record";
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return "union";
    case "ZodLiteral":
      return "literal";
    case "ZodAny":
      return "any";
    case "ZodUnknown":
      return "unknown";
    default:
      return tn.replace(/^Zod/, "").toLowerCase();
  }
}

function isOptional(t: z.ZodTypeAny): boolean {
  // Walk the chain: optional or default-with-optional-inner counts as optional
  // at the wire boundary (MCP treats default as "may be omitted").
  let cur: z.ZodTypeAny = t;
  for (let depth = 0; depth < 6; depth++) {
    const def = (cur as { _def?: { typeName?: string; innerType?: z.ZodTypeAny } })._def;
    if (!def) return false;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") {
      return true;
    }
    if (def.typeName === "ZodNullable" && def.innerType) {
      cur = def.innerType;
      continue;
    }
    break;
  }
  return false;
}

export function summarizeShape(shape: ZodRawShape): ContractField[] {
  const out: ContractField[] = [];
  for (const name of Object.keys(shape).sort()) {
    const t = shape[name];
    out.push({
      name,
      optional: isOptional(t),
      typeLabel: zodTypeLabel(t),
    });
  }
  return out;
}

/**
 * Stable, deterministic enumeration of all 8 registered MCP tools and their
 * input schemas. Order is alphabetical by toolName so two harvests against
 * the same code produce byte-identical outputs.
 */
export function harvestToolContracts(): ToolContract[] {
  const raw: Array<{ toolName: string; schemaShape: ZodRawShape }> = [
    { toolName: "forge_coordinate", schemaShape: coordinateShape as ZodRawShape },
    { toolName: "forge_declare_story", schemaShape: declareStoryShape as ZodRawShape },
    { toolName: "forge_evaluate", schemaShape: evaluateShape as ZodRawShape },
    { toolName: "forge_generate", schemaShape: generateShape as ZodRawShape },
    { toolName: "forge_lint_refresh", schemaShape: lintRefreshShape as ZodRawShape },
    { toolName: "forge_plan", schemaShape: planShape as ZodRawShape },
    { toolName: "forge_reconcile", schemaShape: reconcileShape as ZodRawShape },
    { toolName: "forge_status", schemaShape: statusShape as ZodRawShape },
  ];
  return raw
    .sort((a, b) => a.toolName.localeCompare(b.toolName))
    .map((r) => ({
      toolName: r.toolName,
      schemaShape: r.schemaShape,
      fields: summarizeShape(r.schemaShape),
    }));
}

/**
 * Render a Markdown row per tool for the API-CONTRACTS scaffold.
 * Format: `| forge_x | required-field-1, required-field-2 | optional-field-1?, optional-field-2? |`
 *
 * Stable: alphabetical fields, deterministic separator, no LLM.
 */
export function contractToScaffoldRow(c: ToolContract): string {
  const required = c.fields.filter((f) => !f.optional).map((f) => `${f.name}:${f.typeLabel}`);
  const optional = c.fields.filter((f) => f.optional).map((f) => `${f.name}:${f.typeLabel}?`);
  const reqStr = required.length ? required.join(", ") : "(none)";
  const optStr = optional.length ? optional.join(", ") : "(none)";
  return `| \`${c.toolName}\` | ${reqStr} | ${optStr} |`;
}

/** Top-of-file banner mandated by AC-D4 (verbatim). */
export const AGENT_FIRST_BANNER =
  "<!-- agent-first: this document is authored for AI-agent consumption. Stable keys, structured sections, no prose narrative. -->";

/**
 * Render the full scaffold body for `docs/generated/API-CONTRACTS.md`.
 * One row per registered tool, plus the agent-first banner.
 */
export function renderContractsScaffold(contracts: ToolContract[]): string {
  const rows = contracts.map(contractToScaffoldRow);
  return [
    AGENT_FIRST_BANNER,
    "",
    "# API Contracts",
    "",
    "Auto-generated by `/project-index` from `server/tools/*.ts` `ToolInputSchemaShape` exports.",
    "Each row enumerates one registered MCP tool's input contract.",
    "",
    "| Tool | Required fields | Optional fields |",
    "|------|-----------------|-----------------|",
    ...rows,
    "",
  ].join("\n");
}
