import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  smokeTestPlan,
  clampSmokeTimeoutMs,
  DEFAULT_SMOKE_TIMEOUT_MS,
  MAX_SMOKE_TIMEOUT_MS,
} from "./smoke-runner.js";
import type { SmokeExecuteResult } from "./executor.js";
import type { ExecutionPlan } from "../types/execution-plan.js";

/**
 * Q0.5/B1 — smoke-runner unit + integration tests.
 *
 * Tests 1-14 cover the verdict matrix, lint interaction, completeness
 * invariant, Windows warmup subtraction, and clamp rules per the B1 plan
 * at `.ai-workspace/plans/2026-04-13-q05-b1-smoke-test.md`.
 *
 * Test 17 is the integration binary for the plan's own B1 exit criterion —
 * it runs smoke-testPlan against the PH-01-US-06 fixture and asserts at
 * least one AC is flagged as hung / skipped-suspect / slow+risk.
 *
 * Tests 15 and 16 live in a separate file (smoke-gate-check.test.ts) under
 * server/validation/ because they shell out to the bash detection script.
 */

// ── Test helpers ─────────────────────────────────────────

type MockExecutor = (
  command: string,
  opts: { timeoutMs: number; cwd?: string },
) => Promise<SmokeExecuteResult>;

function onePlan(
  command: string,
  overrides: { smokeTimeoutMs?: number; lintExempt?: { ruleId: string; rationale: string }[] } = {},
): ExecutionPlan {
  return {
    schemaVersion: "3.0.0",
    stories: [
      {
        id: "US-01",
        title: "test",
        acceptanceCriteria: [
          {
            id: "AC01",
            description: "test ac",
            command,
            smokeTimeoutMs: overrides.smokeTimeoutMs,
            lintExempt: overrides.lintExempt,
          },
        ],
      },
    ],
  };
}

function mockOk(overrides: Partial<SmokeExecuteResult> = {}): SmokeExecuteResult {
  return {
    exitCode: 0,
    elapsedMs: 100,
    stdoutBytes: 10,
    stderrBytes: 0,
    hungOnTimeout: false,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────

describe("smoke-runner / verdict classification", () => {
  // Test 1 — ok verdict, clean fast command (uses real executor)
  it("emits ok verdict for a clean fast command", async () => {
    const plan = onePlan("echo hi");
    const report = await smokeTestPlan(plan);
    expect(report.entries).toHaveLength(1);
    const e = report.entries[0];
    expect(e.acId).toBe("AC01");
    expect(e.verdict).toBe("ok");
    expect(e.exited).toBe(0);
    expect(e.elapsedMs).not.toBeNull();
    expect(e.elapsedMs!).toBeLessThan(24_000);
    expect(e.evidenceBytes).not.toBeNull();
    expect(e.evidenceBytes!).toBeGreaterThan(0);
    expect(e.timeoutRisk).toBe(false);
  });

  // Test 2 — slow verdict without override → timeoutRisk true
  it("emits slow verdict with timeoutRisk when no override", async () => {
    const executor: MockExecutor = async () =>
      mockOk({ elapsedMs: 25_000, stdoutBytes: 10 });
    const report = await smokeTestPlan(onePlan("echo slow"), {
      executorOverride: executor,
    });
    const e = report.entries[0];
    expect(e.verdict).toBe("slow");
    expect(e.exited).toBe(0);
    expect(e.timeoutRisk).toBe(true);
  });

  // Test 3 — slow verdict with explicit override → timeoutRisk suppressed
  it("suppresses timeoutRisk on slow verdict when smokeTimeoutMs is explicit", async () => {
    const executor: MockExecutor = async () =>
      mockOk({ elapsedMs: 25_000, stdoutBytes: 10 });
    const report = await smokeTestPlan(
      onePlan("echo slow", { smokeTimeoutMs: 30_000 }),
      { executorOverride: executor },
    );
    const e = report.entries[0];
    expect(e.verdict).toBe("slow");
    expect(e.timeoutRisk).toBe(false);
  });

  // Test 4 — hung verdict
  it("emits hung verdict when hungOnTimeout is set", async () => {
    const executor: MockExecutor = async () => ({
      exitCode: null,
      elapsedMs: 30_000,
      stdoutBytes: 0,
      stderrBytes: 0,
      hungOnTimeout: true,
    });
    const report = await smokeTestPlan(onePlan("sleep 99"), {
      executorOverride: executor,
    });
    const e = report.entries[0];
    expect(e.verdict).toBe("hung");
    expect(e.exited).toBeNull();
    expect(e.timeoutRisk).toBe(false);
  });

  // Test 5 — empty-evidence verdict
  it("emits empty-evidence verdict on non-zero exit with zero bytes", async () => {
    const executor: MockExecutor = async () => ({
      exitCode: 1,
      elapsedMs: 100,
      stdoutBytes: 0,
      stderrBytes: 0,
      hungOnTimeout: false,
    });
    const report = await smokeTestPlan(onePlan("silent fail"), {
      executorOverride: executor,
    });
    const e = report.entries[0];
    expect(e.verdict).toBe("empty-evidence");
    expect(e.exited).toBe(1);
  });
});

describe("smoke-runner / ac-lint interaction", () => {
  // Test 6 — skipped-suspect: lint-flagged AC, executor never called
  it("emits skipped-suspect without executing for lint-flagged commands", async () => {
    const executor = vi.fn<MockExecutor>(async () => mockOk());
    // F36-source-tree-grep pattern — anchored grep arg against src/ path
    const plan = onePlan("grep -rn 'Redis' src/");
    const report = await smokeTestPlan(plan, { executorOverride: executor });
    const e = report.entries[0];
    expect(e.verdict).toBe("skipped-suspect");
    expect(e.exited).toBeNull();
    expect(e.elapsedMs).toBeNull();
    expect(e.evidenceBytes).toBeNull();
    expect(e.timeoutRisk).toBe(false);
    expect(e.reason).toBeTruthy();
    expect(e.reason!.length).toBeGreaterThan(0);
    expect(executor).not.toHaveBeenCalled();
  });

  // Test 7 — skipped-suspect structural bypass (executor throws, still clean)
  it("bypasses executor entirely for lint-flagged ACs (executor throwing does not matter)", async () => {
    const executor: MockExecutor = async () => {
      throw new Error("executor should never run for lint-flagged ACs");
    };
    const plan = onePlan("grep -rn 'Redis' src/");
    const report = await smokeTestPlan(plan, { executorOverride: executor });
    const e = report.entries[0];
    expect(e.verdict).toBe("skipped-suspect");
  });

  // Test 9 — lintExempt wins
  it("executes normally when lintExempt covers the matched rule", async () => {
    const executor = vi.fn<MockExecutor>(async () => mockOk());
    // F36-source-tree-grep is the rule id for `grep ... src/`. If the rule
    // id changes, the exempt no longer applies and the executor will not be
    // called — the test will fail loudly rather than silently skip.
    const plan = onePlan("grep -rn 'Redis' src/", {
      lintExempt: [
        { ruleId: "F36-source-tree-grep", rationale: "test: exempt" },
      ],
    });
    const report = await smokeTestPlan(plan, { executorOverride: executor });
    const e = report.entries[0];
    // Either (a) the executor ran and the verdict is non-skipped, or (b) the
    // F36-source-tree-grep rule id has drifted and something else is still
    // flagging. In case (b) the test should fail so we know to update the
    // rule id — not silently pass.
    expect(executor).toHaveBeenCalled();
    expect(e.verdict).not.toBe("skipped-suspect");
  });
});

describe("smoke-runner / completeness invariant", () => {
  // Test 8 — every AC gets exactly one entry
  it("emits exactly one entry per AC across stories and verdicts", async () => {
    const executor = vi.fn<MockExecutor>(async (cmd: string) => {
      if (cmd === "fast") return mockOk({ elapsedMs: 100 });
      if (cmd === "slowcmd") return mockOk({ elapsedMs: 25_000 });
      if (cmd === "hungcmd") {
        return {
          exitCode: null,
          elapsedMs: 30_000,
          stdoutBytes: 0,
          stderrBytes: 0,
          hungOnTimeout: true,
        };
      }
      if (cmd === "empty") {
        return {
          exitCode: 1,
          elapsedMs: 50,
          stdoutBytes: 0,
          stderrBytes: 0,
          hungOnTimeout: false,
        };
      }
      return mockOk();
    });

    const plan: ExecutionPlan = {
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "s1",
          acceptanceCriteria: [
            { id: "AC01", description: "", command: "fast" },
            { id: "AC02", description: "", command: "slowcmd" },
          ],
        },
        {
          id: "US-02",
          title: "s2",
          acceptanceCriteria: [
            { id: "AC03", description: "", command: "hungcmd" },
            { id: "AC04", description: "", command: "empty" },
          ],
        },
        {
          id: "US-03",
          title: "s3",
          acceptanceCriteria: [
            {
              id: "AC05",
              description: "",
              command: "grep -rn 'Redis' src/",
            },
            { id: "AC06", description: "", command: "fast" },
          ],
        },
      ],
    };

    const report = await smokeTestPlan(plan, { executorOverride: executor });
    expect(report.entries).toHaveLength(6);
    const ids = report.entries.map((e) => e.acId).sort();
    expect(ids).toEqual(["AC01", "AC02", "AC03", "AC04", "AC05", "AC06"]);
    // One of each verdict class (except ok appears twice — AC01 and AC06).
    const verdicts = report.entries.map((e) => e.verdict);
    expect(verdicts).toContain("ok");
    expect(verdicts).toContain("slow");
    expect(verdicts).toContain("hung");
    expect(verdicts).toContain("empty-evidence");
    expect(verdicts).toContain("skipped-suspect");
  });
});

describe("smoke-runner / Windows cold-start warmup", () => {
  // Test 10 — 800ms subtracted from first AC only, floored at zero
  it("subtracts 800ms from the first AC's elapsedMs on win32", async () => {
    const executor: MockExecutor = async () => mockOk({ elapsedMs: 1000 });
    const plan: ExecutionPlan = {
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "s1",
          acceptanceCriteria: [
            { id: "AC01", description: "", command: "one" },
            { id: "AC02", description: "", command: "two" },
          ],
        },
      ],
    };
    const report = await smokeTestPlan(plan, {
      executorOverride: executor,
      platformOverride: "win32",
    });
    expect(report.entries[0].elapsedMs).toBe(200);
    expect(report.entries[1].elapsedMs).toBe(1000);
  });

  it("floors the first-AC elapsedMs at zero (never negative)", async () => {
    const executor: MockExecutor = async () => mockOk({ elapsedMs: 500 });
    const report = await smokeTestPlan(onePlan("one"), {
      executorOverride: executor,
      platformOverride: "win32",
    });
    expect(report.entries[0].elapsedMs).toBe(0);
  });

  it("does NOT subtract on non-win32 platforms", async () => {
    const executor: MockExecutor = async () => mockOk({ elapsedMs: 1000 });
    const report = await smokeTestPlan(onePlan("one"), {
      executorOverride: executor,
      platformOverride: "linux",
    });
    expect(report.entries[0].elapsedMs).toBe(1000);
  });
});

describe("smoke-runner / review fixes (round 1)", () => {
  // R1a — executor rejection preserves completeness invariant
  it("emits empty-evidence entry when executor throws, preserving invariant", async () => {
    const executor: MockExecutor = async () => {
      throw new Error("boom from test");
    };
    const plan: ExecutionPlan = {
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "s1",
          acceptanceCriteria: [
            { id: "AC01", description: "", command: "one" },
            { id: "AC02", description: "", command: "two" },
          ],
        },
      ],
    };
    const report = await smokeTestPlan(plan, { executorOverride: executor });
    expect(report.entries).toHaveLength(2);
    expect(report.entries[0].verdict).toBe("empty-evidence");
    expect(report.entries[0].exited).toBeNull();
    expect(report.entries[0].reason).toContain("executor-threw");
    expect(report.entries[0].reason).toContain("boom from test");
    expect(report.entries[1].verdict).toBe("empty-evidence");
  });

  // R2 — invalid smokeTimeoutMs does NOT count as author consent
  it("does not suppress timeoutRisk when smokeTimeoutMs is invalid-but-present", async () => {
    const executor: MockExecutor = async () =>
      mockOk({ elapsedMs: 25_000 });
    // Zero is a typo (clamps to default); should still emit timeoutRisk=true.
    const report0 = await smokeTestPlan(
      onePlan("echo slow", { smokeTimeoutMs: 0 }),
      { executorOverride: executor },
    );
    expect(report0.entries[0].verdict).toBe("slow");
    expect(report0.entries[0].timeoutRisk).toBe(true);

    // Negative is also a typo.
    const reportNeg = await smokeTestPlan(
      onePlan("echo slow", { smokeTimeoutMs: -5 }),
      { executorOverride: executor },
    );
    expect(reportNeg.entries[0].timeoutRisk).toBe(true);

    // NaN likewise.
    const reportNaN = await smokeTestPlan(
      onePlan("echo slow", { smokeTimeoutMs: NaN }),
      { executorOverride: executor },
    );
    expect(reportNaN.entries[0].timeoutRisk).toBe(true);
  });

  // R1 — Windows warmup targets first SPAWNED AC, not first plan AC
  it("applies Windows warmup to the first spawned AC when earlier ACs are lint-skipped", async () => {
    const executor: MockExecutor = async () => mockOk({ elapsedMs: 1000 });
    const plan: ExecutionPlan = {
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "s1",
          acceptanceCriteria: [
            // AC01 is lint-flagged → skipped-suspect, no spawn
            { id: "AC01", description: "", command: "grep -rn 'X' src/" },
            // AC02 is the first real spawn → gets the 800ms subtraction
            { id: "AC02", description: "", command: "echo two" },
            // AC03 is the second spawn → raw elapsedMs
            { id: "AC03", description: "", command: "echo three" },
          ],
        },
      ],
    };
    const report = await smokeTestPlan(plan, {
      executorOverride: executor,
      platformOverride: "win32",
    });
    expect(report.entries).toHaveLength(3);
    expect(report.entries[0].verdict).toBe("skipped-suspect");
    expect(report.entries[0].elapsedMs).toBeNull();
    // AC02 is the first SPAWN — gets the warmup subtraction even though
    // it's plan-index 1.
    expect(report.entries[1].elapsedMs).toBe(200);
    // AC03 is the second spawn — full 1000ms.
    expect(report.entries[2].elapsedMs).toBe(1000);
  });
});

describe("smoke-runner / clamp rules (D2)", () => {
  // Test 13 — timeout cap
  it("clamps smokeTimeoutMs above 180000 to 180000", () => {
    expect(clampSmokeTimeoutMs(300_000)).toBe(MAX_SMOKE_TIMEOUT_MS);
  });

  // Test 14 — timeout floor / sanitize (four sub-cases)
  it("collapses undefined/NaN/zero/negative to default 30000", () => {
    expect(clampSmokeTimeoutMs(undefined)).toBe(DEFAULT_SMOKE_TIMEOUT_MS);
    expect(clampSmokeTimeoutMs(null)).toBe(DEFAULT_SMOKE_TIMEOUT_MS);
    expect(clampSmokeTimeoutMs(NaN)).toBe(DEFAULT_SMOKE_TIMEOUT_MS);
    expect(clampSmokeTimeoutMs(0)).toBe(DEFAULT_SMOKE_TIMEOUT_MS);
    expect(clampSmokeTimeoutMs(-5)).toBe(DEFAULT_SMOKE_TIMEOUT_MS);
    expect(clampSmokeTimeoutMs(Infinity)).toBe(DEFAULT_SMOKE_TIMEOUT_MS);
  });

  // End-to-end clamp pass-through via executor spy
  it("passes the clamped timeout to the executor (cap)", async () => {
    const executor = vi.fn<MockExecutor>(async () => mockOk());
    await smokeTestPlan(onePlan("echo", { smokeTimeoutMs: 300_000 }), {
      executorOverride: executor,
    });
    expect(executor).toHaveBeenCalledWith(
      "echo",
      expect.objectContaining({ timeoutMs: MAX_SMOKE_TIMEOUT_MS }),
    );
  });

  it("passes the default timeout to the executor when smokeTimeoutMs is missing", async () => {
    const executor = vi.fn<MockExecutor>(async () => mockOk());
    await smokeTestPlan(onePlan("echo"), { executorOverride: executor });
    expect(executor).toHaveBeenCalledWith(
      "echo",
      expect.objectContaining({ timeoutMs: DEFAULT_SMOKE_TIMEOUT_MS }),
    );
  });
});

describe("smoke-runner / PH-01 integration (test 17)", () => {
  // Test 17 — integration AC for the plan's own B1 binary exit criterion.
  // Runs the fixture through the real smokeExecute (not mocked) and asserts
  // at least one AC is flagged as hung / skipped-suspect / slow+risk.
  it("flags at least one known-bad AC in the PH-01-US-06 fixture", async () => {
    const fixturePath = fileURLToPath(
      new URL("./__fixtures__/ph01-us06-smoke.plan.json", import.meta.url),
    );
    const plan = JSON.parse(readFileSync(fixturePath, "utf-8")) as ExecutionPlan;
    const report = await smokeTestPlan(plan);

    expect(report.entries.length).toBe(3);

    const flagged = report.entries.some(
      (e) =>
        e.verdict === "hung" ||
        e.verdict === "skipped-suspect" ||
        (e.verdict === "slow" && e.timeoutRisk === true),
    );
    expect(flagged).toBe(true);

    // Stronger assertion: the lint-flagged F55 AC should be skipped-suspect,
    // and the sleep 40 with 2s timeout should be hung. Pin both so a future
    // refactor that breaks either arm fails loudly.
    const ac01 = report.entries.find((e) => e.acId === "AC01");
    expect(ac01?.verdict).toBe("skipped-suspect");

    const ac02 = report.entries.find((e) => e.acId === "AC02");
    expect(ac02?.verdict).toBe("hung");

    const ac03 = report.entries.find((e) => e.acId === "AC03");
    expect(ac03?.verdict).toBe("ok");
  }, 15_000);
});
