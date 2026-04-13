import { describe, it, expect } from "vitest";
import { lintAcCommand, lintPlan } from "./ac-lint.js";
import { AC_LINT_RULES } from "../lib/prompts/shared/ac-subprocess-rules.js";

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

  it("F56: lone `grep -q 'passed'` on runner output", () => {
    const cmd = "npx vitest run -t 'foo' 2>&1 | grep -q 'passed'";
    const r = lintAcCommand(cmd);
    expect(r.suspect).toBe(true);
    expect(r.findings.some((f) => f.ruleId === "F56-passed-grep")).toBe(true);
  });

  it("F56: lone `grep -q 'failed'` on runner output", () => {
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
  it("MINOR-5: `grep -qE 'passed|failed'` flags F56-passed-grep", () => {
    const cmd = "npx vitest run | grep -qE 'passed|failed'";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F56-passed-grep")).toBe(true);
  });

  it("MINOR-5: `grep -q passed` (unquoted) flags F56-passed-grep", () => {
    const cmd = "npx vitest run | grep -q passed";
    const r = lintAcCommand(cmd);
    expect(r.findings.some((f) => f.ruleId === "F56-passed-grep")).toBe(true);
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
      "F55-vitest-count-grep",
      "F56-multigrep-pipe",
      "F56-passed-grep",
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
    // No preceding pipe-into-grep, so F56-passed-grep should not match.
    expect(lintAcCommand("echo 'passed'").suspect).toBe(false);
  });

  it("jq '.passed' does not false-positive F56-passed-grep", () => {
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
      lintExempt: { ruleId: "F56-passed-grep", rationale: "legacy: reviewed" },
    });
    expect(r.suspect).toBe(false);
    const finding = r.findings.find((f) => f.ruleId === "F56-passed-grep");
    expect(finding?.exempt).toBe(true);
    expect(finding?.exemptRationale).toBe("legacy: reviewed");
  });

  it("exempt rule X + match rule Y → still suspect on Y", () => {
    // Matches F55 (count-grep) but exempt only covers F56-passed-grep.
    const cmd = "npx vitest run | grep -qE 'Tests[[:space:]]+[5-9]'";
    const r = lintAcCommand(cmd, {
      lintExempt: { ruleId: "F56-passed-grep", rationale: "n/a" },
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
        { ruleId: "F56-passed-grep", rationale: "a" },
        { ruleId: "F56-multigrep-pipe", rationale: "b" },
      ],
    });
    expect(r.suspect).toBe(false);
  });
});

describe("lintPlan — governance cap and plan-level aggregation", () => {
  function mkPlan(acs: Array<{ id: string; command: string; lintExempt?: any }>) {
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
        lintExempt: { ruleId: "F56-passed-grep", rationale: "ok" },
      },
      {
        id: "AC-02",
        command: "cmd | grep -q 'passed'",
        lintExempt: { ruleId: "F56-passed-grep", rationale: "ok" },
      },
      {
        id: "AC-03",
        command: "cmd | grep -q 'passed'",
        lintExempt: { ruleId: "F56-passed-grep", rationale: "ok" },
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
