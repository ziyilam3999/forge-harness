/**
 * Q0.5/A3-bis — lint-audit primitive tests.
 * Covers AC-bis-01..04 (hash stability + isStale precedence).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAcLintRulesHash } from "./prompts/shared/ac-subprocess-rules.js";
import {
  computePlanSlug,
  isStale,
  loadAudit,
  writeAudit,
} from "./lint-audit.js";
import type { LintAuditEntry } from "../types/lint-audit.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "forge-lint-audit-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const baseEntry = (overrides: Partial<LintAuditEntry> = {}): LintAuditEntry => ({
  planId: "plans__2026-04-14-sample",
  planPath: ".ai-workspace/plans/2026-04-14-sample.md",
  lastAuditedAt: "2026-04-14T00:00:00.000Z",
  ruleHash: "a".repeat(64),
  perAcExemptCount: 0,
  planLevelExemptCount: 0,
  ...overrides,
});

describe("getAcLintRulesHash — AC-bis-01", () => {
  it("returns a stable 64-char hex string across calls", () => {
    const h1 = getAcLintRulesHash();
    const h2 = getAcLintRulesHash();
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isStale — AC-bis-02..04", () => {
  const now = new Date("2026-04-14T12:00:00.000Z");

  it("AC-bis-02: returns 'rule-change' when hash differs", () => {
    const entry = baseEntry({
      ruleHash: "a".repeat(64),
      lastAuditedAt: "2026-04-14T00:00:00.000Z",
    });
    expect(isStale(entry, "b".repeat(64), now)).toBe("rule-change");
  });

  it("AC-bis-03: returns '14d-elapsed' when hash matches and age > 14 days", () => {
    const entry = baseEntry({
      ruleHash: "c".repeat(64),
      lastAuditedAt: "2026-03-30T00:00:00.000Z", // 15 days before `now`
    });
    expect(isStale(entry, "c".repeat(64), now)).toBe("14d-elapsed");
  });

  it("AC-bis-04: returns null when hash matches and age < 14 days", () => {
    const entry = baseEntry({
      ruleHash: "d".repeat(64),
      lastAuditedAt: "2026-04-10T00:00:00.000Z", // 4 days before `now`
    });
    expect(isStale(entry, "d".repeat(64), now)).toBeNull();
  });

  it("hash-change beats calendar (precedence check)", () => {
    const entry = baseEntry({
      ruleHash: "e".repeat(64),
      lastAuditedAt: "2026-03-01T00:00:00.000Z", // well over 14 days
    });
    expect(isStale(entry, "f".repeat(64), now)).toBe("rule-change");
  });
});

describe("computePlanSlug", () => {
  it("combines parent dir and basename without .md", () => {
    expect(computePlanSlug(".ai-workspace/plans/2026-04-14-foo.md")).toBe(
      "plans__2026-04-14-foo",
    );
  });

  it("disambiguates siblings in different parent dirs", () => {
    const a = computePlanSlug("phases/phase-01.md");
    const b = computePlanSlug("archive/phase-01.md");
    expect(a).not.toBe(b);
  });
});

describe("loadAudit / writeAudit round-trip", () => {
  it("returns null when no audit file exists", async () => {
    const result = await loadAudit(tempDir, "plans/missing.md");
    expect(result).toBeNull();
  });

  it("persists and reads back an entry under the computed slug", async () => {
    const entry = baseEntry({
      planPath: "plans/round-trip.md",
      planId: "plans__round-trip",
      perAcExemptCount: 2,
      planLevelExemptCount: 1,
    });
    await writeAudit(tempDir, entry);
    const loaded = await loadAudit(tempDir, "plans/round-trip.md");
    expect(loaded).toEqual(entry);
  });
});
