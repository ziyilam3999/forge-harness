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
  private stageStartTime: number | null = null;

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
    this.stageStartTime = Date.now();
    const stageNum = this.currentIndex + 1;
    const total = this.stages.length;
    console.error(`${this.toolName}: [${stageNum}/${total}] ${stageName}...`);
  }

  /** Mark the current stage as completed. */
  complete(stageName: string): void {
    const durationMs = this.stageStartTime ? Date.now() - this.stageStartTime : 0;
    this.results.push({ name: stageName, durationMs, status: "completed" });
    this.stageStartTime = null;
  }

  /** Mark a stage as failed (partial progress on error). */
  fail(stageName: string): void {
    const durationMs = this.stageStartTime ? Date.now() - this.stageStartTime : 0;
    this.results.push({ name: stageName, durationMs, status: "failed" });
    this.stageStartTime = null;
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
