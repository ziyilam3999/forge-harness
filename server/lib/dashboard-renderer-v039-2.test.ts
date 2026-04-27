/**
 * v0.39.2 — renderer-level tests for the four binary AC that target the
 * rendered HTML directly:
 *
 *   AC-1 (B12 + W2)  — warning chip register: every spec-generator warning
 *                      renders amber `card-warning-chip warning`; the old
 *                      `kind === "stripped-unknown-identifier" → "error"`
 *                      mapping is gone.
 *   AC-2 (B7 + W3)   — IN PROGRESS column reachable from run records:
 *                      stories whose IDs appear in `inProgressFromRuns`
 *                      route to `COLUMN_IDS.inProgress` regardless of
 *                      their underlying StoryStatus and even when
 *                      `.forge/activity.json` is idle.
 *   AC-3 (B11 + W4)  — IDLE pill animation: the rendered HTML contains an
 *                      `@keyframes` definition referenced by an
 *                      `animation:` declaration on `.forge-pulse.idle`.
 *   AC-4 (F4 + W1)   — sub-stage timestamps respect parent envelope close
 *                      time: a sub-stage entry timestamped after the
 *                      latest `forge_evaluate` close envelope renders
 *                      with the timestamp clipped to that close.
 */

import { describe, it, expect } from "vitest";
import {
  renderDashboardHtml,
  COLUMN_IDS,
  type AuditFeedEntry,
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

// ── AC-1 — warning chip register ───────────────────────────────────────────

describe("AC-1 — warning chip register (B12 + W2)", () => {
  it("warning chip register: stripped-unknown-identifier renders amber, not red", () => {
    const brief = makeBrief("in-progress", [makeStoryEntry("US-08", "ready")]);
    const groundingSignals = new Map<string, StoryGroundingSignal>();
    groundingSignals.set("US-08", {
      storyId: "US-08",
      affectedPaths: [],
      warnings: [
        {
          kind: "stripped-unknown-identifier",
          identifier: "MysteryThing",
          section: "data-models",
          filesScanned: 4,
        },
      ],
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

    // Exactly one amber chip emitted by renderWarningChips for this signal.
    const amberMatches =
      html.match(/class="card-warning-chip warning"/g) ?? [];
    expect(amberMatches.length).toBe(1);

    // No `card-warning-chip error` rendered chip — the renderWarningChips
    // path no longer maps any kind to "error". The CSS class definition
    // continues to exist (G1 invariant) but no chip-emitting site uses it.
    expect(html).not.toContain('class="card-warning-chip error"');
  });

  it("warning chip register: no-vocabulary still renders amber (regression guard)", () => {
    const brief = makeBrief("in-progress", [makeStoryEntry("US-08", "ready")]);
    const groundingSignals = new Map<string, StoryGroundingSignal>();
    groundingSignals.set("US-08", {
      storyId: "US-08",
      affectedPaths: [],
      warnings: [{ kind: "no-vocabulary", filesScanned: 0 }],
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

    expect(html).toContain('class="card-warning-chip warning"');
    expect(html).not.toContain('class="card-warning-chip error"');
  });
});

// ── AC-2 — IN PROGRESS column reachable from run records ──────────────────

describe("AC-2 — in-progress column reachable from run records (B7 + W3)", () => {
  it("in-progress column reachable from run records: idle activity, fresh run record, story routed to in-progress", () => {
    const brief = makeBrief("in-progress", [makeStoryEntry("US-08", "ready")]);
    const html = renderDashboardHtml({
      brief,
      activity: null, // .forge/activity.json idle
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
      // Upstream populator (readInProgressStoryIds) will produce this set
      // when a story's run record post-dates the coordinate brief.
      inProgressFromRuns: new Set<string>(["US-08"]),
    });

    // Locate the in-progress column block by its `id="<COLUMN_IDS.inProgress>"`
    // attribute and verify the US-08 story card lives inside.
    const columnRegex = new RegExp(
      `<div class="kanban-column[^"]*" id="${COLUMN_IDS.inProgress}">([\\s\\S]*?)</div>\\s*</div>`,
    );
    const columnMatch = columnRegex.exec(html);
    expect(columnMatch, "in-progress column not found in rendered HTML").not.toBeNull();
    const columnHtml = columnMatch?.[0] ?? "";
    expect(columnHtml).toContain('data-story-id="US-08"');

    // Negative — US-08 should NOT also appear in the ready column.
    const readyRegex = new RegExp(
      `<div class="kanban-column[^"]*" id="${COLUMN_IDS.ready}">([\\s\\S]*?)</div>\\s*</div>`,
    );
    const readyMatch = readyRegex.exec(html);
    const readyHtml = readyMatch?.[0] ?? "";
    expect(readyHtml).not.toContain('data-story-id="US-08"');
  });

  it("in-progress column reachable from run records: empty inProgressFromRuns leaves status-based routing intact", () => {
    const brief = makeBrief("in-progress", [makeStoryEntry("US-08", "ready")]);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
      // no inProgressFromRuns — defaults to empty set
    });

    const readyRegex = new RegExp(
      `<div class="kanban-column[^"]*" id="${COLUMN_IDS.ready}">([\\s\\S]*?)</div>\\s*</div>`,
    );
    const readyMatch = readyRegex.exec(html);
    const readyHtml = readyMatch?.[0] ?? "";
    expect(readyHtml).toContain('data-story-id="US-08"');
  });

  it("in-progress column reachable from run records: terminal `done` status not overridden", () => {
    // Defensive guardrail — a freshly finished story should appear in DONE,
    // not IN PROGRESS, even if its run record is the freshest write.
    const brief = makeBrief("in-progress", [makeStoryEntry("US-08", "done")]);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
      inProgressFromRuns: new Set<string>(["US-08"]),
    });

    const doneRegex = new RegExp(
      `<div class="kanban-column[^"]*" id="${COLUMN_IDS.done}">([\\s\\S]*?)</div>\\s*</div>`,
    );
    const doneMatch = doneRegex.exec(html);
    const doneHtml = doneMatch?.[0] ?? "";
    expect(doneHtml).toContain('data-story-id="US-08"');

    const inProgressRegex = new RegExp(
      `<div class="kanban-column[^"]*" id="${COLUMN_IDS.inProgress}">([\\s\\S]*?)</div>\\s*</div>`,
    );
    const inProgressMatch = inProgressRegex.exec(html);
    const inProgressHtml = inProgressMatch?.[0] ?? "";
    expect(inProgressHtml).not.toContain('data-story-id="US-08"');
  });
});

// ── AC-3 — IDLE pill animation ─────────────────────────────────────────────

describe("AC-3 — idle pill animation (B11 + W4)", () => {
  it("idle pill animation: <style> contains a keyframes referenced by an animation declaration on .forge-pulse.idle", () => {
    const brief = makeBrief("in-progress", [makeStoryEntry("US-08", "ready")]);
    const html = renderDashboardHtml({
      brief,
      activity: null, // idle pulse state
      auditEntries: [],
      renderedAt: "2026-04-27T00:00:00.000Z",
    });

    // Extract the inline <style> block — there is exactly one in the rendered
    // output, between <style> and </style>.
    const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
    expect(styleMatch, "no <style> block found in rendered HTML").not.toBeNull();
    const css = styleMatch?.[1] ?? "";

    // 1. There exists an `.forge-pulse.idle` rule (or descendant `.idle .hex`
    //    rule) carrying an `animation:` declaration. This is the live half of
    //    the link.
    const idleAnimationRegex =
      /\.forge-pulse\.idle\b[^{]*\{[^}]*animation\s*:\s*([a-zA-Z][\w-]*)\b/;
    const idleAnimationMatch = idleAnimationRegex.exec(css);
    expect(
      idleAnimationMatch,
      "no `animation:` declaration found on a `.forge-pulse.idle` rule",
    ).not.toBeNull();
    const animationName = idleAnimationMatch?.[1] ?? "";
    expect(animationName.length).toBeGreaterThan(0);

    // 2. There exists a matching `@keyframes <name>` definition. This is the
    //    other half of the link — without it the animation declaration is a
    //    dead reference and the idle pill would not actually pulse.
    const keyframesRegex = new RegExp(
      `@keyframes\\s+${animationName.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\\\$&")}\\s*\\{`,
    );
    expect(
      keyframesRegex.test(css),
      `no matching @keyframes definition for "${animationName}"`,
    ).toBe(true);

    // 3. `prefers-reduced-motion` block continues to disable hex animations
    //    (existing rule covers descendants of `.forge-pulse` regardless of
    //    sub-class). Smoke check: the literal `animation: none !important`
    //    inside a reduced-motion block is still present.
    expect(css).toMatch(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{[\s\S]*animation\s*:\s*none\s*!important/,
    );
  });
});

// ── AC-4 — sub-stage timestamps respect parent envelope ────────────────────

describe("AC-4 — sub-stage timestamps respect parent envelope (F4 + W1)", () => {
  function makeFeedEntry(
    overrides: Partial<AuditFeedEntry> & Pick<AuditFeedEntry, "timestamp" | "tool">,
  ): AuditFeedEntry {
    return {
      stage: "",
      agentRole: "",
      decision: "",
      reasoning: "",
      ...overrides,
    } as AuditFeedEntry;
  }

  it("sub-stage timestamps respect parent envelope: spec-gen entry timestamped after forge_evaluate close clips to close timestamp", () => {
    const tClose = "2026-04-27T03:07:56.000Z";
    const tSubstage = "2026-04-27T03:08:10.000Z";
    const auditEntries: AuditFeedEntry[] = [
      makeFeedEntry({
        timestamp: tClose,
        tool: "forge_evaluate",
        stage: "close",
        agentRole: "evaluator",
        decision: "PASS",
      }),
      makeFeedEntry({
        timestamp: tSubstage,
        tool: "spec-gen",
        stage: "complete",
        agentRole: "generator",
        decision: "ok",
      }),
    ];
    const brief = makeBrief("in-progress", []);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries,
      renderedAt: "2026-04-27T03:10:00.000Z",
    });

    // The sub-stage's data-iso must be clipped to tClose, not tSubstage.
    // The unclamped timestamp must not appear anywhere in the rendered
    // feed-entry markup for the sub-stage row.
    const specGenRegex =
      /<div class="feed-entry">[\s\S]*?<span class="feed-time" data-iso="([^"]+)">[\s\S]*?<span class="feed-tool"><span class="hex-dot"><\/span>spec-gen<\/span>[\s\S]*?<\/div>/;
    const specGenMatch = specGenRegex.exec(html);
    expect(specGenMatch, "spec-gen feed entry not found").not.toBeNull();
    const renderedIso = specGenMatch?.[1] ?? "";
    expect(renderedIso).toBe(tClose);
    expect(renderedIso).not.toBe(tSubstage);
  });

  it("sub-stage timestamps respect parent envelope: entries before the close are untouched", () => {
    const tEarly = "2026-04-27T03:00:00.000Z";
    const tClose = "2026-04-27T03:07:56.000Z";
    const auditEntries: AuditFeedEntry[] = [
      makeFeedEntry({
        timestamp: tEarly,
        tool: "forge_plan",
        stage: "begin",
        agentRole: "planner",
        decision: "ok",
      }),
      makeFeedEntry({
        timestamp: tClose,
        tool: "forge_evaluate",
        stage: "close",
        agentRole: "evaluator",
        decision: "PASS",
      }),
    ];
    const brief = makeBrief("in-progress", []);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries,
      renderedAt: "2026-04-27T03:10:00.000Z",
    });

    // forge_plan entry's data-iso stays at tEarly — no clipping for entries
    // already before the close.
    const planRegex =
      /<div class="feed-entry">[\s\S]*?<span class="feed-time" data-iso="([^"]+)">[\s\S]*?<span class="feed-tool"><span class="hex-dot"><\/span>forge_plan<\/span>[\s\S]*?<\/div>/;
    const planMatch = planRegex.exec(html);
    expect(planMatch).not.toBeNull();
    expect(planMatch?.[1]).toBe(tEarly);
  });

  it("sub-stage timestamps respect parent envelope: no close envelope present means no clipping", () => {
    const tA = "2026-04-27T03:00:00.000Z";
    const tB = "2026-04-27T03:08:10.000Z";
    const auditEntries: AuditFeedEntry[] = [
      makeFeedEntry({
        timestamp: tA,
        tool: "forge_plan",
        stage: "begin",
        agentRole: "planner",
        decision: "ok",
      }),
      makeFeedEntry({
        timestamp: tB,
        tool: "spec-gen",
        stage: "complete",
        agentRole: "generator",
        decision: "ok",
      }),
    ];
    const brief = makeBrief("in-progress", []);
    const html = renderDashboardHtml({
      brief,
      activity: null,
      auditEntries,
      renderedAt: "2026-04-27T03:10:00.000Z",
    });

    expect(html).toContain(`data-iso="${tA}"`);
    expect(html).toContain(`data-iso="${tB}"`);
  });
});
