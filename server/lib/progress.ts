/**
 * ProgressReporter — dynamic stage-based progress logging to stderr.
 *
 * Emits lines like: `forge_plan: [2/4] Running critic round 1...`
 * Stage list is built at runtime based on tier/config.
 */

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

  constructor(toolName: string, stages: string[]) {
    this.toolName = toolName;
    // Defensive copy so begin() appending unknown stages does not mutate caller's array.
    this.stages = [...stages];
  }

  /** Begin a stage, logging progress to stderr. */
  begin(stageName: string): void {
    this.currentIndex = this.stages.indexOf(stageName);
    if (this.currentIndex === -1) {
      // Unknown stage — append dynamically
      this.stages.push(stageName);
      this.currentIndex = this.stages.length - 1;
    }
    this.stageStartTimes.set(stageName, Date.now());
    const stageNum = this.currentIndex + 1;
    const total = this.stages.length;
    console.error(`${this.toolName}: [${stageNum}/${total}] ${stageName}...`);
  }

  /** Mark the current stage as completed. */
  complete(stageName: string): void {
    const startTime = this.stageStartTimes.get(stageName);
    const durationMs = startTime !== undefined ? Date.now() - startTime : 0;
    this.results.push({ name: stageName, durationMs, status: "completed" });
    this.stageStartTimes.delete(stageName);
  }

  /** Mark a stage as failed (partial progress on error). */
  fail(stageName: string): void {
    const startTime = this.stageStartTimes.get(stageName);
    const durationMs = startTime !== undefined ? Date.now() - startTime : 0;
    this.results.push({ name: stageName, durationMs, status: "failed" });
    this.stageStartTimes.delete(stageName);
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
}
