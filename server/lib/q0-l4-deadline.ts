/**
 * Q0/L4 Deadline Watchdog — pure evaluation logic.
 *
 * Reads a parsed q0-l4-anchor.json object and a "now" Date, returns the
 * deadline status. The YAML workflow thin-wraps this function; unit tests
 * invoke it directly with fake dates.
 */

export interface Q0L4Anchor {
  q0MergeSha?: string;
  q0MergedAt?: string;
  q0PrNumber?: number;
  q0FillMode?: string;
  q0AnchorCreatedAt?: string;
  q0L4ProvenBy?: string | null;
}

export type Q0L4Status =
  | "skipped-no-anchor"
  | "skipped-anchor-incomplete"
  | "proven"
  | "in-grace-period"
  | "overdue";

export interface Q0L4Evaluation {
  status: Q0L4Status;
  ageDays?: number;
}

export const Q0_L4_GRACE_DAYS = 14;

/**
 * Evaluate a Q0/L4 anchor against a given "now" Date.
 *
 * Precedence:
 *   1. null/undefined anchor -> skipped-no-anchor
 *   2. q0MergedAt === "PENDING" AND q0FillMode !== "bootstrap" -> skipped-anchor-incomplete
 *   3. q0L4ProvenBy set (non-null, non-empty) -> proven
 *   4. age < 14 days -> in-grace-period
 *   5. age >= 14 days -> overdue
 */
export function evaluateAnchorState(
  anchor: Q0L4Anchor | null | undefined,
  now: Date,
): Q0L4Evaluation {
  if (anchor == null) {
    return { status: "skipped-no-anchor" };
  }

  const fillMode = anchor.q0FillMode ?? "workflow-fill";
  const mergedAt = anchor.q0MergedAt;

  if (mergedAt === "PENDING" && fillMode !== "bootstrap") {
    return { status: "skipped-anchor-incomplete" };
  }

  // q0L4ProvenBy field is NOT in plan.md; sourced from forge-plan mailbox
  // 2026-04-13T1240 ack mail. Set to a commit SHA by future L4-proof PR.
  // Must be a short or full git SHA (7-40 hex chars) — reject malformed
  // strings like "TBD" so they fall through to the age check instead of
  // silently masking an unproven state.
  const proven = anchor.q0L4ProvenBy;
  if (
    proven != null &&
    typeof proven === "string" &&
    /^[a-f0-9]{7,40}$/.test(proven)
  ) {
    return { status: "proven" };
  }

  if (!mergedAt || mergedAt === "PENDING") {
    // Bootstrap with no concrete timestamp — treat as incomplete.
    return { status: "skipped-anchor-incomplete" };
  }

  const mergedEpochMs = Date.parse(mergedAt);
  if (Number.isNaN(mergedEpochMs)) {
    return { status: "skipped-anchor-incomplete" };
  }

  const ageMs = now.getTime() - mergedEpochMs;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  if (ageDays >= Q0_L4_GRACE_DAYS) {
    return { status: "overdue", ageDays };
  }
  return { status: "in-grace-period", ageDays };
}
