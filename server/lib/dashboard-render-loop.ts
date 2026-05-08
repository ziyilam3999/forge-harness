/**
 * v0.39.0 G1/AC-1/AC-2 — periodic dashboard re-render loop.
 * v0.40.2 — gated on real forge state.
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
 * v0.40.2 gate
 * ────────────
 * Prior to v0.40.2 the loop was started unconditionally from `main()`,
 * pinned to `process.cwd()`. That leaked `<cwd>/.forge/dashboard.html`
 * into any directory Claude was launched from (e.g. `~`). The gate now
 * requires the cwd to be an "active forge project" — at least one of:
 *
 *   1. State on disk at MCP server boot:
 *      - `<cwd>/.forge/runs/` exists AND contains ≥1 `*.json`
 *      - `<cwd>/.forge/audit/` exists AND contains ≥1 `*.jsonl`
 *      - `<cwd>/.forge/coordinate-brief.json` exists
 *      - `<cwd>/.forge/activity.json` exists
 *   2. State created in this session: any state-writing forge tool
 *      (`forge_plan`, `forge_generate`, `forge_evaluate`, `forge_coordinate`,
 *      `forge_declare_story`) is invoked while the MCP server is alive.
 *
 * Both signals funnel through one idempotent symbol —
 * `notifyForgeStateWrite()` — used by the boot probe AND by every
 * state-writing tool handler. Single-locus per F66.
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

import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
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
   * Default project path registered at MCP server boot — used by
   * `notifyForgeStateWrite()` when callers omit projectPath
   * (e.g. `forge_declare_story`, which has no projectPath in its input).
   * Captured by `registerDefaultProjectPath()`.
   */
  defaultProjectPath: string | null;
  /**
   * v0.40.2 — dormant-mode disk-state watcher. Low-frequency setInterval
   * that polls `hasForgeStateOnDisk()` while the main render loop is
   * dormant. When it observes state, it self-clears and wakes the main
   * loop. Anchored to AC-3a (state-on-disk appearing AFTER boot must
   * wake the loop autonomously, without a tool call). Set to null when
   * not armed.
   */
  dormantWatcherTimer: ReturnType<typeof setInterval> | null;
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
  defaultProjectPath: null,
  dormantWatcherTimer: null,
  ticks: 0,
  skipped: 0,
};

/**
 * v0.40.2 — dormant disk-state watcher poll cadence. Slower than the main
 * render-loop tick (which is 30s) — every 5s while dormant is plenty,
 * since the watcher only flips the gate from off to on; the main loop
 * takes over once flipped. AC-3a's verification window is 35s, so 5s
 * polling guarantees ≥6 chances to observe state appearing.
 */
export const DORMANT_WATCHER_INTERVAL_MS = 5_000;

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
  // The dormant watcher is superseded by the main loop. Disarm
  // unconditionally so we never run both timers simultaneously.
  disarmDormantDiskWatcher();

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
  disarmDormantDiskWatcher();
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
 * v0.40.2 — register the project path used by `notifyForgeStateWrite()`
 * when callers omit it (e.g., `forge_declare_story`, whose input does not
 * carry projectPath). Called once from `main()` at MCP server boot,
 * resolving `process.cwd()` to an absolute path (P51).
 *
 * Idempotent: calling with the same path is a no-op; calling with a
 * different path overwrites. Does NOT start the loop — that is the
 * caller's responsibility (boot probe + tool handlers).
 */
export function registerDefaultProjectPath(projectPath: string): void {
  state.defaultProjectPath = resolve(projectPath);
}

/**
 * v0.40.2 — disk-state probe used by the boot-time gate. Returns true
 * iff `<projectPath>/.forge/` contains any of:
 *   - `runs/` with ≥1 `*.json`
 *   - `audit/` with ≥1 `*.jsonl`
 *   - `coordinate-brief.json`
 *   - `activity.json`
 *
 * Explicitly does NOT count as active:
 *   - bare `.forge/` containing only `dashboard.html` and/or `.dashboard-opened`
 *     (the leaky-leftover from the v0.40.1 bug — without this exclusion the
 *     gate is sticky)
 *   - empty `runs/` or `audit/` subdirectories
 *
 * All I/O failures (ENOENT on `.forge/`, permission errors, etc.) are
 * treated as "not active" — the gate fails closed.
 */
export async function hasForgeStateOnDisk(projectPath: string): Promise<boolean> {
  const forgeDir = join(resolve(projectPath), ".forge");

  // Single-file markers: presence is sufficient.
  for (const marker of ["coordinate-brief.json", "activity.json"]) {
    try {
      await stat(join(forgeDir, marker));
      return true;
    } catch {
      // missing — try next marker
    }
  }

  // runs/*.json — directory must exist AND contain at least one .json file.
  if (await directoryHasFileMatching(join(forgeDir, "runs"), ".json")) {
    return true;
  }

  // audit/*.jsonl — directory must exist AND contain at least one .jsonl file.
  if (await directoryHasFileMatching(join(forgeDir, "audit"), ".jsonl")) {
    return true;
  }

  return false;
}

async function directoryHasFileMatching(
  dirPath: string,
  extension: string,
): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    return entries.some((name) => name.endsWith(extension));
  } catch {
    return false;
  }
}

/**
 * v0.40.2 — arm a low-frequency disk-state watcher while the main render
 * loop is dormant. Every `DORMANT_WATCHER_INTERVAL_MS` (5s), checks
 * `hasForgeStateOnDisk(projectPath)`; on the first true result it
 * self-disarms and calls `notifyForgeStateWrite(projectPath)` to start
 * the main loop.
 *
 * Why this is needed: AC-3a expects that disk-state appearing AFTER MCP
 * server boot (e.g. another process drops `.forge/runs/*.json`) wakes
 * the loop autonomously, without a tool call. The boot probe is a
 * one-shot snapshot; the dormant watcher fills the gap between boot
 * and the first tool call.
 *
 * Idempotent: arming twice with the same projectPath is a no-op. Arming
 * with a different path re-targets. Disarmed automatically when the
 * main loop starts.
 */
export function armDormantDiskWatcher(projectPath: string): void {
  const target = resolve(projectPath);
  if (state.timer) {
    // Main loop is already running; no need to watch dormantly.
    return;
  }
  if (state.dormantWatcherTimer && state.projectPath === target) {
    return;
  }
  // Re-target if needed.
  disarmDormantDiskWatcher();
  state.projectPath = target;
  state.dormantWatcherTimer = setInterval(() => {
    void (async () => {
      try {
        if (await hasForgeStateOnDisk(target)) {
          // State appeared. Promote to full loop AND fire an immediate
          // render so consumers see the dashboard within the next watcher
          // tick (not the next +30s main-loop tick). AC-3a's window is
          // 35s after state appears; the main loop's first tick alone
          // would race the deadline.
          disarmDormantDiskWatcher();
          notifyForgeStateWrite(target);
          try {
            await renderDashboard(target);
          } catch (err) {
            console.error(
              "dashboard-render-loop: dormant→active render failed (continuing):",
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      } catch {
        // swallow — watcher must never crash the process
      }
    })();
  }, DORMANT_WATCHER_INTERVAL_MS);
  if (
    typeof state.dormantWatcherTimer === "object" &&
    state.dormantWatcherTimer &&
    "unref" in state.dormantWatcherTimer
  ) {
    (state.dormantWatcherTimer as unknown as { unref: () => void }).unref();
  }
}

function disarmDormantDiskWatcher(): void {
  if (state.dormantWatcherTimer) {
    clearInterval(state.dormantWatcherTimer);
    state.dormantWatcherTimer = null;
  }
}

/**
 * v0.40.2 — single wake symbol called from the boot probe AND from every
 * state-writing tool handler (`forge_plan`, `forge_generate`,
 * `forge_evaluate`, `forge_coordinate`, `forge_declare_story`).
 *
 * Idempotent: if the loop is already running for the same projectPath,
 * this is a no-op. If the loop is running for a different projectPath,
 * it is re-targeted (start() with the new path — preserves the prior
 * "loop alive" invariant). If the loop is not running, it is started.
 *
 * `projectPath` is optional. When omitted, falls back to the path
 * registered at boot via `registerDefaultProjectPath()`. This is the
 * path that `forge_declare_story` (which has no projectPath in input)
 * uses to wake the loop — the declaration is process-scoped, not
 * project-scoped, so the boot-time cwd is the only meaningful anchor.
 *
 * Returns silently when no projectPath is available (neither argument
 * nor registered default). The loop simply stays dormant — no error
 * is propagated to the caller.
 */
export function notifyForgeStateWrite(projectPath?: string): void {
  const target = projectPath ? resolve(projectPath) : state.defaultProjectPath;
  if (!target) return;
  if (state.timer && state.projectPath === target) {
    return; // already running for this path — nothing to do
  }
  // Disarm any dormant-mode disk watcher — the main loop supersedes it.
  disarmDormantDiskWatcher();
  try {
    start(target);
  } catch (err) {
    console.error(
      "dashboard-render-loop: notifyForgeStateWrite failed (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }
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
  disarmDormantDiskWatcher();
  state.ticks = 0;
  state.skipped = 0;
  state.defaultProjectPath = null;
}
