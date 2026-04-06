/**
 * MasterPlan — the "chapter list" tier of the three-tier document system.
 * Generated from a PRD/vision doc by forge_plan(documentTier: "master").
 * Each phase later expands into a full ExecutionPlan via forge_plan(documentTier: "phase").
 *
 * Schema versions are per-type and independent — MasterPlan 1.0.0 coexists
 * with ExecutionPlan 3.0.0 in the same run.
 */

export interface MasterPlan {
  schemaVersion: "1.0.0";
  documentTier: "master";
  title: string;
  summary: string; // 1-3 sentence description of the overall approach
  phases: Phase[];
  crossCuttingConcerns?: string[];
}

export interface Phase {
  id: string; // PH-01, PH-02, etc.
  title: string;
  description: string;
  dependencies: string[]; // required — empty array if no deps
  inputs: string[]; // required — empty array if none
  outputs: string[]; // required — empty array if none
  estimatedStories: number;
}
