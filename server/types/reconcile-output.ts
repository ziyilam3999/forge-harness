import type { ReplanningNote } from "./coordinate-result.js";

export type ReconcileStatus = "success" | "halted" | "no-op" | "partial";

export interface ReconcileOperation {
  route: "master-update" | "phase-update";
  affectedPhases?: string[];
  noteIds: number[]; // indices of notes in the input batch that drove this op
  planPathWritten: string; // absolute or repo-relative path
}

export interface ReconcileConflict {
  noteIndex: number;
  conflictingCategories: string[];
  winningCategory: string;
}

export interface ReconcileOutput {
  status: ReconcileStatus;
  operations: ReconcileOperation[];
  deferredNotes: ReplanningNote[]; // gap-found notes
  conflicts: ReconcileConflict[];
  haltedOnNoteId?: number; // note index (deterministic order); only set when status=halted
  rewriteCount: number; // total plan files written (0 when halted or no-op)
  timestamp: string; // ISO-8601
  errors?: string[];
}
