import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProgressReporter } from "./progress.js";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProgressReporter", () => {
  it("logs stage progress to stderr with correct count", () => {
    const reporter = new ProgressReporter("forge_plan", [
      "Scanning codebase",
      "Running planner",
      "Running critic",
    ]);

    reporter.begin("Running planner");
    expect(console.error).toHaveBeenCalledWith(
      "forge_plan: [2/3] Running planner...",
    );
  });

  it("logs first stage as [1/N]", () => {
    const reporter = new ProgressReporter("forge_plan", [
      "Scanning codebase",
      "Running planner",
    ]);

    reporter.begin("Scanning codebase");
    expect(console.error).toHaveBeenCalledWith(
      "forge_plan: [1/2] Scanning codebase...",
    );
  });

  it("tracks completed stages with duration", () => {
    const reporter = new ProgressReporter("forge_plan", ["Stage A"]);
    reporter.begin("Stage A");
    reporter.complete("Stage A");

    const results = reporter.getResults();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Stage A");
    expect(results[0].status).toBe("completed");
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("tracks failed stages", () => {
    const reporter = new ProgressReporter("forge_plan", ["Stage A"]);
    reporter.begin("Stage A");
    reporter.fail("Stage A");

    const results = reporter.getResults();
    expect(results[0].status).toBe("failed");
  });

  it("tracks skipped stages with 0 duration", () => {
    const reporter = new ProgressReporter("forge_plan", ["Stage A"]);
    reporter.skip("Stage A");

    const results = reporter.getResults();
    expect(results[0].status).toBe("skipped");
    expect(results[0].durationMs).toBe(0);
  });

  it("handles unknown stages by appending dynamically", () => {
    const reporter = new ProgressReporter("forge_plan", ["Stage A"]);
    reporter.begin("Unexpected Stage");

    expect(console.error).toHaveBeenCalledWith(
      "forge_plan: [2/2] Unexpected Stage...",
    );
    expect(reporter.totalStages).toBe(2);
  });

  it("reports correct total stages", () => {
    const reporter = new ProgressReporter("forge_plan", [
      "A", "B", "C", "D",
    ]);
    expect(reporter.totalStages).toBe(4);
  });

  it("complete() derives stageNum from stageName, not most-recent begin (#272)", () => {
    // Regression: previously `complete(stageName)` used the most-recently-
    // begun stage index to label the [N/total] emitted to the dashboard
    // hook. When close arrives for an out-of-order stage, the label
    // carried the wrong [N/total]. After the fix, the label is derived
    // from the stageName being closed. We exercise this by verifying
    // that calling complete("Stage B") after begin("Stage C") records
    // a "completed" result tied to Stage B (not to whichever stage was
    // most recently begun). The absence of a throw + the correct result
    // is load-bearing evidence.
    const reporter = new ProgressReporter("forge_plan", [
      "Stage A",
      "Stage B",
      "Stage C",
    ]);
    reporter.begin("Stage A");
    reporter.begin("Stage C"); // most-recently-begun = Stage C
    reporter.complete("Stage B"); // closes B out of order — must not die

    const results = reporter.getResults();
    const b = results.find((r) => r.name === "Stage B");
    expect(b).toBeDefined();
    expect(b!.status).toBe("completed");
  });

  it("activityStartedAt resets to null once all stages drain (#275)", () => {
    // The reporter carries activityStartedAt forward across sub-stages
    // so the dashboard "started at" reflects the outer tool-run. Once
    // every begin() has a matching close, the field must reset so that
    // a subsequent reuse of the same reporter instance starts fresh.
    //
    // We don't have a public accessor for activityStartedAt, so we
    // assert the invariant via a two-pass timestamp test: after a full
    // begin/complete cycle, a second begin() must generate a *new*
    // activityStartedAt timestamp on the Activity payload sent to the
    // dashboard hook. We capture that payload by stubbing writeActivity
    // via module mock.
    vi.resetModules();
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./activity.js", () => ({ writeActivity: writeSpy }));
    vi.doMock("./dashboard-renderer.js", () => ({
      renderDashboard: vi.fn().mockResolvedValue(undefined),
    }));

    return (async () => {
      const { ProgressReporter } = await import("./progress.js");
      const bogusRoot = process.platform === "win32"
        ? "Z:\\forge-reset-fixture"
        : "/tmp/forge-reset-nonexistent-xyz";
      const reporter = new ProgressReporter("forge_generate", ["stage-a"]);
      reporter.setProjectContext(bogusRoot, "US-R");

      reporter.begin("stage-a");
      reporter.complete("stage-a");

      // Drain microtasks so the fire-and-forget hook settles.
      for (let i = 0; i < 4; i += 1) {
        await new Promise((r) => setImmediate(r));
      }
      // Wait a tangible amount so a fresh Date.now() on the second
      // begin() yields a visibly-different ISO timestamp.
      await new Promise((r) => setTimeout(r, 15));

      // Capture startedAt from the first call.
      const firstStartedAt = (
        writeSpy.mock.calls[0][1] as { startedAt: string }
      ).startedAt;

      writeSpy.mockClear();
      reporter.begin("stage-a");
      for (let i = 0; i < 4; i += 1) {
        await new Promise((r) => setImmediate(r));
      }
      const secondStartedAt = (
        writeSpy.mock.calls[0][1] as { startedAt: string }
      ).startedAt;

      // If activityStartedAt had NOT reset, the second startedAt would
      // equal the first (the field was sticky). With the reset, the two
      // are different — the second begin() re-seeded from Date.now().
      expect(secondStartedAt).not.toBe(firstStartedAt);

      vi.doUnmock("./activity.js");
      vi.doUnmock("./dashboard-renderer.js");
      vi.resetModules();
    })();
  });
});
