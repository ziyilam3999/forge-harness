/**
 * v0.39.0 — renderer-level tests for the binary AC that target the
 * rendered HTML directly:
 *
 *   AC-3 — `data-master-merged="true"` for stories the master-reconciler
 *          upgraded; `"false"` for everything else.
 *   AC-6 — phase-status pill renamed away from "in-progress" so its
 *          class + visible text don't collide with the kanban "IN
 *          PROGRESS" column heading. v0.39.5 retired the pill entirely
 *          (the orange ACTIVE pill duplicated the green phase-tag); the
 *          green phase-tag is now the canonical phase-status surface,
 *          and the AC-6 collision invariants are satisfied vacuously
 *          (no pill class exists at all).
 *   AC-7 — `nonFatalWarnings` reach the rendered HTML when present;
 *          empty array produces no warning markup.
 */

import { describe, it, expect } from "vitest";
import {
  renderDashboardHtml,
  type StoryGroundingSignal,
} from "./dashboard-renderer.js";
import type {
  PhaseTransitionBrief,
  StoryStatusEntry,
} from "../types/coordinate-result.js";

function makeStoryEntry(
  storyId: string,
  status: StoryStatusEntry["status"],
): StoryStatusEntry {
  return {
    storyId,
    status,
    retryCount: 0,
    retriesRemaining: 3,
    priorEvalReport: null,
    evidence: null,
  };
}

function makeBrief(
  status: PhaseTransitionBrief["status"],
  stories: StoryStatusEntry[],
): PhaseTransitionBrief {
  return {
    status,
    stories,
    readyStories: [],
    depFailedStories: [],
    failedStories: [],
    completedCount: stories.filter((s) => s.status === "done").length,
    totalCount: stories.length,
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
  };
}

// ── AC-3 — master-merged attribute ─────────────────────────────────────────

describe("AC-3 — data-master-merged attribute on story cards", () => {
  it("upgraded story carries data-master-merged='true'; others carry 'false'", () => {
    const brief = makeBrief("in-progress", [
      makeStoryEntry("US-05", "done"),
      makeStoryEntry("US-06", "ready"),
    ]);
    const masterMergedIds = new Set<string>(["US-05"]);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
      masterMergedIds,
    });
    expect(
      /<div class="story-card[^"]*" data-story-id="US-05" data-master-merged="true">/.test(
        html,
      ),
    ).toBe(true);
    expect(
      /<div class="story-card[^"]*" data-story-id="US-06" data-master-merged="false">/.test(
        html,
      ),
    ).toBe(true);
  });

  it("when masterMergedIds is omitted, every card carries data-master-merged='false'", () => {
    const brief = makeBrief("in-progress", [
      makeStoryEntry("US-09", "ready"),
    ]);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
    });
    expect(
      /<div class="story-card[^"]*" data-story-id="US-09" data-master-merged="false">/.test(
        html,
      ),
    ).toBe(true);
    // Negative — never the literal "true" for an unmerged card.
    expect(html).not.toMatch(/data-story-id="US-09" data-master-merged="true"/);
  });
});

// ── AC-6 — top-bar pill collision (now retired in v0.39.5) ─────────────────

describe("AC-6 — phase-status surface no longer collides with the IN PROGRESS column", () => {
  it("status='in-progress' brief produces 0 occurrences of 'phase-status-pill' in HTML", () => {
    const brief = makeBrief("in-progress", [makeStoryEntry("US-01", "ready")]);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
    });
    const occurrences = (html.match(/phase-status-pill/g) ?? []).length;
    expect(occurrences).toBe(0);
  });

  it("phase-tag emits non-empty visible text for in-progress briefs without the ambiguous space-form", () => {
    const brief = makeBrief("in-progress", [makeStoryEntry("US-01", "ready")]);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
    });
    const tagMatch = /<div class="phase-tag">([^<]+)<\/div>/.exec(html);
    expect(tagMatch).not.toBeNull();
    const visible = tagMatch?.[1] ?? "";
    expect(visible.length).toBeGreaterThan(0);
    // Visible text MUST NOT contain "in progress" (case-insensitive, with
    // space). The literal "in-progress" with hyphen is fine — the AC
    // forbids the ambiguous space-form that visually duplicates the
    // kanban column title.
    expect(/in\s+progress/i.test(visible)).toBe(false);
  });

  it("status='complete' surfaces the literal token in the phase-tag", () => {
    const brief = makeBrief("complete", [makeStoryEntry("US-01", "done")]);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
    });
    expect(html).toContain('<div class="phase-tag">complete</div>');
  });
});

// ── AC-7 — nonFatalWarnings ─────────────────────────────────────────────────

describe("AC-7 — nonFatalWarnings reach the dashboard", () => {
  it("brief with nonFatalWarnings: ['DOMMatrix polyfill skipped'] surfaces the literal substring", () => {
    const brief = makeBrief("complete", [makeStoryEntry("US-77", "done")]);
    const groundingSignals = new Map<string, StoryGroundingSignal>();
    groundingSignals.set("US-77", {
      storyId: "US-77",
      affectedPaths: [],
      warnings: [],
      latestRunTimestamp: "2026-04-27T00:00:00.000Z",
      nonFatalWarnings: ["DOMMatrix polyfill skipped"],
    });
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
      groundingSignals,
    });
    expect(html).toContain("DOMMatrix polyfill skipped");
  });

  it("brief with nonFatalWarnings: [] produces no warning markup for that story", () => {
    const brief = makeBrief("complete", [makeStoryEntry("US-77", "done")]);
    const groundingSignals = new Map<string, StoryGroundingSignal>();
    groundingSignals.set("US-77", {
      storyId: "US-77",
      affectedPaths: [],
      warnings: [],
      latestRunTimestamp: "2026-04-27T00:00:00.000Z",
      nonFatalWarnings: [],
    });
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
      groundingSignals,
    });
    expect(html).not.toContain("DOMMatrix polyfill skipped");
    // No card-non-fatal-warning element for this empty case.
    expect(html).not.toContain('data-non-fatal-warning="true"');
  });
});
