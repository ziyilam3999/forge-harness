/**
 * v0.38.0 (I1+I2+I3+I7) — dashboard grounding-observability signals.
 *
 * Covers AC-3 (no-vocabulary chip + data-warning + data-severity=warning),
 * AC-4 (stripped-unknown-identifier chip + data-severity=error),
 * AC-5 (per-path data-path-exists indicators ✓/✗),
 * AC-7 (Recommendation card drift line / regex match in both directions).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderDashboardHtml,
  type DashboardRenderInput,
  type StoryGroundingSignal,
} from "./dashboard-renderer.js";
import type {
  PhaseTransitionBrief,
  StoryStatusEntry,
} from "../types/coordinate-result.js";
import type { SpecGeneratorWarning } from "./run-record.js";

function makeStoryEntry(
  storyId: string,
  status: StoryStatusEntry["status"] = "done",
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
    recommendation: "Ship it",
    configSource: {},
    ...overrides,
  };
}

function makeSignal(
  storyId: string,
  warnings: SpecGeneratorWarning[],
  affectedPaths: string[] = [],
): StoryGroundingSignal {
  return {
    storyId,
    warnings,
    affectedPaths,
    latestRunTimestamp: "2026-04-26T00:00:00.000Z",
    // v0.39.0 — required field; default empty so existing tests stay
    // byte-stable on the warning chip + path indicator paths.
    nonFatalWarnings: [],
  };
}

function baseInput(
  briefOverrides: Partial<PhaseTransitionBrief>,
  extra: Partial<DashboardRenderInput> = {},
): DashboardRenderInput {
  return {
    brief: makeBrief(briefOverrides),
    activity: null,
    auditEntries: [],
    renderedAt: "2026-04-26T00:00:00.000Z",
    ...extra,
  };
}

/**
 * Extract a specific story card's HTML fragment from the rendered dashboard.
 * Walks div nesting from the opening `<div class="story-card ..." data-story-id="<id>">`
 * tag and returns the substring up to the matching close.
 */
function extractStoryCard(html: string, storyId: string): string {
  // v0.39.0 — story cards may carry additional attributes (e.g.
  // `data-master-merged="true|false"`) after `data-story-id`, so the
  // closing `>` is no longer guaranteed to follow the story-id attribute
  // immediately. Match any subsequent attributes up to the tag close.
  const re = new RegExp(
    `<div class="story-card[^"]*" data-story-id="${storyId}"[^>]*>`,
  );
  const match = re.exec(html);
  if (!match) throw new Error(`story card for ${storyId} not found in HTML`);
  const tagStart = match.index;
  let depth = 1;
  let i = tagStart + match[0].length;
  const openRe = /<div\b/g;
  const closeRe = /<\/div>/g;
  while (depth > 0 && i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      i = nextOpen.index + 4;
    } else {
      depth -= 1;
      i = nextClose.index + 6;
    }
  }
  return html.slice(tagStart, i);
}

describe("dashboard grounding signals — v0.38.0 (I1+I2+I3+I7)", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "forge-dashboard-"));
    mkdirSync(join(projectPath, "src", "foo"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("AC-3: no-vocabulary warning renders chip with data-warning + data-severity=warning", () => {
    const brief = makeBrief({
      stories: [makeStoryEntry("US-01", "done")],
      completedCount: 1,
      totalCount: 1,
    });
    const signals = new Map<string, StoryGroundingSignal>([
      [
        "US-01",
        makeSignal("US-01", [{ kind: "no-vocabulary", filesScanned: 0 }]),
      ],
    ]);
    const html = renderDashboardHtml(
      baseInput(brief, { groundingSignals: signals, projectPath }),
    );
    const card = extractStoryCard(html, "US-01");

    // Both attributes co-located inside the same chip element.
    expect(card).toMatch(
      /<span class="card-warning-chip[^"]*"[^>]*data-warning="no-vocabulary"[^>]*data-severity="warning"/,
    );
  });

  it("AC-4: stripped-unknown-identifier renders amber chip with data-severity=warning (v0.39.2 B12 fix)", () => {
    // v0.39.2 AC-1/B12 — every spec-generator warning now renders amber.
    // The previous "error" severity painted a non-fatal warning red, the
    // colour reserved for actual failures. The CSS class
    // `.card-warning-chip.error` continues to exist (G1 invariant) but no
    // chip-emitting site uses it at this revision.
    const brief = makeBrief({
      stories: [makeStoryEntry("US-02", "done")],
      completedCount: 1,
      totalCount: 1,
    });
    const signals = new Map<string, StoryGroundingSignal>([
      [
        "US-02",
        makeSignal("US-02", [
          {
            kind: "stripped-unknown-identifier",
            identifier: "FooClass",
            section: "data-models",
            filesScanned: 5,
          },
        ]),
      ],
    ]);
    const html = renderDashboardHtml(
      baseInput(brief, { groundingSignals: signals, projectPath }),
    );
    const card = extractStoryCard(html, "US-02");

    expect(card).toMatch(
      /<span class="card-warning-chip[^"]*"[^>]*data-warning="stripped-unknown-identifier"[^>]*data-severity="warning"/,
    );
  });

  it("AC-5: per-path ✓/✗ indicators with data-path-exists attributes", () => {
    const brief = makeBrief({
      stories: [makeStoryEntry("US-03", "ready")],
      completedCount: 0,
      totalCount: 1,
    });
    const signals = new Map<string, StoryGroundingSignal>([
      [
        "US-03",
        makeSignal("US-03", [], ["src/foo/", "src/bar/"]),
      ],
    ]);
    const html = renderDashboardHtml(
      baseInput(brief, { groundingSignals: signals, projectPath }),
    );
    const card = extractStoryCard(html, "US-03");

    // src/foo/ exists in the tmpdir → data-path-exists="true" near the path text.
    expect(card).toMatch(
      /data-path-exists="true"[^>]*>[\s\S]*?src\/foo\//,
    );
    // src/bar/ does NOT exist in the tmpdir → data-path-exists="false"
    expect(card).toMatch(
      /data-path-exists="false"[^>]*>[\s\S]*?src\/bar\//,
    );
  });

  it("AC-7 positive: shipped story with no-vocabulary warning produces drift line matching the regex", () => {
    const brief = makeBrief({
      stories: [makeStoryEntry("US-04", "done")],
      completedCount: 1,
      totalCount: 1,
      recommendation: "Continue execution",
    });
    const signals = new Map<string, StoryGroundingSignal>([
      [
        "US-04",
        makeSignal("US-04", [{ kind: "no-vocabulary", filesScanned: 0 }]),
      ],
    ]);
    const html = renderDashboardHtml(
      baseInput(brief, { groundingSignals: signals, projectPath }),
    );

    // Goal regex from AC-7: /⚠ \d+ stor(y|ies) shipped with [a-z\-]+ warning/
    expect(html).toMatch(
      /⚠\s+\d+\s+stor(y|ies)\s+shipped\s+with\s+[a-z-]+\s+warning/,
    );
  });

  it("AC-7 negative: zero shipped stories with warnings produces NO matching drift line", () => {
    const brief = makeBrief({
      stories: [makeStoryEntry("US-05", "done")],
      completedCount: 1,
      totalCount: 1,
      recommendation: "Continue execution",
    });
    // Story shipped clean — no warnings.
    const signals = new Map<string, StoryGroundingSignal>([
      ["US-05", makeSignal("US-05", [], [])],
    ]);
    const html = renderDashboardHtml(
      baseInput(brief, { groundingSignals: signals, projectPath }),
    );

    expect(html).not.toMatch(
      /⚠\s+\d+\s+stor(y|ies)\s+shipped\s+with\s+[a-z-]+\s+warning/,
    );
  });

  it("AC-7 negative: warnings on a non-shipped story do not appear in the drift line", () => {
    const brief = makeBrief({
      stories: [makeStoryEntry("US-06", "ready")], // not done
      completedCount: 0,
      totalCount: 1,
    });
    const signals = new Map<string, StoryGroundingSignal>([
      [
        "US-06",
        makeSignal("US-06", [{ kind: "no-vocabulary", filesScanned: 0 }]),
      ],
    ]);
    const html = renderDashboardHtml(
      baseInput(brief, { groundingSignals: signals, projectPath }),
    );

    expect(html).not.toMatch(
      /⚠\s+\d+\s+stor(y|ies)\s+shipped\s+with\s+[a-z-]+\s+warning/,
    );
  });
});
