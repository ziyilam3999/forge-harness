/**
 * ProgressReporter — dynamic stage-based progress logging to stderr.
 *
 * Emits lines like: `forge_plan: [2/4] Running critic round 1...`
 * Stage list is built at runtime based on tier/config.
 *
 * Dashboard hooks (S8, additive):
 *   When a `projectPath` has been registered via `setProjectContext`,
 *   `begin` / `complete` / `fail` additionally update `.forge/activity.json`
 *   and re-render `.forge/dashboard.html`. All hook I/O is non-fatal —
 *   failures are logged and swallowed, matching the existing error policy
 *   used by `writeRunRecord` and `AuditLog`.
 *
 *   The context is exposed as a setter rather than a constructor parameter
 *   so the existing 2-arg constructor (and all current call sites) remain
 *   untouched. `RunContext` / callers opt in by calling `setProjectContext`
 *   after construction. When context is unset, the class behaves identically
 *   to the pre-S8 shape — no activity writes, no dashboard renders.
 */

import { writeActivity, type Activity } from "./activity.js";
import { renderDashboard } from "./dashboard-renderer.js";

export interface StageResult {
  name: string;
  durationMs: number;
  status: "completed" | "failed" | "skipped";
}

export class ProgressReporter {
  private toolName: string;
  private stages: string[];
  private currentIndex = 0;
  private results: StageResult[] = [];
  // Per-stage start times keyed by stage name. Using a Map (instead of a
  // single shared field) means overlapping or re-entrant begin() calls
  // preserve each stage's own start timestamp, so complete()/fail() can
  // always compute the correct duration for the stage being closed.
  private stageStartTimes = new Map<string, number>();

  // Dashboard-context (S8). Both optional — dashboard hooks fire only when
  // `projectPath` is set.
  private projectPath: string | null = null;
  private storyId: string | null = null;
  private activityStartedAt: string | null = null;

  constructor(toolName: string, stages: string[]) {
    this.toolName = toolName;
    // Defensive copy so begin() appending unknown stages does not mutate caller's array.
    this.stages = [...stages];
  }

  /**
   * Register the dashboard-context for this reporter. When set, `begin`,
   * `complete`, and `fail` additionally write `.forge/activity.json` and
   * re-render `.forge/dashboard.html`. Safe to call multiple times — most
   * recent values win. Passing `undefined` for either leaves that slot
   * unchanged; pass `null` to clear explicitly.
   */
  setProjectContext(projectPath: string | null, storyId?: string | null): void {
    this.projectPath = projectPath;
    if (storyId !== undefined) this.storyId = storyId;
  }

  /** Begin a stage, logging progress to stderr. */
  begin(stageName: string): void {
    this.currentIndex = this.stages.indexOf(stageName);
    if (this.currentIndex === -1) {
      // Unknown stage — append dynamically
      this.stages.push(stageName);
      this.currentIndex = this.stages.length - 1;
    }
    const now = Date.now();
    this.stageStartTimes.set(stageName, now);
    const stageNum = this.currentIndex + 1;
    const total = this.stages.length;
    console.error(`${this.toolName}: [${stageNum}/${total}] ${stageName}...`);

    // Dashboard hook: write activity + render. Non-fatal.
    if (this.projectPath) {
      if (this.activityStartedAt === null) {
        this.activityStartedAt = new Date(now).toISOString();
      }
      this.fireDashboardHooks(stageName, stageNum, total);
    }
  }

  /** Mark the current stage as completed. */
  complete(stageName: string): void {
    const startTime = this.stageStartTimes.get(stageName);
    const durationMs = startTime !== undefined ? Date.now() - startTime : 0;
    this.results.push({ name: stageName, durationMs, status: "completed" });
    this.stageStartTimes.delete(stageName);

    if (this.projectPath) {
      // Derive the stageNum from the stageName being closed rather than
      // the most-recently-begun index (#272). Deriving from the
      // most-recent index is fragile: if `complete` or `fail` arrives
      // for a stage that is not the most recently begun one (e.g.
      // overlapping stages from a re-entrant call), the label would
      // carry the wrong [N/total]. If the stageName is not in
      // `this.stages`, treat the close as a no-op for the dashboard
      // hook — there is no meaningful stageNum to emit.
      const stageIdx = this.stages.indexOf(stageName);
      if (stageIdx === -1) {
        this.maybeClearActivityStartedAt();
        return;
      }
      const stageNum = stageIdx + 1;
      const total = this.stages.length;
      this.fireDashboardHooks(stageName, stageNum, total);
      this.maybeClearActivityStartedAt();
    }
  }

  /** Mark a stage as failed (partial progress on error). */
  fail(stageName: string): void {
    const startTime = this.stageStartTimes.get(stageName);
    const durationMs = startTime !== undefined ? Date.now() - startTime : 0;
    this.results.push({ name: stageName, durationMs, status: "failed" });
    this.stageStartTimes.delete(stageName);

    if (this.projectPath) {
      // Derive stageNum from the stageName being closed (#272) — same
      // rationale as `complete`. Unknown stageName → hook no-op.
      const stageIdx = this.stages.indexOf(stageName);
      if (stageIdx === -1) {
        this.maybeClearActivityStartedAt();
        return;
      }
      const stageNum = stageIdx + 1;
      const total = this.stages.length;
      this.fireDashboardHooks(stageName, stageNum, total);
      this.maybeClearActivityStartedAt();
    }
  }

  /**
   * Clear `activityStartedAt` once no stage is in flight (#275).
   *
   * `activityStartedAt` is set once on the first `begin` and carried
   * through subsequent stages so the dashboard "started at" timestamp
   * reflects the overall tool-run, not each sub-stage. Previously it
   * was never reset, so a reporter instance reused across multiple
   * tool-runs would carry a stale first-run timestamp forward.
   *
   * The reset fires when all stage-start timestamps have been drained
   * (i.e. every `begin` has a matching `complete`/`fail`). A subsequent
   * `begin` re-seeds `activityStartedAt` with the new run's timestamp.
   */
  private maybeClearActivityStartedAt(): void {
    if (this.stageStartTimes.size === 0) {
      this.activityStartedAt = null;
    }
  }

  /** Mark a stage as skipped (e.g., critique skipped in quick tier). */
  skip(stageName: string): void {
    this.results.push({ name: stageName, durationMs: 0, status: "skipped" });
  }

  /** Get all stage results. */
  getResults(): StageResult[] {
    return [...this.results];
  }

  /** Get the total number of expected stages. */
  get totalStages(): number {
    return this.stages.length;
  }

  /**
   * Fire the dashboard side-effects in the background. Wrapped in a single
   * try/catch; any error is logged and swallowed so the reporter's caller
   * never sees a dashboard failure.
   */
  private fireDashboardHooks(stageName: string, stageNum: number, total: number): void {
    const projectPath = this.projectPath;
    if (!projectPath) return;

    const activity: Activity = {
      tool: this.toolName,
      stage: stageName,
      startedAt: this.activityStartedAt ?? new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      label: `[${stageNum}/${total}] ${stageName}`,
      progress: { current: stageNum, total },
    };
    if (this.storyId) activity.storyId = this.storyId;

    // Fire-and-forget. The called functions already swallow their own
    // errors, but we add an outer catch as a belt-and-braces guard.
    void (async () => {
      try {
        await writeActivity(projectPath, activity);
        await renderDashboard(projectPath);
      } catch (err) {
        console.error(
          "forge: dashboard hook failed (continuing):",
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }
}
