// Mobile / narrow responsive layout (v0.46.x). The 6-column board is a wide,
// short artifact that crops sideways or floats as an island on a tall phone, so
// at <=640px the board collapses to a vertical "grouped-by-status list": the six
// statuses stack full-width in workflow order, empty statuses collapse to a
// one-line header (the `is-empty` class), and card fonts step up to the mobile
// legibility floor. These assertions lock BOTH ends: the markup hook (is-empty)
// and the CSS behaviour (single-column reflow + collapse + enlarged fonts).
import { describe, it, expect } from "vitest";
import { renderDashboardHtml, type DashboardRenderInput } from "./dashboard-renderer.js";
import type { PhaseTransitionBrief, StoryStatusEntry } from "../types/coordinate-result.js";

function story(storyId: string, status: StoryStatusEntry["status"]): StoryStatusEntry {
  return { storyId, status, retryCount: 0, retriesRemaining: 3, priorEvalReport: null, evidence: null };
}

function brief(stories: StoryStatusEntry[]): PhaseTransitionBrief {
  return {
    status: "in-progress",
    stories,
    readyStories: [],
    depFailedStories: [],
    failedStories: [],
    completedCount: stories.filter((s) => s.status === "done").length,
    totalCount: stories.length,
    budget: { usedUsd: 0, budgetUsd: null, remainingUsd: null, incompleteData: false, warningLevel: "none" },
    timeBudget: { elapsedMs: 0, maxTimeMs: null, warningLevel: "none" },
    replanningNotes: [],
    recommendation: "",
    configSource: {},
  };
}

function render(stories: StoryStatusEntry[]): string {
  const input: DashboardRenderInput = {
    brief: brief(stories),
    activity: null,
    auditEntries: [],
    renderedAt: "2026-06-14T00:00:00.000Z",
  };
  return renderDashboardHtml(input);
}

/** Pull the opening tag of a column wrapper (anchored to the class, so the CSS
 *  `[id="col-x"]` selectors inside <style> are ignored). */
function columnTag(html: string, columnId: string): string {
  const m = new RegExp(`<div class="kanban-column[^"]*" id="${columnId}">`).exec(html);
  if (!m) throw new Error(`column ${columnId} not found`);
  return m[0];
}

describe("dashboard mobile / narrow responsive layout", () => {
  it("marks zero-card columns with is-empty and full columns without it", () => {
    // 3 done -> DONE is full; the other five statuses are empty.
    const html = render([story("DEMO-1", "done"), story("DEMO-2", "done"), story("DEMO-3", "done")]);
    expect(columnTag(html, "col-done")).not.toContain("is-empty");
    for (const empty of ["col-backlog", "col-ready", "col-in-progress", "col-retry", "col-blocked"]) {
      expect(columnTag(html, empty)).toContain("is-empty");
    }
  });

  it("does not mark a populated column as empty", () => {
    const html = render([story("DEMO-1", "pending")]); // pending routes to backlog
    expect(columnTag(html, "col-backlog")).not.toContain("is-empty");
    expect(columnTag(html, "col-done")).toContain("is-empty");
  });

  it("ships a <=640px media query that reflows the board to a single column", () => {
    const html = render([story("DEMO-1", "done")]);
    // The mobile block is the last rule in DASHBOARD_CSS, so capture from its
    // opener to the closing </style> (greedy-to-style-end, not first nested }).
    const media = /@media \(max-width: 640px\) \{[\s\S]*?<\/style>/.exec(html);
    expect(media, "mobile media query present").not.toBeNull();
    const css = media![0];
    // board -> one vertical column (the grouped-by-status list)
    expect(css).toMatch(/\.kanban-board\s*\{\s*grid-template-columns:\s*1fr/);
    // empty sections collapse (body hidden) so the board stays scannable
    expect(css).toMatch(/\.kanban-column\.is-empty\s+\.column-body\s*\{\s*display:\s*none/);
    // legibility floor: card body bumped to >=16px on mobile
    expect(css).toMatch(/\.story-card\s*\{\s*font-size:\s*16px/);
  });

  it("leaves the desktop board as a 6-column grid (no responsive regression)", () => {
    const html = render([story("DEMO-1", "done")]);
    // The base (desktop) rule is unchanged: 6 equal columns.
    expect(html).toMatch(/\.kanban-board\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(6,\s*1fr\)/);
  });
});
