/**
 * v0.36.x — dashboard dark-mode tests (plan AC-5).
 *
 * Covers the four AC-5 assertions:
 *   (a) HTML contains the `@media (prefers-color-scheme: dark)` block exactly once.
 *   (b) Every variable named in AC-4 appears redefined inside that block.
 *   (c) The existing `@media (prefers-reduced-motion: reduce)` block still
 *       appears exactly once (no duplication regression).
 *   (d) The light-theme `:root` block still sets `--off-white: #efece5`
 *       (G2 byte-identity canary — proves the light variables weren't edited).
 *
 * Mirrors the structure of `dashboard-renderer-polish.test.ts` — render once
 * via a minimal `DashboardRenderInput`, then grep the resulting HTML.
 */

import { describe, it, expect } from "vitest";

import {
  renderDashboardHtml,
  type DashboardRenderInput,
} from "./dashboard-renderer.js";
import type { PhaseTransitionBrief } from "../types/coordinate-result.js";

function makeBrief(
  overrides: Partial<PhaseTransitionBrief> = {},
): PhaseTransitionBrief {
  return {
    status: "in-progress",
    stories: [],
    readyStories: [],
    depFailedStories: [],
    failedStories: [],
    completedCount: 0,
    totalCount: 0,
    budget: {
      usedUsd: 0,
      budgetUsd: null,
      remainingUsd: null,
      incompleteData: false,
      warningLevel: "none",
    },
    timeBudget: { elapsedMs: 0, maxTimeMs: null, warningLevel: "none" },
    replanningNotes: [],
    recommendation: "",
    configSource: {},
    ...overrides,
  };
}

function baseInput(
  brief: Partial<PhaseTransitionBrief> = {},
  extra: Partial<DashboardRenderInput> = {},
): DashboardRenderInput {
  return {
    brief: makeBrief(brief),
    activity: null,
    auditEntries: [],
    renderedAt: "2026-04-26T09:00:00.000Z",
    ...extra,
  };
}

/** Count non-overlapping occurrences of a literal substring in a string. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

/**
 * Extract the body of the `@media (prefers-color-scheme: dark) { ... }`
 * block from the rendered HTML. The block uses `{ :root { ... } /* ... *​/
 * ...overrides... }` shape, so we capture everything from the first `{`
 * after the media query down to its matching closing `}` via a depth count.
 *
 * Returns the inner contents (everything between the outer `{` and `}`).
 */
function extractDarkMediaBlock(html: string): string {
  const start = html.indexOf("@media (prefers-color-scheme: dark)");
  if (start === -1) {
    throw new Error(
      "Dark-mode @media block not found. HTML excerpt: " + html.slice(0, 500),
    );
  }
  const openBrace = html.indexOf("{", start);
  if (openBrace === -1) {
    throw new Error("Dark-mode @media block has no opening brace.");
  }
  let depth = 1;
  let i = openBrace + 1;
  while (i < html.length && depth > 0) {
    const ch = html[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (depth === 0) break;
    i += 1;
  }
  if (depth !== 0) {
    throw new Error("Dark-mode @media block has unbalanced braces.");
  }
  return html.slice(openBrace + 1, i);
}

describe("AC-5 — dashboard dark-mode CSS", () => {
  it("(a) rendered HTML contains the `@media (prefers-color-scheme: dark)` block exactly once", () => {
    const html = renderDashboardHtml(baseInput());
    expect(countOccurrences(html, "@media (prefers-color-scheme: dark)")).toBe(
      1,
    );
  });

  it("(b) the dark-mode @media block redefines every required CSS variable from AC-4", () => {
    const html = renderDashboardHtml(baseInput());
    const block = extractDarkMediaBlock(html);

    // AC-4 — at least these variables must be redefined inside the block.
    const requiredVars = [
      "--white",
      "--off-white",
      "--border",
      "--border-light",
      "--text",
      "--text-secondary",
      "--text-dim",
      "--green",
      "--green-bg",
      "--amber",
      "--amber-bg",
      "--red",
      "--red-bg",
      "--grey",
    ];

    for (const name of requiredVars) {
      // Match `--name:` (declaration), not just `var(--name)` (consumption).
      // The trailing colon is what distinguishes a custom-property
      // declaration in the :root block from a `var()` reference inside an
      // override selector below it.
      expect(block, `expected ${name}: declaration in dark-mode @media block`)
        .toContain(name + ":");
    }
  });

  it("(c) the existing @media (prefers-reduced-motion: reduce) block still appears exactly once", () => {
    const html = renderDashboardHtml(baseInput());
    expect(
      countOccurrences(html, "@media (prefers-reduced-motion: reduce)"),
    ).toBe(1);
  });

  it("(d) the light-theme :root block still defines --off-white: #efece5 (G2 byte-identity canary)", () => {
    const html = renderDashboardHtml(baseInput());
    // The light-theme :root block must keep the pre-change off-white value.
    // If a future edit accidentally changed the light theme, this canary
    // fails loudly. Asserts the literal substring rather than parsing CSS.
    expect(html).toContain("--off-white: #efece5");
  });
});
