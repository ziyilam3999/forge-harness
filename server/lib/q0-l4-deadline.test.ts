import { describe, it, expect } from "vitest";
import { evaluateAnchorState, type Q0L4Anchor } from "./q0-l4-deadline.js";

const BOOTSTRAP_ANCHOR: Q0L4Anchor = {
  q0MergeSha: "a89d7795b37777010edc2d65e8686147ef2bb2cf",
  q0MergedAt: "2026-04-13T01:22:51+08:00",
  q0PrNumber: 159,
  q0FillMode: "bootstrap",
  q0AnchorCreatedAt: "2026-04-13T12:45:00+08:00",
  q0L4ProvenBy: null,
};

describe("evaluateAnchorState", () => {
  it("bootstrap + within grace period -> in-grace-period, no issue", () => {
    const now = new Date("2026-04-15T00:00:00+08:00");
    const result = evaluateAnchorState(BOOTSTRAP_ANCHOR, now);
    expect(result.status).toBe("in-grace-period");
    expect(result.ageDays).toBe(1);
  });

  it("bootstrap + 14.02 days later -> overdue", () => {
    const now = new Date("2026-04-27T02:00:00+08:00");
    const result = evaluateAnchorState(BOOTSTRAP_ANCHOR, now);
    expect(result.status).toBe("overdue");
    expect(result.ageDays).toBeGreaterThanOrEqual(14);
  });

  it("q0L4ProvenBy set -> proven even after 30 days", () => {
    const proven: Q0L4Anchor = {
      ...BOOTSTRAP_ANCHOR,
      q0L4ProvenBy: "deadbeefcafe1234567890abcdef1234567890ab",
    };
    const now = new Date("2026-05-13T01:22:51+08:00");
    const result = evaluateAnchorState(proven, now);
    expect(result.status).toBe("proven");
  });

  it("workflow-fill + PENDING -> skipped-anchor-incomplete", () => {
    const pending: Q0L4Anchor = {
      q0MergeSha: "PENDING",
      q0MergedAt: "PENDING",
      q0PrNumber: 0,
      q0FillMode: "workflow-fill",
      q0AnchorCreatedAt: "2026-04-13T12:45:00+08:00",
      q0L4ProvenBy: null,
    };
    const now = new Date("2026-05-13T01:22:51+08:00");
    const result = evaluateAnchorState(pending, now);
    expect(result.status).toBe("skipped-anchor-incomplete");
  });

  it("null anchor -> skipped-no-anchor", () => {
    const now = new Date("2026-05-13T01:22:51+08:00");
    const result = evaluateAnchorState(null, now);
    expect(result.status).toBe("skipped-no-anchor");
  });

  it("exactly 14 days -> overdue (boundary)", () => {
    // 2026-04-13T01:22:51+08:00 + 14 days = 2026-04-27T01:22:51+08:00
    const now = new Date("2026-04-27T01:22:51+08:00");
    const result = evaluateAnchorState(BOOTSTRAP_ANCHOR, now);
    expect(result.status).toBe("overdue");
    expect(result.ageDays).toBe(14);
  });

  it("13.99 days (13d 23h 45m) -> in-grace-period (sub-boundary)", () => {
    // mergedAt = 2026-04-13T01:22:51+08:00
    // +13d 23h 45m = 2026-04-27T01:07:51+08:00 (floor(ageDays) = 13)
    const mergedMs = Date.parse("2026-04-13T01:22:51+08:00");
    const delta = (13 * 24 * 60 * 60 * 1000) + (23 * 60 * 60 * 1000) + (45 * 60 * 1000);
    const now = new Date(mergedMs + delta);
    const result = evaluateAnchorState(BOOTSTRAP_ANCHOR, now);
    expect(result.status).toBe("in-grace-period");
    expect(result.ageDays).toBe(13);
  });

  it("14.01 days (14d 0h 14m) -> overdue (super-boundary)", () => {
    const mergedMs = Date.parse("2026-04-13T01:22:51+08:00");
    const delta = (14 * 24 * 60 * 60 * 1000) + (14 * 60 * 1000);
    const now = new Date(mergedMs + delta);
    const result = evaluateAnchorState(BOOTSTRAP_ANCHOR, now);
    expect(result.status).toBe("overdue");
    expect(result.ageDays).toBe(14);
  });

  it("malformed q0L4ProvenBy ('TBD') within grace -> falls through to in-grace-period", () => {
    const malformed: Q0L4Anchor = {
      ...BOOTSTRAP_ANCHOR,
      q0L4ProvenBy: "TBD",
    };
    const now = new Date("2026-04-15T00:00:00+08:00");
    const result = evaluateAnchorState(malformed, now);
    expect(result.status).toBe("in-grace-period");
    expect(result.ageDays).toBe(1);
  });

  it("malformed q0L4ProvenBy ('TBD') beyond grace -> overdue", () => {
    const malformed: Q0L4Anchor = {
      ...BOOTSTRAP_ANCHOR,
      q0L4ProvenBy: "TBD",
    };
    const now = new Date("2026-04-27T02:00:00+08:00");
    const result = evaluateAnchorState(malformed, now);
    expect(result.status).toBe("overdue");
  });
});
