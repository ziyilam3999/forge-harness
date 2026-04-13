import { describe, it, expect } from "vitest";
import {
  buildCriticPrompt,
  renderAcLintRulesForCritic,
} from "./critic.js";
import { AC_LINT_RULES } from "./shared/ac-subprocess-rules.js";

describe("buildCriticPrompt — Q0.5/A2 subprocess-safety parity", () => {
  it("embeds the full AC Command Contract prompt block", () => {
    const prompt = buildCriticPrompt(1);
    expect(prompt).toContain("AC Command Contract");
    expect(prompt).toContain("node:child_process.exec()");
    expect(prompt).toContain("30s timeout");
  });

  it("cites every AC_LINT_RULES id as a structured bullet", () => {
    const prompt = buildCriticPrompt(1);
    for (const rule of AC_LINT_RULES) {
      expect(prompt, `rule ${rule.id} must appear`).toContain(rule.id);
      expect(prompt, `${rule.id} wrongExample`).toContain(rule.wrongExample);
      expect(prompt, `${rule.id} rightExample`).toContain(rule.rightExample);
    }
  });

  it("includes a Subprocess Safety category (#9) in the What to Check list", () => {
    const prompt = buildCriticPrompt(1);
    expect(prompt).toMatch(/9\.\s+\*\*Subprocess Safety/);
  });

  it("round-2 regression check survives the rule injection", () => {
    const round2 = buildCriticPrompt(2);
    expect(round2).toContain("Regression Check (Round 2 Only)");
    expect(round2).toContain("F55-vitest-count-grep");
  });
});

describe("renderAcLintRulesForCritic", () => {
  it("renders exactly 5 bullets, one per rule", () => {
    const rendered = renderAcLintRulesForCritic();
    const bulletCount = rendered.split(/^- \*\*/gm).length - 1;
    expect(bulletCount).toBe(AC_LINT_RULES.length);
  });

  it("each bullet has Wrong and Right lines", () => {
    const rendered = renderAcLintRulesForCritic();
    const wrongCount = (rendered.match(/Wrong:/g) ?? []).length;
    const rightCount = (rendered.match(/Right:/g) ?? []).length;
    expect(wrongCount).toBe(AC_LINT_RULES.length);
    expect(rightCount).toBe(AC_LINT_RULES.length);
  });
});
