import { describe, it, expect } from "vitest";
import {
  lintAcCommand,
  lintPlan,
  type LintExemptPlan,
  type LintablePlan,
  type LintExempt,
} from "./ac-lint.js";
import type { LintExemptPlan as LintExemptPlanMirror } from "../types/execution-plan.js";
import { AC_LINT_RULES } from "../lib/prompts/shared/ac-subprocess-rules.js";

// MINOR-1 (round-0): structural compat check between the two LintExemptPlan
// declarations. `ac-lint.ts` and `types/execution-plan.ts` must stay byte-
// identical shapes; if they drift, this assignment fails to typecheck.
const _typeMirrorCheck: LintExemptPlanMirror = {} as LintExemptPlan;
void _typeMirrorCheck;
// MINOR-5a (round-1 follow-up): reverse direction. The forward check above
// catches drift if types/execution-plan.ts tightens; this reverse check
// catches drift if ac-lint.ts tightens. Together they enforce byte-identical
// shapes in both directions.
const _typeMirrorCheckReverse: LintExemptPlan = {} as LintExemptPlanMirror;
void _typeMirrorCheckReverse;

describe("lintAcCommand — WRONG patterns (must flag)", () => {
  it("F55: vitest count-based grep with [5-9]", () => {
    const cmd =
      "npx vitest run server/lib/topo-sort.test.ts 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]|Tests[[:space:]]+[0-9]{2,}'";
    const r = lintAcCommand(cmd);
    expect(r.suspect).toBe(true);
    expect(r.findings.some((f) => f.ruleId === "F55-vitest-count-grep")).toBe(true);
  });

  it("F55: vitest count-based grep with [8-9] (single-digit variant)", () => {
    const cmd =
      "npx vitest run foo.test.ts 2>&1 | grep -qE 'Tests[[:space:]]+[8-9]'";
    expect(lintAcCommand(cmd).suspect).toBe(true);
  });

  it("F55: vitest count with {2,} double-digit count", () => {
    const cmd =
      "npx vitest run foo.test.ts | grep -qE 'Tests[[:space:]]+[0-9]{2,}'";
    expect(lintAcCommand(cmd).suspect).toBe(true);
  });

  it("F56: multi-grep && pipeline", () => {
    const cmd = "npx vitest run 2>&1 | grep -q 'passed' && ! grep -q 'failed'";
    const r = lintAcCommand(cmd);
    expect(r.suspect).toBe(true);
    expect(r.findings.some((f) => f.ruleId === "F56-multigrep-pipe")).toBe(true);
  });

  it("F56 multigrep: no-space `&&! grep` variant", () => {
    const cmd = "cmd | grep -q 'x' &&! grep -q 'y'";
    // Our regex tolerates optional whitespace around the !.
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F56-multigrep-pipe")).toBe(true);
  });

  it("F55: lone `grep -q 'passed'` on runner output", () => {
    const cmd = "npx vitest run -t 'foo' 2>&1 | grep -q 'passed'";
    const r = lintAcCommand(cmd);
    expect(r.suspect).toBe(true);
    expect(r.findings.some((f) => f.ruleId === "F55-passed-grep")).toBe(true);
  });

  it("F55: lone `grep -q 'failed'` on runner output", () => {
    const cmd = "npx vitest run | grep -q 'failed'";
    expect(lintAcCommand(cmd).suspect).toBe(true);
  });

  it("F36: grep -n on server/ file enumeration (PH01-US-06-AC04 shape)", () => {
    const cmd =
      "test -z \"$(grep -n 'callClaude\\|trackedCallClaude' server/lib/coordinator.ts server/lib/topo-sort.ts)\" && echo EMPTY-OK | grep -q EMPTY-OK";
    const r = lintAcCommand(cmd);
    expect(r.suspect).toBe(true);
    expect(r.findings.some((f) => f.ruleId === "F36-source-tree-grep")).toBe(true);
  });

  it("F36: grep -rn on src/", () => {
    const cmd = "grep -rn 'Redis' src/";
    expect(lintAcCommand(cmd).suspect).toBe(true);
  });

  it("F36: raw rg invocation on a directory", () => {
    const cmd = "rg 'class UserCache' server/";
    const r = lintAcCommand(cmd);
    expect(r.suspect).toBe(true);
    expect(r.findings.some((f) => f.ruleId === "F36-raw-rg")).toBe(true);
  });

  it("F36: rg with a flag", () => {
    const cmd = "rg -l 'foo' lib/";
    expect(lintAcCommand(cmd).findings.some((f) => f.ruleId === "F36-raw-rg")).toBe(
      true,
    );
  });
});

describe("lintAcCommand — Q0.5/A2 MAJOR-2/MINOR-3/4/5 additions", () => {
  // MAJOR-2 false-positive regressions — each was falsely SKIPPED by A1's regex.
  it("MAJOR-2 FP-a: grep + && + url containing 'src' must NOT flag F36", () => {
    const cmd = "grep -q 'ok' out.log && curl localhost:3000/src/main.js";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F36-source-tree-grep")).toBe(false);
  });

  it("MAJOR-2 FP-b: grep + || + echo containing 'server/' must NOT flag F36", () => {
    const cmd = "grep -q 'x' out.log || echo 'server/up'";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F36-source-tree-grep")).toBe(false);
  });

  it("MAJOR-2 FP-c: grep + ; + ls lib/*.ts must NOT flag F36", () => {
    const cmd = "grep -q 'foo' out.log ; ls lib/*.ts";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F36-source-tree-grep")).toBe(false);
  });

  // MINOR-3: bare-word rg arg.
  it("MINOR-3: `rg pattern server/` (unquoted single-word) flags F36-raw-rg", () => {
    const cmd = "rg pattern server/";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F36-raw-rg")).toBe(true);
  });

  it("MINOR-3: `rg --help` does NOT flag (flag-only probe is allowed)", () => {
    expect(lintAcCommand("rg --help").suspect).toBe(false);
  });

  it("MINOR-3: `rg --version` does NOT flag", () => {
    expect(lintAcCommand("rg --version").suspect).toBe(false);
  });

  // MINOR-4: `||` and `;` variants of multi-grep.
  it("MINOR-4: `cmd | grep -q 'x' || grep -q 'y'` flags F56-multigrep-pipe", () => {
    const cmd = "cmd | grep -q 'x' || grep -q 'y'";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F56-multigrep-pipe")).toBe(true);
  });

  it("MINOR-4: `cmd | grep -q 'x' ; grep -q 'y'` flags F56-multigrep-pipe", () => {
    const cmd = "cmd | grep -q 'x' ; grep -q 'y'";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F56-multigrep-pipe")).toBe(true);
  });

  // MINOR-5: regex-alt and unquoted passed/failed.
  it("MINOR-5: `grep -qE 'passed|failed'` flags F55-passed-grep", () => {
    const cmd = "npx vitest run | grep -qE 'passed|failed'";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F55-passed-grep")).toBe(true);
  });

  it("MINOR-5: `grep -q passed` (unquoted) flags F55-passed-grep", () => {
    const cmd = "npx vitest run | grep -q passed";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F55-passed-grep")).toBe(true);
  });
});

describe("AC_LINT_RULES structure (Q0.5/A2 typed-export contract)", () => {
  it("every rule has a non-empty wrongExample and rightExample", () => {
    for (const rule of AC_LINT_RULES) {
      expect(rule.wrongExample, `${rule.id}.wrongExample`).toBeTruthy();
      expect(rule.rightExample, `${rule.id}.rightExample`).toBeTruthy();
    }
  });

  it("exports exactly the 5 rules A1 shipped (no accidental drops)", () => {
    const ids = AC_LINT_RULES.map((r) => r.id).sort();
    expect(ids).toEqual([
      "F36-raw-rg",
      "F36-source-tree-grep",
      "F55-passed-grep",
      "F55-vitest-count-grep",
      "F56-multigrep-pipe",
    ]);
  });
});

describe("lintAcCommand — RIGHT patterns (must NOT flag)", () => {
  it("exit-code vitest -t filter", () => {
    const r = lintAcCommand("npx vitest run -t 'budget'");
    expect(r.suspect).toBe(false);
    expect(r.findings).toHaveLength(0);
  });

  it("tsc --noEmit", () => {
    expect(lintAcCommand("npx tsc --noEmit").suspect).toBe(false);
  });

  it("node -e inline script", () => {
    expect(
      lintAcCommand("node -e \"process.exit(require('./dist/foo').bar?0:1)\"")
        .suspect,
    ).toBe(false);
  });

  it("curl | jq check does not false-positive", () => {
    expect(
      lintAcCommand("curl -s localhost:3000/api/users | jq '.users | length'")
        .suspect,
    ).toBe(false);
  });

  it("echo 'passed' benign string is not flagged", () => {
    // No preceding pipe-into-grep, so F55-passed-grep should not match.
    expect(lintAcCommand("echo 'passed'").suspect).toBe(false);
  });

  it("jq '.passed' does not false-positive F55-passed-grep", () => {
    expect(lintAcCommand("curl -s localhost | jq '.passed'").suspect).toBe(false);
  });

  it("embedded 'rg' inside a word is not flagged as raw rg", () => {
    // "merge" contains "rg" — make sure our word-boundary anchor holds.
    expect(lintAcCommand("git merge --no-ff foo").suspect).toBe(false);
  });
});

describe("lintAcCommand — lintExempt precedence", () => {
  it("exempt AC with matching pattern → finding is exempt, suspect=false", () => {
    const cmd = "npx vitest run | grep -q 'passed'";
    const r = lintAcCommand(cmd, {
      lintExempt: { ruleId: "F55-passed-grep", rationale: "legacy: reviewed" },
    });
    expect(r.suspect).toBe(false);
    const finding = r.findings.find((f) => f.ruleId === "F55-passed-grep");
    expect(finding?.exempt).toBe(true);
    expect(finding?.exemptRationale).toBe("legacy: reviewed");
  });

  it("exempt rule X + match rule Y → still suspect on Y", () => {
    // Matches F55 (count-grep) but exempt only covers F55-passed-grep.
    const cmd = "npx vitest run | grep -qE 'Tests[[:space:]]+[5-9]'";
    const r = lintAcCommand(cmd, {
      lintExempt: { ruleId: "F55-passed-grep", rationale: "n/a" },
    });
    expect(r.suspect).toBe(true);
    expect(r.findings.some((f) => f.ruleId === "F55-vitest-count-grep" && !f.exempt)).toBe(
      true,
    );
  });

  it("array of exemptions is honored", () => {
    const cmd = "npx vitest run | grep -q 'passed' && ! grep -q 'failed'";
    const r = lintAcCommand(cmd, {
      lintExempt: [
        { ruleId: "F55-passed-grep", rationale: "a" },
        { ruleId: "F56-multigrep-pipe", rationale: "b" },
      ],
    });
    expect(r.suspect).toBe(false);
  });
});

describe("lintPlan — governance cap and plan-level aggregation", () => {
  function mkPlan(
    acs: Array<{
      id: string;
      command: string;
      lintExempt?: LintExempt | LintExempt[];
    }>,
  ): LintablePlan {
    return {
      stories: [
        {
          id: "US-01",
          acceptanceCriteria: acs.map((a) => ({
            id: a.id,
            description: a.id,
            command: a.command,
            lintExempt: a.lintExempt,
          })),
        },
      ],
    };
  }

  it("3 exemptions → governanceViolation=false", () => {
    const plan = mkPlan([
      {
        id: "AC-01",
        command: "cmd | grep -q 'passed'",
        lintExempt: { ruleId: "F55-passed-grep", rationale: "ok" },
      },
      {
        id: "AC-02",
        command: "cmd | grep -q 'passed'",
        lintExempt: { ruleId: "F55-passed-grep", rationale: "ok" },
      },
      {
        id: "AC-03",
        command: "cmd | grep -q 'passed'",
        lintExempt: { ruleId: "F55-passed-grep", rationale: "ok" },
      },
    ]);
    const report = lintPlan(plan);
    expect(report.lintExemptCount).toBe(3);
    expect(report.governanceViolation).toBe(false);
  });

  it("4 exemptions → governanceViolation=true", () => {
    const plan = mkPlan([
      { id: "AC-01", command: "echo ok", lintExempt: { ruleId: "X", rationale: "a" } },
      { id: "AC-02", command: "echo ok", lintExempt: { ruleId: "X", rationale: "a" } },
      { id: "AC-03", command: "echo ok", lintExempt: { ruleId: "X", rationale: "a" } },
      { id: "AC-04", command: "echo ok", lintExempt: { ruleId: "X", rationale: "a" } },
    ]);
    const report = lintPlan(plan);
    expect(report.lintExemptCount).toBe(4);
    expect(report.governanceViolation).toBe(true);
  });

  it("empty stories → no crash, empty report", () => {
    const report = lintPlan({ stories: [] });
    expect(report.findings).toHaveLength(0);
    expect(report.suspectAcIds).toHaveLength(0);
    expect(report.lintExemptCount).toBe(0);
    expect(report.governanceViolation).toBe(false);
  });

  it("story with zero ACs → no crash", () => {
    const plan = { stories: [{ id: "US-01", acceptanceCriteria: [] }] };
    expect(() => lintPlan(plan)).not.toThrow();
  });

  it("surfaces suspect ACs at plan level", () => {
    const plan = mkPlan([
      { id: "AC-01", command: "echo PASS" },
      { id: "AC-02", command: "npx vitest run | grep -q 'passed'" },
    ]);
    const report = lintPlan(plan);
    expect(report.suspectAcIds).toEqual(["AC-02"]);
  });
});

describe("lintPlan — Q0.5/C1-bis plan-level lintExempt", () => {
  // Shape that matches LintablePlan (stories + optional plan-level lintExempt).
  function mkPlanWithExempt(
    planLevel: unknown,
    acs: Array<{ id: string; command: string }>,
  ): LintablePlan {
    return {
      lintExempt: planLevel as LintExemptPlan[] | undefined,
      stories: [
        {
          id: "US-01",
          acceptanceCriteria: acs.map((a) => ({
            id: a.id,
            description: a.id,
            command: a.command,
          })),
        },
      ],
    };
  }

  it("baseline: plan without plan.lintExempt lints normally (unchanged)", () => {
    const plan = mkPlanWithExempt(undefined, [
      { id: "AC-01", command: "npx vitest run | grep -q 'passed'" },
    ]);
    const report = lintPlan(plan);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.suspectAcIds).toEqual(["AC-01"]);
    expect(report.lintExemptPlanEntriesCount).toBe(0);
  });

  it("plan-level F36 entry drops F36 findings but still surfaces F56 in same plan", () => {
    const plan = mkPlanWithExempt(
      [
        {
          scope: "plan",
          rules: ["F36-source-tree-grep"],
          batch: "2026-04-13-test",
          rationale: "test fixture",
        },
      ],
      [
        { id: "AC-01", command: "grep -rn 'Redis' src/" }, // F36 → dropped
        { id: "AC-02", command: "npx vitest run | grep -q 'passed'" }, // F55 → still surfaces
      ],
    );
    const report = lintPlan(plan);
    expect(report.findings.every((f) => f.ruleId !== "F36-source-tree-grep")).toBe(true);
    expect(report.findings.some((f) => f.ruleId === "F55-passed-grep")).toBe(true);
    expect(report.suspectAcIds).toEqual(["AC-02"]);
    expect(report.lintExemptPlanEntriesCount).toBe(1);
  });

  it("plan-level AND per-AC: per-AC 3-cap still applies; plan-level does not contribute to cap", () => {
    // 3 per-AC exempts (at cap) + 1 plan-level entry (no cap contribution)
    const plan = {
      lintExempt: [
        {
          scope: "plan",
          rules: ["F36-source-tree-grep"],
          batch: "2026-04-13-test",
          rationale: "bootstrap",
        },
      ],
      stories: [
        {
          id: "US-01",
          acceptanceCriteria: [
            {
              id: "AC-01",
              description: "a",
              command: "cmd | grep -q 'passed'",
              lintExempt: { ruleId: "F55-passed-grep", rationale: "ok" },
            },
            {
              id: "AC-02",
              description: "a",
              command: "cmd | grep -q 'passed'",
              lintExempt: { ruleId: "F55-passed-grep", rationale: "ok" },
            },
            {
              id: "AC-03",
              description: "a",
              command: "cmd | grep -q 'passed'",
              lintExempt: { ruleId: "F55-passed-grep", rationale: "ok" },
            },
          ],
        },
      ],
    } as unknown as LintablePlan;
    const report = lintPlan(plan);
    expect(report.lintExemptCount).toBe(3);
    expect(report.governanceViolation).toBe(false);
    expect(report.lintExemptPlanEntriesCount).toBe(1);
    // Plan-level count does NOT bump governance:
    expect(report.lintExemptCount).not.toBe(4);
  });

  it("plan-level entry with empty rules → throws", () => {
    const plan = mkPlanWithExempt(
      [{ scope: "plan", rules: [], batch: "b", rationale: "r" }],
      [{ id: "AC-01", command: "echo PASS" }],
    );
    expect(() => lintPlan(plan)).toThrow(/rules must be a non-empty array/);
  });

  it("plan-level entry with unknown rule id → throws", () => {
    const plan = mkPlanWithExempt(
      [
        {
          scope: "plan",
          rules: ["F99-nonexistent-rule"],
          batch: "b",
          rationale: "r",
        },
      ],
      [{ id: "AC-01", command: "echo PASS" }],
    );
    expect(() => lintPlan(plan)).toThrow(/not in AC_LINT_RULES/);
  });

  it("plan-level entry missing batch → throws", () => {
    const plan = mkPlanWithExempt(
      [{ scope: "plan", rules: ["F36-source-tree-grep"], rationale: "r" }],
      [{ id: "AC-01", command: "echo PASS" }],
    );
    expect(() => lintPlan(plan)).toThrow(/batch must be a non-empty string/);
  });

  it("plan-level entry missing rationale → throws", () => {
    const plan = mkPlanWithExempt(
      [{ scope: "plan", rules: ["F36-source-tree-grep"], batch: "b" }],
      [{ id: "AC-01", command: "echo PASS" }],
    );
    expect(() => lintPlan(plan)).toThrow(/rationale must be a non-empty string/);
  });

  it("multiple plan-level entries with different batches → union of rules applies", () => {
    const plan = mkPlanWithExempt(
      [
        {
          scope: "plan",
          rules: ["F36-source-tree-grep"],
          batch: "batch-a",
          rationale: "r",
        },
        {
          scope: "plan",
          rules: ["F55-passed-grep"],
          batch: "batch-b",
          rationale: "r",
        },
      ],
      [
        { id: "AC-01", command: "grep -rn 'x' src/" }, // F36
        { id: "AC-02", command: "cmd | grep -q 'passed'" }, // F55
      ],
    );
    const report = lintPlan(plan);
    expect(report.findings).toHaveLength(0);
    expect(report.suspectAcIds).toHaveLength(0);
    expect(report.lintExemptPlanEntriesCount).toBe(2);
  });

  it("plan-level entry with scope !== 'plan' → throws", () => {
    const plan = mkPlanWithExempt(
      [{ scope: "story", rules: ["F36-source-tree-grep"], batch: "b", rationale: "r" }],
      [{ id: "AC-01", command: "echo PASS" }],
    );
    expect(() => lintPlan(plan)).toThrow(/scope must be "plan"/);
  });

  // MINOR-3 (round-0): prove governance does not read lintExemptPlanEntriesCount
  // even when that count is large and per-AC count is zero.
  it("4 plan-level entries with 0 per-AC entries → governanceViolation remains false", () => {
    const plan = mkPlanWithExempt(
      [
        { scope: "plan", rules: ["F36-source-tree-grep"], batch: "batch-1", rationale: "r1" },
        { scope: "plan", rules: ["F55-passed-grep"], batch: "batch-2", rationale: "r2" },
        { scope: "plan", rules: ["F56-multigrep-pipe"], batch: "batch-3", rationale: "r3" },
        { scope: "plan", rules: ["F36-raw-rg"], batch: "batch-4", rationale: "r4" },
      ],
      [{ id: "AC-01", command: "echo PASS" }],
    );
    const report = lintPlan(plan);
    expect(report.lintExemptPlanEntriesCount).toBe(4);
    expect(report.lintExemptCount).toBe(0);
    expect(report.governanceViolation).toBe(false);
  });

  // MINOR-4 (round-0): deeper negative coverage — non-string rule element,
  // empty-string rationale distinct from missing, array-of-non-object entries.
  it("plan-level entry with non-string rule element → throws", () => {
    const plan = mkPlanWithExempt(
      [{ scope: "plan", rules: [123 as unknown as string], batch: "b", rationale: "r" }],
      [{ id: "AC-01", command: "echo PASS" }],
    );
    expect(() => lintPlan(plan)).toThrow(/not in AC_LINT_RULES/);
  });

  it("plan-level entry with empty-string rationale → throws", () => {
    const plan = mkPlanWithExempt(
      [{ scope: "plan", rules: ["F36-source-tree-grep"], batch: "b", rationale: "" }],
      [{ id: "AC-01", command: "echo PASS" }],
    );
    expect(() => lintPlan(plan)).toThrow(/rationale must be a non-empty string/);
  });

  it("plan-level entry array element is null → throws", () => {
    const plan = {
      lintExempt: [null],
      stories: [
        {
          id: "US-01",
          acceptanceCriteria: [{ id: "AC-01", description: "a", command: "echo PASS" }],
        },
      ],
    } as unknown as LintablePlan;
    expect(() => lintPlan(plan)).toThrow(/must be an object/);
  });

  it("plan-level entry with empty-string batch → throws", () => {
    const plan = mkPlanWithExempt(
      [{ scope: "plan", rules: ["F36-source-tree-grep"], batch: "", rationale: "r" }],
      [{ id: "AC-01", command: "echo PASS" }],
    );
    expect(() => lintPlan(plan)).toThrow(/batch must be a non-empty string/);
  });
});
