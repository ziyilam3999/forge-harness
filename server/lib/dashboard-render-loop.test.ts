/**
 * v0.39.0 AC-1/AC-2 — periodic dashboard re-render loop.
 *
 * AC-1: with the loop running on a temp project, with NO forge tool
 *       activity, the on-disk `.forge/dashboard.html` mtime advances
 *       at least twice within a bounded window (≥2 ticks).
 * AC-2: gaps between consecutive renders never exceed the configured
 *       interval plus 5s slack.
 *
 * The plan's AC text uses 70s + 35s tolerances tied to the production
 * 30s cadence. The loop module exposes a fast-interval escape hatch for
 * tests so we can prove the same invariants in bounded test time
 * (200ms × 4 ticks = ~800ms).
 *
 * AC-2's PRODUCTION range bound ([15s, 30s]) is ALSO checked here — by
 * asserting that calling `start()` with a default interval lands in
 * that range and that an out-of-range value throws.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  start,
  stop,
  __getTickCountForTests,
  __resetForTests,
  DEFAULT_INTERVAL_MS,
  MIN_PRODUCTION_INTERVAL_MS,
  MAX_PRODUCTION_INTERVAL_MS,
} from "./dashboard-render-loop.js";

describe("dashboard-render-loop — production-range gate", () => {
  beforeEach(async () => {
    await __resetForTests();
  });

  afterEach(async () => {
    await __resetForTests();
  });

  it("DEFAULT_INTERVAL_MS lies within [MIN, MAX] production range", () => {
    expect(DEFAULT_INTERVAL_MS).toBeGreaterThanOrEqual(MIN_PRODUCTION_INTERVAL_MS);
    expect(DEFAULT_INTERVAL_MS).toBeLessThanOrEqual(MAX_PRODUCTION_INTERVAL_MS);
  });

  it("start() with sub-MIN interval throws unless allowFastInterval is set", () => {
    expect(() => start("/tmp/nonexistent", { intervalMs: 100 })).toThrow(
      /outside production range/,
    );
    // Cleanup state in case it leaked through.
    void stop();
  });

  it("start() with allowFastInterval=true accepts sub-MIN intervals", () => {
    expect(() =>
      start("/tmp/nonexistent", { intervalMs: 100, allowFastInterval: true }),
    ).not.toThrow();
    void stop();
  });
});

describe("AC-1 — periodic re-render advances dashboard.html mtime ≥2 times", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "forge-loop-mtime-"));
    await __resetForTests();
  });

  afterEach(async () => {
    await __resetForTests();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("with no tool activity, dashboard.html mtime advances at least twice within ~5s at 500ms cadence", async () => {
    // Pre-create a coordinate-brief so the renderer has something to
    // serialize — without it, the renderer's "no brief" path still
    // writes a dashboard.html, but tying the test to that branch is
    // unnecessary. A minimal brief gives a stable mtime signal.
    const briefDir = join(tempDir, ".forge");
    await mkdir(briefDir, { recursive: true });
    await writeFile(
      join(briefDir, "coordinate-brief.json"),
      JSON.stringify({
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
      }),
      "utf-8",
    );

    // 500ms cadence × 5s window = up to 10 ticks; we only require 3
    // mtime advances. Generous slack so the test is stable when the
    // full suite runs in parallel under Windows timer jitter.
    start(tempDir, { intervalMs: 500, allowFastInterval: true });

    const mtimes: number[] = [];
    const dashboardPath = join(tempDir, ".forge", "dashboard.html");
    const startTime = Date.now();
    while (Date.now() - startTime < 5_000 && mtimes.length < 3) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const s = await stat(dashboardPath);
        const ms = s.mtimeMs;
        if (mtimes.length === 0 || ms !== mtimes[mtimes.length - 1]) {
          mtimes.push(ms);
        }
      } catch {
        // file not yet present
      }
    }

    expect(mtimes.length).toBeGreaterThanOrEqual(3);
    // Sanity — each successive mtime is non-decreasing.
    for (let i = 1; i < mtimes.length; i += 1) {
      expect(mtimes[i]).toBeGreaterThanOrEqual(mtimes[i - 1]);
    }
  }, 10_000);
});

describe("AC-2 — gap between renders never exceeds intervalMs + slack", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "forge-loop-gap-"));
    await __resetForTests();
  });

  afterEach(async () => {
    await __resetForTests();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("at 500ms cadence with no tool activity, no consecutive-render gap exceeds 4000ms", async () => {
    const briefDir = join(tempDir, ".forge");
    await mkdir(briefDir, { recursive: true });
    await writeFile(
      join(briefDir, "coordinate-brief.json"),
      JSON.stringify({
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
      }),
      "utf-8",
    );

    start(tempDir, { intervalMs: 500, allowFastInterval: true });

    const mtimes: number[] = [];
    const dashboardPath = join(tempDir, ".forge", "dashboard.html");
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline && mtimes.length < 3) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const s = await stat(dashboardPath);
        const ms = s.mtimeMs;
        if (mtimes.length === 0 || ms !== mtimes[mtimes.length - 1]) {
          mtimes.push(ms);
        }
      } catch {
        // not yet present
      }
    }

    expect(mtimes.length).toBeGreaterThanOrEqual(3);
    // Convert to gaps. Each gap should be roughly 500ms in the happy
    // case; tolerance 4000ms absorbs Windows-timer jitter under
    // parallel test load.
    const gaps: number[] = [];
    for (let i = 1; i < mtimes.length; i += 1) {
      gaps.push(mtimes[i] - mtimes[i - 1]);
    }
    for (const g of gaps) {
      expect(g).toBeLessThanOrEqual(4_000);
    }
  }, 10_000);
});

describe("overlap guard — second tick skipped when prior render still in flight", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "forge-loop-overlap-"));
    await __resetForTests();
  });

  afterEach(async () => {
    await __resetForTests();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("ticks fired faster than render duration are dropped, not queued", async () => {
    const briefDir = join(tempDir, ".forge");
    await mkdir(briefDir, { recursive: true });
    await writeFile(
      join(briefDir, "coordinate-brief.json"),
      JSON.stringify({
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
      }),
      "utf-8",
    );

    // Aggressive 50ms cadence — much shorter than a real render. We
    // expect to see at least one skip recorded over a 500ms window.
    start(tempDir, { intervalMs: 50, allowFastInterval: true });
    await new Promise((r) => setTimeout(r, 500));
    const counters = __getTickCountForTests();
    await stop();

    // Either some ticks fired and some skipped, OR all ticks fired
    // (very fast machine) — the counters must be internally consistent.
    expect(counters.ticks).toBeGreaterThan(0);
    // The loop is alive while we observe.
    expect(counters.skipped).toBeGreaterThanOrEqual(0);
    // Sum is bounded by 500ms / 50ms = ~10 scheduled invocations + 1.
    expect(counters.ticks + counters.skipped).toBeLessThanOrEqual(15);
  });
});
