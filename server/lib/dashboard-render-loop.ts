/**
 * v0.39.0 G1/AC-1/AC-2 — periodic dashboard re-render loop.
 *
 * Why this module exists
 * ──────────────────────
 * `renderDashboard()` is currently called from exactly two sites — mid-tool
 * progress events (`server/lib/progress.ts`) and the post-`writeRunRecord`
 * hook (`server/lib/run-record.ts`). After the last forge tool ends, no
 * one re-renders. The browser's 5s meta-refresh keeps loading the same
 * stale HTML. The most visible symptom: a story whose PR squash-merged
 * to master never appears as `done` until the operator re-runs a forge
 * tool, because the master-reconciler runs inside `renderDashboard` and
 * `renderDashboard` never fires.
 *
 * This module adds a third call site — a fixed-cadence timer — that
 * re-runs `renderDashboard` every ~30s while the MCP server process is
 * alive. It does NOT fire concurrent renders (a guard skips the next tick
 * if the prior render is still in flight), and it stops cleanly when
 * `stop()` is invoked (graceful shutdown, test teardown).
 *
 * Design choices
 * ──────────────
 * - Single source of "what's on disk now". No duplication of the
 *   read-render-write pipeline; we just call the existing function.
 * - Default interval = 30_000 ms. Configurable via `start({intervalMs})`
 *   for tests (which want short intervals to assert ≥2 ticks within 70s)
 *   and for environments that want different cadence trade-offs. The
 *   plan's AC-2 gates the interval to `[15_000, 30_000]` ms in production.
 * - Overlap guard: a single in-flight Promise. If the next tick fires
 *   while the prior render hasn't resolved yet, the next tick is skipped
 *   (NOT queued). Mirrors `renderQueue`'s policy in dashboard-renderer.ts:
 *   stale snapshots are fine; double-writes are not.
 * - Failure-tolerant: any exception in the rendered call is logged and
 *   swallowed. The loop never crashes the process.
 * - One global loop per process. The MCP server runs as a single
 *   long-lived stdio process; per-projectPath multiplexing is unneeded.
 */

import { renderDashboard } from "./dashboard-renderer.js";

/**
 * Default cadence. The plan's AC-2 bounds the configured interval to
 * `[15_000, 30_000]` ms; choosing the upper end keeps disk pressure
 * minimal while still satisfying AC-1's "≥ 2 renders in 70 s with no
 * tool activity" predicate. AC-2's verification clamps the gap to
 * `≤ 35 000 ms` to absorb OS scheduler jitter, queue serialization,
 * and slow-disk fsync.
 */
export const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Plan AC-2 — interval must satisfy `[15_000, 30_000]` ms in production.
 * Tests can pass smaller values (e.g. 200 ms for fast cadence proofs)
 * via the `allowFastInterval` escape hatch on `start()`.
 */
export const MIN_PRODUCTION_INTERVAL_MS = 15_000;
export const MAX_PRODUCTION_INTERVAL_MS = 30_000;

interface LoopState {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  projectPath: string | null;
  /**
   * Tick counter — exposed for tests via `__getTickCountForTests`. Not
   * part of the public API.
   */
  ticks: number;
  skipped: number;
}

const state: LoopState = {
  timer: null,
  inFlight: null,
  projectPath: null,
  ticks: 0,
  skipped: 0,
};

export interface StartOptions {
  /**
   * Interval between scheduled renders, in milliseconds. Defaults to
   * `DEFAULT_INTERVAL_MS`. Production callers should leave this at the
   * default; tests pass a smaller value with `allowFastInterval: true`.
   */
  intervalMs?: number;
  /**
   * Bypass the production-range gate. Tests need short intervals
   * (e.g. 200 ms) to assert tick counts in bounded test time.
   */
  allowFastInterval?: boolean;
}

/**
 * Start the periodic render loop. Idempotent — calling `start()` twice
 * with the same projectPath has no effect; the existing loop continues.
 * Calling `start()` with a different projectPath re-targets the loop.
 *
 * The first render does NOT fire immediately — production code already
 * triggers a render at server startup (or at the first tool call). The
 * loop's job is to keep the dashboard fresh between tool calls; firing
 * synchronously on start would race with whatever startup render is
 * already in flight.
 */
export function start(projectPath: string, options: StartOptions = {}): void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (
    !options.allowFastInterval &&
    (intervalMs < MIN_PRODUCTION_INTERVAL_MS ||
      intervalMs > MAX_PRODUCTION_INTERVAL_MS)
  ) {
    throw new Error(
      `dashboard-render-loop: intervalMs=${intervalMs} outside production range [${MIN_PRODUCTION_INTERVAL_MS}, ${MAX_PRODUCTION_INTERVAL_MS}]; pass {allowFastInterval: true} for tests`,
    );
  }

  if (state.timer && state.projectPath === projectPath) {
    return;
  }
  if (state.timer) {
    stop();
  }

  state.projectPath = projectPath;
  state.timer = setInterval(() => {
    void onTick();
  }, intervalMs);
  // Don't keep the Node process alive solely for this timer — the MCP
  // server's stdio transport is the lifetime anchor, and once stdio
  // closes we want the process to exit even if the timer is still
  // queued. Equivalent to `setInterval(...).unref()` on platforms that
  // support it. Test environments override this if they need timing
  // determinism (Vitest's fake timers control lifetime explicitly).
  if (typeof state.timer === "object" && state.timer && "unref" in state.timer) {
    (state.timer as unknown as { unref: () => void }).unref();
  }
}

async function onTick(): Promise<void> {
  if (!state.projectPath) return;
  if (state.inFlight) {
    state.skipped += 1;
    return;
  }
  state.ticks += 1;
  state.inFlight = (async () => {
    try {
      await renderDashboard(state.projectPath as string);
    } catch (err) {
      console.error(
        "dashboard-render-loop: render failed (continuing):",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      state.inFlight = null;
    }
  })();
  await state.inFlight;
}

/**
 * Stop the periodic render loop. Idempotent. Awaits any in-flight render
 * so callers can await `stop()` before tearing down their projectPath.
 */
export async function stop(): Promise<void> {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.inFlight) {
    try {
      await state.inFlight;
    } catch {
      // already swallowed inside onTick
    }
  }
  state.projectPath = null;
}

/**
 * Test-only seam: read internal counters. Production callers MUST NOT
 * depend on this; the shape may change.
 */
export function __getTickCountForTests(): {
  ticks: number;
  skipped: number;
  running: boolean;
} {
  return {
    ticks: state.ticks,
    skipped: state.skipped,
    running: state.timer !== null,
  };
}

/**
 * Test-only seam: reset internal state between tests. Cleans the timer,
 * waits for any in-flight render, and zeroes counters.
 */
export async function __resetForTests(): Promise<void> {
  await stop();
  state.ticks = 0;
  state.skipped = 0;
}
