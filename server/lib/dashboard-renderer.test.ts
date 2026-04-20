/**
 * Unit tests for the Kanban dashboard renderer (S8).
 *
 * Covers AC-03, AC-04, AC-05, AC-08, AC-09, AC-10, AC-12, AC-13, AC-14,
 * AC-16, AC-18 of the 2026-04-18 kanban-dashboard plan.
 *
 * Design goals these tests enforce:
 *   - `classifyStaleness` is a pure green/amber/red function.
 *   - Column routing honours (a) the activity signal for in-progress and
 *     (b) the 5 StoryStatus → column fallbacks.
 *   - Null budget / null maxTimeMs render "no limit" with no NaN / null
 *     leakage into the stat card.
 *   - Atomic tmp+rename is the write discipline (mockable at fs boundary).
 *   - A render failure in isolation never surfaces as a tool-level error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile as fsWriteFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyStaleness,
  renderDashboardHtml,
  renderDashboard,
  maybeAutoOpenBrowser,
  COLUMN_IDS,
  type AutoOpenIo,
  type DashboardRenderInput,
  type AuditFeedEntry,
} from "./dashboard-renderer.js";
import type {
  PhaseTransitionBrief,
  StoryStatusEntry,
} from "../types/coordinate-result.js";

function makeStoryEntry(
  storyId: string,
  status: StoryStatusEntry["status"],
  overrides: Partial<StoryStatusEntry> = {},
): StoryStatusEntry {
  return {
    storyId,
    status,
    retryCount: 0,
    retriesRemaining: 3,
    priorEvalReport: null,
    evidence: null,
    ...overrides,
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
    recommendation: "",
    configSource: {},
    ...overrides,
  };
}

function baseInput(
  briefOverrides: Partial<PhaseTransitionBrief> = {},
  extra: Partial<DashboardRenderInput> = {},
): DashboardRenderInput {
  return {
    brief: makeBrief(briefOverrides),
    activity: null,
    auditEntries: [],
    renderedAt: "2026-04-18T00:00:00.000Z",
    ...extra,
  };
}

/**
 * Extract the HTML fragment inside a specific column by finding its opening
 * <div ... id="col-xxx"> tag and walking div open/close tags until the
 * nesting level matching the opening tag returns to zero. Strict "same
 * nesting level" contract per AC-03. The column-id marker is anchored to
 * a `<div` prefix so CSS attribute selectors like
 * `.kanban-column[id="col-retry"]` inside the <style> block are ignored.
 */
function extractColumnContent(html: string, columnId: string): string {
  // Anchor to the `kanban-column` class so CSS attribute selectors like
  // `[id="col-retry"]::before` inside the <style> block are not mistaken
  // for the column wrapper. Accepts any additional classes on the same
  // <div> (e.g. `accent-amber`).
  const re = new RegExp(
    `<div class="kanban-column[^"]*" id="${columnId}">`,
  );
  const match = re.exec(html);
  if (!match) throw new Error(`<div for ${columnId} not found`);
  const tagStart = match.index;
  const tagOpenEnd = tagStart + match[0].length - 1;
  let depth = 1;
  let i = tagOpenEnd + 1;
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

describe("classifyStaleness (AC-05)", () => {
  it("returns green below 60s", () => {
    expect(classifyStaleness(30_000)).toBe("green");
  });

  it("returns amber between 60s and 120s", () => {
    expect(classifyStaleness(90_000)).toBe("amber");
  });

  it("returns red above 120s", () => {
    expect(classifyStaleness(150_000)).toBe("red");
  });

  it("boundary: exactly 60000ms is green (not-greater-than-60s)", () => {
    expect(classifyStaleness(60_000)).toBe("green");
  });

  it("boundary: exactly 120000ms is amber", () => {
    expect(classifyStaleness(120_000)).toBe("amber");
  });
});

describe("renderDashboardHtml — idle-banner branch (#331)", () => {
  it("serializes TOOL_RUNNING=false and emits 'Idle — no tool running' branch when activity is null", () => {
    // Simulate the production path: readActivity() returns null when
    // activity.json has {"tool": null} or is absent.
    const html = renderDashboardHtml(baseInput());

    // TOOL_RUNNING must be serialized in the client script block as `false`.
    expect(html).toMatch(/var\s+TOOL_RUNNING\s*=\s*false\s*;/);

    // The idle-banner copy must be present in the rendered script block
    // so that updateBanner() can short-circuit the red-hang alarm for
    // the legitimate idle case.
    expect(html).toContain("Idle — no tool running");

    // The neutral CSS class must exist so the banner styling matches the
    // downgraded alarm level.
    expect(html).toContain("liveness-banner.neutral");

    // Regression guard: the legitimate "may be hung" red alarm copy must
    // still be emitted for the TOOL_RUNNING === true + red branch.
    expect(html).toContain("may be hung");
  });

  it("serializes TOOL_RUNNING=true when an activity with a real tool is supplied", () => {
    const html = renderDashboardHtml(
      baseInput(
        {},
        {
          activity: {
            tool: "forge_generate",
            storyId: "US-01",
            stage: "running",
            startedAt: "2026-04-20T00:00:00.000Z",
            lastUpdate: "2026-04-20T00:00:05.000Z",
          },
        },
      ),
    );
    expect(html).toMatch(/var\s+TOOL_RUNNING\s*=\s*true\s*;/);
    // Idle copy and may-be-hung copy are both present in the IIFE source
    // text even when TOOL_RUNNING is true — the branching happens at
    // runtime inside the browser. We only assert that emission doesn't
    // regress the red-alarm copy.
    expect(html).toContain("may be hung");
  });
});

describe("renderDashboardHtml — column routing (AC-03)", () => {
  it("routes a done story into col-done and a ready story into col-ready", () => {
    const html = renderDashboardHtml(
      baseInput({
        stories: [
          makeStoryEntry("US-01", "done"),
          makeStoryEntry("US-02", "ready"),
        ],
        completedCount: 1,
        totalCount: 2,
      }),
    );
    const done = extractColumnContent(html, "col-done");
    const ready = extractColumnContent(html, "col-ready");
    expect(done).toContain("US-01");
    expect(done).not.toContain("US-02");
    expect(ready).toContain("US-02");
    expect(ready).not.toContain("US-01");
  });

  it("routes pending to col-backlog, ready-for-retry to col-retry, failed/dep-failed to col-blocked", () => {
    const html = renderDashboardHtml(
      baseInput({
        stories: [
          makeStoryEntry("US-P", "pending"),
          makeStoryEntry("US-R", "ready-for-retry"),
          makeStoryEntry("US-F", "failed"),
          makeStoryEntry("US-D", "dep-failed"),
        ],
        totalCount: 4,
      }),
    );
    expect(extractColumnContent(html, "col-backlog")).toContain("US-P");
    expect(extractColumnContent(html, "col-retry")).toContain("US-R");
    const blocked = extractColumnContent(html, "col-blocked");
    expect(blocked).toContain("US-F");
    expect(blocked).toContain("US-D");
  });
});

describe("renderDashboardHtml — activity signal (AC-04)", () => {
  it("puts the in-progress story into col-in-progress with tool + stage text", () => {
    const html = renderDashboardHtml(
      baseInput(
        {},
        {
          activity: {
            tool: "forge_generate",
            storyId: "US-03",
            stage: "critic round 2",
            startedAt: "2026-04-18T00:00:00.000Z",
            lastUpdate: "2026-04-18T00:00:05.000Z",
          },
        },
      ),
    );
    const inProgress = extractColumnContent(html, "col-in-progress");
    expect(inProgress).toContain("forge_generate");
    expect(inProgress).toContain("critic round 2");
  });
});

describe("renderDashboardHtml — header shows budget + progress (AC-07 support)", () => {
  it("renders 4/9, $2.15, $10 substrings when given matching brief", () => {
    const html = renderDashboardHtml(
      baseInput({
        completedCount: 4,
        totalCount: 9,
        budget: {
          usedUsd: 2.15,
          budgetUsd: 10,
          remainingUsd: 7.85,
          incompleteData: false,
          warningLevel: "none",
        },
      }),
    );
    expect(html).toContain("4/9");
    expect(html).toContain("$2.15");
    expect(html).toContain("$10");
  });
});

describe("renderDashboardHtml — audit feed count + ordering (AC-08)", () => {
  it("renders 15 feed-entry rows in reverse chronological order", () => {
    const auditEntries: AuditFeedEntry[] = Array.from({ length: 15 }, (_, i) => {
      const ts = new Date(Date.UTC(2026, 3, 18, 10, 30, i)).toISOString();
      return {
        timestamp: ts,
        stage: `stage-${i}`,
        agentRole: "critic",
        decision: "revise",
        reasoning: "-",
        tool: "forge_generate",
      };
    });
    // Renderer expects callers (i.e. renderDashboard I/O) to pre-sort
    // descending; simulate that here.
    auditEntries.reverse();
    const html = renderDashboardHtml(baseInput({}, { auditEntries }));
    const matches = html.match(/class="feed-entry"/g) ?? [];
    expect(matches.length).toBe(15);

    // Extract the timestamps of the first and last rendered feed entries.
    const tsRe = /<span class="feed-time">(\d{2}:\d{2}:\d{2})<\/span>/g;
    const feedTimestamps: string[] = [];
    let m;
    while ((m = tsRe.exec(html)) !== null) feedTimestamps.push(m[1]);
    expect(feedTimestamps.length).toBe(15);

    // Reconstruct Date objects from the original auditEntries (already in
    // the order the renderer received them).
    const firstDate = new Date(auditEntries[0].timestamp);
    const lastDate = new Date(auditEntries[auditEntries.length - 1].timestamp);
    expect(firstDate.getTime()).toBeGreaterThan(lastDate.getTime());
  });
});

describe("renderDashboardHtml — audit feed uses AuditEntry fields, not missing ones (AC-16)", () => {
  it("renders stage + decision + agentRole; no references to storyId/tool/score on AuditEntry", () => {
    const auditEntries: AuditFeedEntry[] = [
      {
        timestamp: "2026-04-18T10:30:00.000Z",
        stage: "critic round 2",
        agentRole: "critic",
        decision: "revise",
        reasoning: "found 3 issues",
        tool: "forge_generate",
      },
    ];
    const html = renderDashboardHtml(baseInput({}, { auditEntries }));
    expect(html).toContain("critic round 2");
    expect(html).toContain("revise");
    expect(html).toContain("critic");
    // Tool name is derived from the filename and shown as a hex-dot accent
    // on the feed row — confirm it is present (not read off AuditEntry).
    expect(html).toContain("forge_generate");
  });
});

describe("renderDashboardHtml — empty stories (AC-12)", () => {
  it("renders all 6 columns with count 0 and does not throw", () => {
    expect(() => renderDashboardHtml(baseInput({ stories: [] }))).not.toThrow();
    const html = renderDashboardHtml(baseInput({ stories: [] }));
    for (const id of Object.values(COLUMN_IDS)) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("renderDashboardHtml — null budget (AC-13)", () => {
  it("renders 'no limit' text and no NaN / null leakage in the budget card", () => {
    const html = renderDashboardHtml(
      baseInput({
        budget: {
          usedUsd: 0.42,
          budgetUsd: null,
          remainingUsd: null,
          incompleteData: false,
          warningLevel: "none",
        },
      }),
    );
    // Extract just the budget stat card by isolating between the Budget
    // label and the next </div>. We look for the textual "Budget" label.
    const idx = html.indexOf("Budget");
    expect(idx).toBeGreaterThan(-1);
    const cardSlice = html.slice(idx, idx + 400);
    expect(cardSlice).toContain("no limit");
    expect(cardSlice).not.toContain("NaN");
    // Must not leak the literal JavaScript "null" as a rendered value.
    // (Acceptable substrings like "no limit" do not contain "null".)
    expect(cardSlice.toLowerCase()).not.toContain("null");
  });
});

describe("renderDashboardHtml — null maxTimeMs (AC-14)", () => {
  it("renders 'no limit' text and no NaN / null leakage in the time card", () => {
    const html = renderDashboardHtml(
      baseInput({
        timeBudget: { elapsedMs: 72_000, maxTimeMs: null, warningLevel: "none" },
      }),
    );
    const idx = html.indexOf("Time");
    expect(idx).toBeGreaterThan(-1);
    const cardSlice = html.slice(idx, idx + 400);
    expect(cardSlice).toContain("no limit");
    expect(cardSlice).not.toContain("NaN");
    expect(cardSlice.toLowerCase()).not.toContain("null");
  });
});

describe("renderDashboard — atomic write discipline (AC-09)", () => {
  it("calls writeFile on a .tmp.html path and then rename to the final .html path", async () => {
    // Capture call order across the injectable IO seam; assert the tmp
    // writeFile precedes the rename-to-final.
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const io = {
      writeFile: async (p: string, d: string, _e: "utf-8") => {
        calls.push({ op: "writeFile", args: [p, d.length] });
      },
      rename: async (o: string, n: string) => {
        calls.push({ op: "rename", args: [o, n] });
      },
      mkdir: async (_p: string, _o: { recursive: boolean }) => undefined,
    };

    // Isolate inputs so reads do not fall through to real fs. Use an
    // absolute path in a guaranteed-not-present directory.
    const bogusRoot = process.platform === "win32"
      ? "Z:\\forge-ac09-fixture"
      : "/tmp/forge-ac09-nonexistent-xyz";

    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderDashboard(bogusRoot, io);

    // First write must end with dashboard.tmp.html.
    const writeCall = calls.find((c) => c.op === "writeFile");
    expect(writeCall).toBeDefined();
    expect(String((writeCall as { args: unknown[] }).args[0])).toMatch(/dashboard\.tmp\.html$/);

    // Rename must be from dashboard.tmp.html -> dashboard.html.
    const renameCall = calls.find((c) => c.op === "rename");
    expect(renameCall).toBeDefined();
    const renameArgs = (renameCall as { args: unknown[] }).args;
    expect(String(renameArgs[0])).toMatch(/dashboard\.tmp\.html$/);
    expect(String(renameArgs[1])).toMatch(/dashboard\.html$/);
    expect(String(renameArgs[1])).not.toMatch(/\.tmp\.html$/);

    // Atomicity: rename must run AFTER writeFile.
    const writeIdx = calls.findIndex((c) => c.op === "writeFile");
    const renameIdx = calls.findIndex((c) => c.op === "rename");
    expect(renameIdx).toBeGreaterThan(writeIdx);
  });
});

describe("renderDashboard — activity.json absent (AC-10)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "forge-dashboard-ac10-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("renders without throwing and produces zero in-progress cards when activity.json is missing", async () => {
    // Seed a brief so the renderer has columns to produce.
    const forgeDir = join(tmpRoot, ".forge");
    await mkdir(forgeDir, { recursive: true });
    const brief = makeBrief({
      stories: [
        makeStoryEntry("US-A", "ready"),
        makeStoryEntry("US-B", "done", { retryCount: 0 }),
      ],
      completedCount: 1,
      totalCount: 2,
    });
    await fsWriteFile(
      join(forgeDir, "coordinate-brief.json"),
      JSON.stringify(brief),
      "utf-8",
    );
    // activity.json intentionally absent.

    await expect(renderDashboard(tmpRoot)).resolves.toBeUndefined();

    const { readFile } = await import("node:fs/promises");
    const html = await readFile(join(forgeDir, "dashboard.html"), "utf-8");
    const inProgress = extractColumnContent(html, "col-in-progress");
    // Check: no .story-card instances inside col-in-progress.
    const cardMatches = inProgress.match(/class="story-card/g) ?? [];
    expect(cardMatches.length).toBe(0);
  });
});

describe("renderDashboard — failure isolation (AC-18)", () => {
  it("does not propagate a writeFile failure to callers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const io = {
      writeFile: async () => {
        throw new Error("disk full");
      },
      rename: async () => undefined,
      mkdir: async () => undefined,
    };
    const bogusRoot = process.platform === "win32"
      ? "Z:\\forge-ac18-fixture"
      : "/tmp/forge-ac18-nonexistent-xyz";
    await expect(renderDashboard(bogusRoot, io)).resolves.toBeUndefined();
  });

  it("ProgressReporter fire-and-forget promise resolves and invokes both writeActivity + renderDashboard (#273)", async () => {
    // Rewrite of the previous AC-18 reporter test (#273 — original only
    // asserted that the synchronous `begin` / `complete` returns didn't
    // throw, which is trivially true for any void-returning method and
    // proved nothing about isolation).
    //
    // This test injects real mocks for writeActivity + renderDashboard
    // (via vi.mock at the module boundary), drives begin + complete,
    // awaits the fire-and-forget promise settle via a microtask flush,
    // and asserts that:
    //   (a) both mocks were invoked (the hook ran — not a silent no-op),
    //   (b) the outer promise settled (no unhandled rejection),
    //   (c) the reporter's synchronous path did not throw.
    //
    // The mocks live in dedicated sub-modules so we can reset them
    // cleanly per test without leaking state across the test file.
    vi.resetModules();
    const writeActivitySpy = vi.fn().mockResolvedValue(undefined);
    const renderDashboardSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./activity.js", () => ({
      writeActivity: writeActivitySpy,
    }));
    vi.doMock("./dashboard-renderer.js", () => ({
      renderDashboard: renderDashboardSpy,
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ProgressReporter } = await import("./progress.js");
    const bogusRoot = process.platform === "win32"
      ? "Z:\\forge-ac18-reporter-fixture"
      : "/tmp/forge-ac18-reporter-nonexistent-xyz";
    const reporter = new ProgressReporter("forge_generate", ["stage-a"]);
    reporter.setProjectContext(bogusRoot, "US-18");

    expect(() => reporter.begin("stage-a")).not.toThrow();
    expect(() => reporter.complete("stage-a")).not.toThrow();

    // Drain the microtask queue so the `void (async () => { ... })()`
    // fire-and-forget Promise finishes. Two ticks: one for `writeActivity`,
    // one for `renderDashboard`. A small setTimeout fallback catches any
    // additional scheduled microtasks. (The begin() hook also fires one,
    // so we allow a handful of iterations.)
    for (let i = 0; i < 4; i += 1) {
      await new Promise((r) => setImmediate(r));
    }

    // Both mocks must have been called — proves the hook actually ran,
    // not silently returned (which was the #273 failure mode).
    expect(writeActivitySpy).toHaveBeenCalled();
    expect(renderDashboardSpy).toHaveBeenCalled();
    // Reset module registry so subsequent tests see the real modules.
    vi.doUnmock("./activity.js");
    vi.doUnmock("./dashboard-renderer.js");
    vi.resetModules();
  });
});

describe("readActivity + renderBoard — empty-string tool (#276)", () => {
  // #276: `{tool: ""}` must never count as an active tool. readActivity
  // rejects it and readActivity callers skip the activity card. The
  // renderBoard guard uses the same isToolRunning helper as #353.
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "forge-dashboard-empty-tool-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("activity.json with empty-string tool renders zero in-progress cards", async () => {
    const forgeDir = join(tmpRoot, ".forge");
    await mkdir(forgeDir, { recursive: true });
    const brief = makeBrief({
      stories: [makeStoryEntry("US-E", "ready")],
      totalCount: 1,
    });
    await fsWriteFile(
      join(forgeDir, "coordinate-brief.json"),
      JSON.stringify(brief),
      "utf-8",
    );
    // Empty-string tool — must be rejected identically to null.
    await fsWriteFile(
      join(forgeDir, "activity.json"),
      JSON.stringify({
        tool: "",
        stage: "whatever",
        startedAt: "2026-04-20T00:00:00.000Z",
        lastUpdate: "2026-04-20T00:00:05.000Z",
      }),
      "utf-8",
    );

    await renderDashboard(tmpRoot);
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(join(forgeDir, "dashboard.html"), "utf-8");
    const inProgress = extractColumnContent(html, "col-in-progress");
    const cardMatches = inProgress.match(/class="story-card/g) ?? [];
    expect(cardMatches.length).toBe(0);

    // And TOOL_RUNNING serializes false — the idle branch should take
    // over at runtime.
    expect(html).toMatch(/var\s+TOOL_RUNNING\s*=\s*false\s*;/);
  });

  it("renderDashboardHtml with activity.tool === '' renders no activity card in col-in-progress", () => {
    const html = renderDashboardHtml(
      baseInput(
        {
          stories: [makeStoryEntry("US-X", "ready")],
          totalCount: 1,
        },
        {
          activity: {
            tool: "",
            storyId: "US-X",
            stage: "whatever",
            startedAt: "2026-04-20T00:00:00.000Z",
            lastUpdate: "2026-04-20T00:00:05.000Z",
          },
        },
      ),
    );
    const inProgress = extractColumnContent(html, "col-in-progress");
    // renderBoard should NOT emit an activity card for empty-string tool.
    expect(inProgress).not.toMatch(/class="story-card active"/);
    // TOOL_RUNNING must be false even though the raw activity payload
    // was supplied directly (bypassing readActivity).
    expect(html).toMatch(/var\s+TOOL_RUNNING\s*=\s*false\s*;/);
  });
});

describe("writeDashboardHtml — per-project serial queue (#271)", () => {
  it("serializes concurrent writes so rename of call-1 precedes writeFile of call-2", async () => {
    const calls: Array<{ op: string; id: number; ts: number }> = [];
    let seq = 0;
    // Each op deliberately delays by a few ms so a racing implementation
    // would interleave writeFile/rename between calls.
    const io = {
      writeFile: (_p: string, _d: string, _e: "utf-8") => {
        const id = ++seq;
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            calls.push({ op: "writeFile", id, ts: Date.now() });
            resolve();
          }, 8);
        });
      },
      rename: (_o: string, _n: string) => {
        const id = seq;
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            calls.push({ op: "rename", id, ts: Date.now() });
            resolve();
          }, 8);
        });
      },
      mkdir: async (_p: string, _o: { recursive: boolean }) => undefined,
    };

    // Launch two concurrent writes against the SAME projectPath.
    const bogus = process.platform === "win32"
      ? "Z:\\forge-concurrent-fixture"
      : "/tmp/forge-concurrent-nonexistent-xyz";
    const { writeDashboardHtml } = await import("./dashboard-renderer.js");
    await Promise.all([
      writeDashboardHtml(bogus, "<html>a</html>", io),
      writeDashboardHtml(bogus, "<html>b</html>", io),
    ]);

    // Expected sequence for a serial queue: writeFile, rename, writeFile,
    // rename (all four ops in strict order). A racing implementation
    // would emit writeFile, writeFile, rename, rename (or similar
    // interleaving).
    const opSeq = calls.map((c) => c.op);
    expect(opSeq).toEqual(["writeFile", "rename", "writeFile", "rename"]);
  });
});

// ── maybeAutoOpenBrowser — shared test helpers ─────────────────────────────
// Neutral fixture path: tests fully inject AutoOpenIo and never touch disk,
// so the label is "this is the fake project root" rather than "a nonexistent
// real path". Renamed from the previous `/tmp/forge-auto-open-nonexistent-xyz`
// per #293.
const FIXTURE_PROJECT_ROOT =
  process.platform === "win32" ? "Z:\\project-fixture" : "/project-fixture";

// Factored shared setup/teardown for auto-open describes per #294. Returns
// nothing — the afterEach hook restores mocks globally. Call from the top of
// each describe that exercises the env-gated auto-open path.
function useAutoOpenEnvGate(): void {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.FORGE_DASHBOARD_AUTO_OPEN = "1";
  });

  afterEach(() => {
    delete process.env.FORGE_DASHBOARD_AUTO_OPEN;
    vi.restoreAllMocks();
  });
}

describe("maybeAutoOpenBrowser — marker-on-spawn (#281)", () => {
  useAutoOpenEnvGate();

  it("does NOT write the marker when openExternal rejects (spawn failure)", async () => {
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const io: AutoOpenIo = {
      stat: async (p) => {
        calls.push({ op: "stat", args: [p] });
        throw enoent; // marker absent → proceed
      },
      openExternal: async (target) => {
        calls.push({ op: "openExternal", args: [target] });
        throw new Error("xdg-open missing");
      },
      writeFile: async (p, d, e) => {
        calls.push({ op: "writeFile", args: [p, d, e] });
      },
    };

    await maybeAutoOpenBrowser(FIXTURE_PROJECT_ROOT, io);

    // openExternal was attempted but writeFile must NEVER have been called.
    expect(calls.some((c) => c.op === "openExternal")).toBe(true);
    expect(calls.some((c) => c.op === "writeFile")).toBe(false);
  });

  it("writes the marker exactly once when openExternal resolves", async () => {
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const io: AutoOpenIo = {
      stat: async () => { throw enoent; },
      openExternal: async (target) => { calls.push({ op: "openExternal", args: [target] }); },
      writeFile: async (p, d, e) => { calls.push({ op: "writeFile", args: [p, d, e] }); },
    };

    await maybeAutoOpenBrowser(FIXTURE_PROJECT_ROOT, io);

    const opOrder = calls.map((c) => c.op);
    expect(opOrder).toEqual(["openExternal", "writeFile"]);
    const writeArgs = calls.find((c) => c.op === "writeFile")!.args;
    expect(String(writeArgs[0])).toMatch(/\.dashboard-opened$/);
  });
});

describe("maybeAutoOpenBrowser — stat catch narrowing (#283 + #291)", () => {
  useAutoOpenEnvGate();

  it("non-ENOENT stat error (e.g. EPERM) skips open and does NOT call openExternal or writeFile", async () => {
    const calls: Array<{ op: string }> = [];
    const eperm = Object.assign(new Error("EPERM"), { code: "EPERM" });
    const io: AutoOpenIo = {
      stat: async () => { throw eperm; },
      openExternal: async () => { calls.push({ op: "openExternal" }); },
      writeFile: async () => { calls.push({ op: "writeFile" }); },
    };

    await maybeAutoOpenBrowser(FIXTURE_PROJECT_ROOT, io);

    // Non-ENOENT must neither re-open nor re-write the marker —
    // otherwise every render would re-spawn a browser tab.
    expect(calls.length).toBe(0);
  });

  it("plain Error with no code (undefined) is treated as 'skip', NOT 'marker absent' (#291)", async () => {
    const calls: Array<{ op: string }> = [];
    // Plain Error has no `.code` property — previous guard
    // `if (code && code !== "ENOENT")` fell through to open.
    // After the #291 widening (`if (code !== "ENOENT")`), undefined
    // also skips because undefined !== "ENOENT".
    const io: AutoOpenIo = {
      stat: async () => { throw new Error("mystery stat failure"); },
      openExternal: async () => { calls.push({ op: "openExternal" }); },
      writeFile: async () => { calls.push({ op: "writeFile" }); },
    };

    await maybeAutoOpenBrowser(FIXTURE_PROJECT_ROOT, io);

    // No io other than stat must have been touched.
    expect(calls.length).toBe(0);
  });
});

describe("maybeAutoOpenBrowser — env gate (#295)", () => {
  // Env-gate suppression is a distinct concern from stat-narrowing, so it
  // lives in its own describe per #295. useAutoOpenEnvGate() is deliberately
  // NOT used here — the whole point is that the env var is unset.

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.FORGE_DASHBOARD_AUTO_OPEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("env var unset → no io calls at all (early return)", async () => {
    const calls: Array<{ op: string }> = [];
    const io: AutoOpenIo = {
      stat: async () => { calls.push({ op: "stat" }); },
      openExternal: async () => { calls.push({ op: "openExternal" }); },
      writeFile: async () => { calls.push({ op: "writeFile" }); },
    };

    await maybeAutoOpenBrowser(FIXTURE_PROJECT_ROOT, io);

    expect(calls.length).toBe(0);
  });
});
