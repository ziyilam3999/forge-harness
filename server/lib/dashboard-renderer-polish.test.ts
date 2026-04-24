/**
 * v0.35.1 — dashboard polish tests (AC-3..AC-7).
 *
 * Covers:
 *   - AC-3 TIME widget reads totals.elapsedMs, not timeBudget.elapsedMs
 *   - AC-4 TIME widget formats as Dd Hh Mm Ss past 24h
 *   - AC-5 activity list renders dates alongside times
 *   - AC-6 BUDGET widget distinguishes OAuth vs API-key
 *   - AC-7 activity panel surfaces all non-silent tools (forge_evaluate,
 *          forge_coordinate, forge_declare_story) via the unioned
 *          readActivityFeed() helper
 *
 * Test titles must literally contain the plan's Reviewer-command substrings
 * so `npx vitest run -t "..."` matches. Do NOT rephrase without updating the
 * plan AC.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  renderDashboardHtml,
  readActivityFeed,
  type DashboardRenderInput,
  type AuditFeedEntry,
} from "./dashboard-renderer.js";
import type { PhaseTransitionBrief } from "../types/coordinate-result.js";
import {
  clearDeclaration,
  setDeclaration,
} from "./declaration-store.js";

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
    renderedAt: "2026-04-21T09:00:00.000Z",
    ...extra,
  };
}

describe("AC-3 — TIME widget sources elapsedMs from the totals field", () => {
  it("TIME widget reads totals.elapsedMs not timeBudget.elapsedMs — differential fixture A vs B", () => {
    // Fixture A: totals = 60_000 (1m), timeBudget = 3_000_000 (50m).
    const htmlA = renderDashboardHtml(
      baseInput(
        { timeBudget: { elapsedMs: 3_000_000, maxTimeMs: null, warningLevel: "none" } },
        { totals: { elapsedMs: 60_000 } },
      ),
    );

    // Fixture B: totals = 3_000_000 (50m), timeBudget = 60_000 (1m).
    const htmlB = renderDashboardHtml(
      baseInput(
        { timeBudget: { elapsedMs: 60_000, maxTimeMs: null, warningLevel: "none" } },
        { totals: { elapsedMs: 3_000_000 } },
      ),
    );

    // Locate the Time stat-value and assert it contains the totals-based
    // rendering, not the timeBudget one. The stat-value for the Time card
    // lives immediately after `stat-label">Time</div><div class="stat-value">`.
    const timeValueA = extractTimeStat(htmlA);
    const timeValueB = extractTimeStat(htmlB);

    expect(timeValueA).toContain("1m 00s");
    expect(timeValueA).not.toContain("50m 00s");
    expect(timeValueB).toContain("50m 00s");
    expect(timeValueB).not.toContain("1m 00s");
  });

  it("falls back to timeBudget.elapsedMs when totals is absent (backward compat)", () => {
    const html = renderDashboardHtml(
      baseInput({
        timeBudget: { elapsedMs: 120_000, maxTimeMs: null, warningLevel: "none" },
      }),
    );
    expect(extractTimeStat(html)).toContain("2m 00s");
  });
});

describe("AC-4 — elapsed formatter scales past 24h", () => {
  it("TIME widget formats as Dd Hh Mm Ss past 24h — 150_000_000 ms → 1d 17h 40m NNs", () => {
    // 150_000_000 ms = 41h 40m 00s = 1d 17h 40m 00s.
    const html = renderDashboardHtml(
      baseInput(
        { timeBudget: { elapsedMs: 0, maxTimeMs: null, warningLevel: "none" } },
        { totals: { elapsedMs: 150_000_000 } },
      ),
    );
    const timeStat = extractTimeStat(html);
    expect(timeStat).toMatch(/\b1d 17h 40m \d+s\b/);
  });

  it("renders Hh Mm Ss between 1h and 24h", () => {
    // 2h 15m 03s → 8_103_000 ms
    const html = renderDashboardHtml(
      baseInput(
        { timeBudget: { elapsedMs: 0, maxTimeMs: null, warningLevel: "none" } },
        { totals: { elapsedMs: 8_103_000 } },
      ),
    );
    expect(extractTimeStat(html)).toMatch(/\b2h 15m 03s\b/);
  });

  it("renders Mm Ss below 1h", () => {
    // 5m 07s
    const html = renderDashboardHtml(
      baseInput(
        { timeBudget: { elapsedMs: 0, maxTimeMs: null, warningLevel: "none" } },
        { totals: { elapsedMs: 307_000 } },
      ),
    );
    expect(extractTimeStat(html)).toMatch(/\b5m 07s\b/);
  });
});

describe("AC-5 — feed-time format carries date prefix", () => {
  it("activity list renders dates alongside times — feed-time substring contains YYYY-MM-DD and HH:MM:SS", () => {
    const entries: AuditFeedEntry[] = [
      {
        timestamp: "2026-04-20T13:10:43.635Z",
        stage: "coherence-eval",
        agentRole: "critic",
        decision: "revise",
        reasoning: "-",
        tool: "forge_plan",
      },
    ];
    const html = renderDashboardHtml(baseInput({}, { auditEntries: entries }));

    // Regex from the plan: the HTML must match /2026-04-20.{0,200}13:10:43/
    expect(html).toMatch(/2026-04-20.{0,200}13:10:43/);
    // And both tokens must appear in the feed-time span.
    const feedTimeRe = /<span class="feed-time">([^<]+)<\/span>/;
    const match = feedTimeRe.exec(html);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("2026-04-20");
    expect(match![1]).toContain("13:10:43");
  });
});

describe("AC-6 — BUDGET widget renders OAuth marker", () => {
  it("BUDGET widget distinguishes OAuth vs API-key — isOAuth=true emits Max plan marker", () => {
    // Fixture A: isOAuth=true, spentUsd=0.80 → must show OAuth marker.
    const htmlA = renderDashboardHtml(
      baseInput({
        budget: {
          usedUsd: 0.8,
          budgetUsd: null,
          remainingUsd: null,
          incompleteData: false,
          warningLevel: "none",
          isOAuth: true,
        },
      }),
    );

    // Fixture B: isOAuth missing (or false), spentUsd=0.80 → must NOT show marker.
    const htmlB = renderDashboardHtml(
      baseInput({
        budget: {
          usedUsd: 0.8,
          budgetUsd: null,
          remainingUsd: null,
          incompleteData: false,
          warningLevel: "none",
        },
      }),
    );

    const budgetA = extractBudgetStat(htmlA);
    const budgetB = extractBudgetStat(htmlB);

    // Fixture A contains at least one of the accepted markers.
    const hasMarkerA =
      budgetA.includes("API-equivalent") ||
      budgetA.includes("Max plan") ||
      budgetA.includes("OAuth");
    expect(hasMarkerA).toBe(true);

    // Fixture B contains none of the markers.
    expect(budgetB).not.toContain("API-equivalent");
    expect(budgetB).not.toContain("Max plan");
    expect(budgetB).not.toContain("OAuth");
  });
});

describe("AC-7 — unioned activity feed includes evaluate, coordinate, declare", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "forge-activity-feed-"));
    clearDeclaration();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    clearDeclaration();
    vi.restoreAllMocks();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("activity panel surfaces all non-silent tools — forge_evaluate + forge_coordinate + forge_declare_story", async () => {
    // Seed `.forge/audit/` with a forge_plan entry.
    const auditDir = join(tmpRoot, ".forge", "audit");
    await mkdir(auditDir, { recursive: true });
    await writeFile(
      join(auditDir, "forge_plan-2026-04-21T08-00-00-000Z.jsonl"),
      JSON.stringify({
        timestamp: "2026-04-21T08:00:00.000Z",
        stage: "plan",
        agentRole: "planner",
        decision: "approve",
        reasoning: "initial",
      }) + "\n",
    );

    // Seed `.forge/runs/` with forge_evaluate and forge_coordinate records.
    const runsDir = join(tmpRoot, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "forge_evaluate-2026-04-21T08-30-00-000Z-aa.json"),
      JSON.stringify({
        timestamp: "2026-04-21T08:30:00.000Z",
        tool: "forge_evaluate",
        documentTier: null,
        mode: null,
        tier: null,
        storyId: "US-01",
        evalVerdict: "PASS",
        metrics: {
          inputTokens: 100,
          outputTokens: 50,
          critiqueRounds: 0,
          findingsTotal: 0,
          findingsApplied: 0,
          findingsRejected: 0,
          validationRetries: 0,
          durationMs: 1000,
          estimatedCostUsd: 0.01,
        },
        outcome: "success",
      }),
    );
    await writeFile(
      join(runsDir, "forge_coordinate-2026-04-21T08-45-00-000Z-bb.json"),
      JSON.stringify({
        timestamp: "2026-04-21T08:45:00.000Z",
        tool: "forge_coordinate",
        documentTier: "phase",
        mode: null,
        tier: null,
        metrics: {
          inputTokens: 0,
          outputTokens: 0,
          critiqueRounds: 0,
          findingsTotal: 0,
          findingsApplied: 0,
          findingsRejected: 0,
          validationRetries: 0,
          durationMs: 500,
          estimatedCostUsd: 0,
        },
        outcome: "success",
      }),
    );

    // Seed the declaration store (forge_declare_story).
    setDeclaration("US-02", "PH-01");

    const feed = await readActivityFeed(tmpRoot);
    // The three tools below must each appear at least once in the unioned
    // feed. Assert via three independent .some() checks rather than a single
    // ordered regex (plan AC-7 explicitly calls for three independent
    // assertions so a missing entry fails loudly with a specific error).
    const tools = feed.map((e) => e.tool);
    expect(tools).toContain("forge_evaluate");
    expect(tools).toContain("forge_coordinate");
    expect(tools).toContain("forge_declare_story");

    // End-to-end: render HTML from the unioned feed and verify the tool
    // names are present in the rendered activity panel.
    const html = renderDashboardHtml(
      baseInput({}, { auditEntries: feed }),
    );
    expect(html).toContain("forge_evaluate");
    expect(html).toContain("forge_coordinate");
    expect(html).toContain("forge_declare_story");
  });
});

// ── helpers ──────────────────────────────────────────────────────────────

/**
 * Extract the Time stat-card's stat-value (up to the next closing </div>).
 * Targets the literal `<div class="stat-label">Time</div>` anchor — the
 * Budget card uses `Budget` as its label so the selector is unambiguous.
 */
function extractTimeStat(html: string): string {
  const re =
    /<div class="stat-label">Time<\/div><div class="stat-value">([^<]*)<\/div>/;
  const m = re.exec(html);
  if (!m) throw new Error(`Time stat-value not found. HTML excerpt: ${html.slice(0, 500)}`);
  return m[1];
}

/**
 * Extract the Budget stat-card's full HTML block (from the `Budget` label
 * to the closing `</div>` of the stat-card). Broad enough to include the
 * `stat-sub` marker where the OAuth annotation lives.
 */
function extractBudgetStat(html: string): string {
  const re =
    /<div class="stat-card"><div class="stat-label">Budget<\/div>[\s\S]*?<\/div><\/div>/;
  const m = re.exec(html);
  if (!m) throw new Error(`Budget stat-card not found. HTML excerpt: ${html.slice(0, 500)}`);
  return m[0];
}
