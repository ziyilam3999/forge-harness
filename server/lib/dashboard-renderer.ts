/**
 * Dashboard renderer — stateless HTML Kanban view of forge_coordinate state.
 *
 * Reads three on-disk inputs:
 *   1. `.forge/coordinate-brief.json` — PhaseTransitionBrief snapshot (written
 *      by coordinator after assessPhase).
 *   2. `.forge/activity.json`         — ephemeral "what is running now"
 *      signal (written by ProgressReporter hooks).
 *   3. `.forge/audit/*.jsonl`         — append-only decision trail (reused
 *      via readAuditEntries, all lines from all files, last 20 by timestamp).
 *
 * Produces `.forge/dashboard.html` — a single self-contained HTML file with
 * inline CSS and JS. No npm deps, no external fetches, no server. The browser
 * auto-refreshes every 5s via `<meta http-equiv="refresh">`.
 *
 * Write semantics: atomic tmp + rename, directory bootstrap, non-fatal error
 * policy (matches `writeRunRecord` and `AuditLog`). Failures are logged to
 * stderr and swallowed — they never crash the parent tool. This preserves
 * the invariant "dashboard I/O is a side effect, not a correctness gate."
 *
 * Exports:
 *   - `classifyStaleness(elapsedMs)` — pure green/amber/red classifier.
 *     Defined once here (for unit testability) AND serialized into the HTML
 *     `<script>` block via string template so it runs in the browser too.
 *   - `renderDashboard(projectPath)` — the I/O-orchestrating entry point
 *     called by ProgressReporter and writeRunRecord.
 *   - `renderDashboardHtml(input)` — the pure HTML-building function
 *     (exposed for unit tests that supply known inputs directly).
 */

import { writeFile, rename, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, basename } from "node:path";
import type {
  PhaseTransitionBrief,
  StoryStatusEntry,
  StoryStatus,
} from "../types/coordinate-result.js";
import type { Activity } from "./activity.js";
import { getDeclaration, type StoryDeclaration } from "./declaration-store.js";

// ── Activity liveness helper ──────────────────────────────────────────────

/**
 * Single source of truth for "is a tool actively running right now?" per #353.
 *
 * Rejects `null`, `undefined`, AND empty-string `tool` values — an `{tool: ""}`
 * payload must never count as running (per #276, `readActivity` and the
 * `renderBoard` guard previously disagreed on empty strings; collapsing both
 * sites onto this helper prevents that class of drift).
 */
function isToolRunning(activity: Activity | null | undefined): boolean {
  if (activity == null) return false;
  if (activity.tool == null) return false;
  if (activity.tool === "") return false;
  return true;
}

// ── Pure staleness classifier ──────────────────────────────────────────────

/**
 * Pure function: elapsedMs → liveness band.
 *
 * Thresholds:
 *   - elapsed > 120_000 → "red"    (likely hung / crashed; operator alert)
 *   - elapsed >  60_000 → "amber"  (slow tick; worth a glance)
 *   - otherwise         → "green"  (live)
 *
 * Exported for unit testing (no JSDOM needed). Also serialized verbatim into
 * the HTML `<script>` block via `${classifyStaleness.toString()}` so the
 * browser runs the same logic.
 */
export function classifyStaleness(elapsedMs: number): "green" | "amber" | "red" {
  if (elapsedMs > 120_000) return "red";
  if (elapsedMs > 60_000) return "amber";
  return "green";
}

// ── Banner-copy selector ───────────────────────────────────────────────────

/**
 * Pure function: (staleness level, tool-running flag, elapsedMs) → banner
 * (className + textContent) pair.
 *
 * Encodes the runtime branch selection that the `updateBanner` IIFE runs
 * inside the browser. Extracted as a top-level helper (mirroring
 * `classifyStaleness`) so unit tests can exercise each branch directly
 * without parsing HTML. Serialized verbatim into the HTML `<script>` block
 * via `${chooseBannerCopy.toString()}` so the browser runs the same logic.
 *
 * Branch semantics:
 *   - When no tool is running and the level is stale (amber/red), downgrade
 *     to a neutral "Idle — no tool running" banner. Being idle is not a hang.
 *   - When a tool is running (or level is green), render the level-appropriate
 *     copy — red for likely-hung, amber for slow-tick, green for live.
 *
 * Issues: #331, #352, #355.
 */
export function chooseBannerCopy(
  level: "green" | "amber" | "red",
  toolRunning: boolean,
  elapsedMs: number,
): { className: string; textContent: string } {
  if (!toolRunning && level !== "green") {
    return {
      className: "liveness-banner neutral",
      textContent: "Idle — no tool running",
    };
  }
  if (level === "red") {
    return {
      className: "liveness-banner red",
      textContent: "No update for 2+ min — may be hung",
    };
  }
  if (level === "amber") {
    return {
      className: "liveness-banner amber",
      textContent: "Last update: over 1 min ago",
    };
  }
  return {
    className: "liveness-banner green",
    textContent: "Live — last update " + Math.round(elapsedMs / 1000) + "s ago",
  };
}

// ── Column layout (status → column id) ────────────────────────────────────

/** The 6 column ids. Encoded once; used by renderer + tested by AC-02. */
export const COLUMN_IDS = {
  backlog: "col-backlog",
  ready: "col-ready",
  inProgress: "col-in-progress",
  retry: "col-retry",
  done: "col-done",
  blocked: "col-blocked",
} as const;

/**
 * Map a StoryStatus to its non-in-progress column id. The "in-progress"
 * column is derived from `.forge/activity.json`, not from StoryStatus —
 * stories flow into it via the activity signal, not via a 7th status.
 */
function statusToColumn(status: StoryStatus): string {
  switch (status) {
    case "pending":         return COLUMN_IDS.backlog;
    case "ready":           return COLUMN_IDS.ready;
    case "ready-for-retry": return COLUMN_IDS.retry;
    case "done":            return COLUMN_IDS.done;
    case "failed":          return COLUMN_IDS.blocked;
    case "dep-failed":      return COLUMN_IDS.blocked;
  }
}

// ── HTML escaping ──────────────────────────────────────────────────────────

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Audit feed helpers ────────────────────────────────────────────────────

export interface AuditFeedEntry {
  timestamp: string;
  stage: string;
  agentRole: string;
  decision: string;
  reasoning: string;
  /** Tool name derived from filename ({tool}-{timestamp}.jsonl). */
  tool: string;
}

function toolNameFromFilename(filename: string): string {
  // Filename format: `{toolName}-{safeTimestamp}.jsonl` where safeTimestamp
  // starts with a YYYY- prefix. Strip extension then lop off everything from
  // the first "-20" (start of the timestamp year prefix) onward.
  const base = basename(filename, ".jsonl");
  const match = base.match(/^(.+?)-\d{4}-/);
  return match ? match[1] : base;
}

// ── Render input ──────────────────────────────────────────────────────────

export interface DashboardRenderInput {
  brief: PhaseTransitionBrief | null;
  activity: Activity | null;
  /** Audit entries merge-sorted by timestamp; renderer takes the last 20. */
  auditEntries: ReadonlyArray<AuditFeedEntry>;
  /** ISO timestamp of this render — used for staleness banner. */
  renderedAt: string;
  /**
   * Active story declaration (from `forge_declare_story`), or null when no
   * agent has declared a story in this MCP process. When non-null, the
   * dashboard header surfaces a "Declared: US-XX" pill so operators can see
   * the active story during the implementation gap window — the period
   * between `forge_generate`-complete and `forge_evaluate`-begin when
   * `.forge/activity.json` is idle but an agent is still writing code.
   *
   * Optional-with-default-null so existing callers (renderer tests that build
   * `DashboardRenderInput` literals) don't need to thread a new field.
   */
  declaration?: StoryDeclaration | null;
  /**
   * v0.35.1 AC-3 — idle-free totals aggregated across `.forge/runs/` records
   * (same semantics as `forge_status.totals`). When provided, the TIME widget
   * renders `totals.elapsedMs` (sum of `metrics.durationMs`) instead of the
   * brief's wall-clock `timeBudget.elapsedMs`. The two differ meaningfully:
   * `timeBudget.elapsedMs` measures wall-clock since plan start (inflated by
   * idle time); `totals.elapsedMs` measures only the time tools were
   * actually running.
   *
   * Optional-with-default-undefined so existing renderer tests that build
   * DashboardRenderInput literals continue to work. When absent, the TIME
   * widget falls back to `brief.timeBudget.elapsedMs` (pre-v0.35.1 behavior).
   */
  totals?: {
    elapsedMs: number;
    spentUsd?: number;
  };
}

// ── Format helpers ────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * v0.35.1 AC-4 — scalable elapsed formatter.
 *
 * Breakpoints:
 *   - ≥ 24h   → `Dd Hh Mm Ss`   (e.g., `1d 17h 40m 00s`)
 *   - ≥ 1h    → `Hh Mm Ss`      (e.g., `2h 15m 03s`)
 *   - < 1h    → `Mm Ss`         (e.g., `5m 07s`)
 *
 * Negative / NaN input coerces to 0 so the dashboard never renders garbage.
 * `Math.floor` throughout — no rounding, so `59.9s` renders as `59s`, not
 * `60s` (which would roll over the minute counter incorrectly).
 */
export function formatElapsed(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safe / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const ss = seconds.toString().padStart(2, "0");
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${ss}s`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${ss}s`;
  }
  return `${minutes}m ${ss}s`;
}

/**
 * v0.35.1 AC-5 — format an ISO timestamp as `YYYY-MM-DD HH:MM:SS` (UTC).
 *
 * Pre-v0.35.1 this only rendered `HH:MM:SS`, which made cross-day rows in
 * the activity feed look chronologically scrambled (all rows showed the
 * same time-of-day band with no date distinction). The date prefix is
 * emitted ahead of the time so the Regex AC (`/YYYY-MM-DD.*HH:MM:SS/`)
 * can match within one feed row.
 *
 * UTC getters (`getUTCFullYear`, etc.) guarantee the rendered date matches
 * the ISO input's date component regardless of the host timezone — avoids
 * the edge case where a machine east/west of UTC would show a one-day-off
 * label near midnight UTC. The Reviewer AC fixture uses a mid-afternoon
 * UTC timestamp, but making this timezone-stable costs nothing and prevents
 * flakiness on CI runners in any TZ.
 */
function formatTimeOfDay(iso: string): string {
  try {
    const d = new Date(iso);
    const yyyy = d.getUTCFullYear().toString();
    const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = d.getUTCDate().toString().padStart(2, "0");
    const hh = d.getUTCHours().toString().padStart(2, "0");
    const mm = d.getUTCMinutes().toString().padStart(2, "0");
    const ss = d.getUTCSeconds().toString().padStart(2, "0");
    return `${yyyy}-${mo}-${dd} ${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}

// ── HTML builders ─────────────────────────────────────────────────────────

/**
 * Render the active-story declaration pill, or "" when no declaration is
 * active. The pill surfaces `forge_declare_story`'s state into the header
 * so the declaration is visible during the implementation gap window
 * (between `forge_generate`-complete and `forge_evaluate`-begin) when
 * `.forge/activity.json` is idle.
 *
 * Returns empty string when `declaration === null` (Goal invariant 2 — no
 * placeholder strings when nothing is declared).
 */
function renderDeclarationPill(declaration: StoryDeclaration | null | undefined): string {
  if (!declaration) return "";
  const phaseSuffix = declaration.phaseId
    ? ` <span class="decl-phase">(${escapeHtml(declaration.phaseId)})</span>`
    : "";
  return `<div class="declaration-pill" data-story-id="${escapeHtml(declaration.storyId)}"><span class="decl-label">Declared</span> <span class="decl-story-id">${escapeHtml(declaration.storyId)}</span>${phaseSuffix}</div>`;
}

function renderHeader(
  brief: PhaseTransitionBrief | null,
  declaration: StoryDeclaration | null | undefined,
  totalsElapsedMs: number | null,
): string {
  const declarationHtml = renderDeclarationPill(declaration);
  if (!brief) {
    return `
<div class="top-bar">
  <div class="top-bar-left">
    <div class="logo">Hive Mind <span>Forge</span><span class="logo-divider">/</span><span class="logo-sub">Coordinate</span></div>
    <div class="phase-tag">no brief</div>
    <div class="phase-status-pill">waiting</div>
    ${declarationHtml}
  </div>
  <div class="top-bar-right">
    <span class="liveness-banner green" id="liveness-banner">initializing...</span>
  </div>
</div>`;
  }

  const budget = brief.budget;
  // v0.35.1 AC-6 — when BudgetInfo carries `isOAuth: true`, the BUDGET
  // widget annotates the spent value with a "Max plan — $0 actual" marker
  // so operators reading the dashboard don't think the Max-plan OAuth user
  // is being billed per-token. When `isOAuth` is false/missing, render as
  // before. Mutually exclusive with the non-null-budget branch below — the
  // OAuth marker only fires when no external budget cap is configured (Max
  // plan cost accounting is opaque, so there's no meaningful "X / Y" ratio).
  const isOAuth = budget.isOAuth === true;
  let budgetHtml: string;
  if (budget.budgetUsd === null) {
    if (isOAuth) {
      budgetHtml = `<div class="stat-card"><div class="stat-label">Budget</div><div class="stat-value">${formatUsd(budget.usedUsd)}</div><div class="stat-sub oauth-marker">Max plan — $0 actual (API-equivalent)</div></div>`;
    } else {
      budgetHtml = `<div class="stat-card"><div class="stat-label">Budget</div><div class="stat-value">${formatUsd(budget.usedUsd)}</div><div class="stat-sub">no limit</div></div>`;
    }
  } else {
    budgetHtml = `<div class="stat-card"><div class="stat-label">Budget</div><div class="stat-value">${formatUsd(budget.usedUsd)} / ${formatUsd(budget.budgetUsd)}</div><div class="stat-bar"><div class="stat-bar-fill ${budget.warningLevel}" style="width: ${Math.min(100, (budget.usedUsd / Math.max(budget.budgetUsd, 0.0001)) * 100).toFixed(1)}%"></div></div></div>`;
  }

  // v0.35.1 AC-3 — prefer idle-free `totals.elapsedMs` over wall-clock
  // `timeBudget.elapsedMs`. `totals.elapsedMs` is the sum of tool
  // `metrics.durationMs` across RunRecords (same value forge_status returns
  // in `.totals.elapsedMs`). Only fall back to wall-clock when totals is
  // not threaded through (e.g., renderer tests that pre-date this change).
  const timeBudget = brief.timeBudget;
  const effectiveElapsedMs =
    totalsElapsedMs !== null ? totalsElapsedMs : timeBudget.elapsedMs;
  const timeHtml = timeBudget.maxTimeMs === null
    ? `<div class="stat-card"><div class="stat-label">Time</div><div class="stat-value">${formatElapsed(effectiveElapsedMs)}</div><div class="stat-sub">no limit</div></div>`
    : `<div class="stat-card"><div class="stat-label">Time</div><div class="stat-value">${formatElapsed(effectiveElapsedMs)} / ${formatElapsed(timeBudget.maxTimeMs)}</div><div class="stat-bar"><div class="stat-bar-fill ${timeBudget.warningLevel}" style="width: ${Math.min(100, (effectiveElapsedMs / Math.max(timeBudget.maxTimeMs, 1)) * 100).toFixed(1)}%"></div></div></div>`;

  const progressPct = brief.totalCount > 0
    ? Math.round((brief.completedCount / brief.totalCount) * 100)
    : 0;

  const storiesHtml = `<div class="stat-card"><div class="stat-label">Stories</div><div class="stat-value">${brief.completedCount}/${brief.totalCount}</div><div class="stat-bar"><div class="stat-bar-fill green" style="width: ${progressPct}%"></div></div></div>`;
  const recHtml = `<div class="stat-card"><div class="stat-label">Recommendation</div><div class="stat-value-sm">${escapeHtml(brief.recommendation || "-")}</div></div>`;

  return `
<div class="top-bar">
  <div class="top-bar-left">
    <div class="logo">Hive Mind <span>Forge</span><span class="logo-divider">/</span><span class="logo-sub">Coordinate</span></div>
    <div class="phase-tag">${escapeHtml(brief.status)}</div>
    <div class="phase-status-pill ${escapeHtml(brief.status)}">${escapeHtml(brief.status)}</div>
    ${declarationHtml}
  </div>
  <div class="top-bar-right">
    <span class="liveness-banner green" id="liveness-banner">initializing...</span>
  </div>
</div>
<div class="stats-row">
  ${storiesHtml}
  ${budgetHtml}
  ${timeHtml}
  ${recHtml}
</div>`;
}

function renderReplanningNotes(brief: PhaseTransitionBrief | null): string {
  if (!brief || !brief.replanningNotes || brief.replanningNotes.length === 0) return "";
  const notes = [...brief.replanningNotes].sort((a, b) => {
    const order = { blocking: 0, "should-address": 1, informational: 2 } as const;
    return order[a.severity] - order[b.severity];
  });
  return `<div class="replanning-notes">${notes.map((n) =>
    `<div class="replanning-note ${escapeHtml(n.severity)}"><span class="severity-tag">${escapeHtml(n.severity.toUpperCase())}</span><span class="note-desc">${escapeHtml(n.description)}</span></div>`
  ).join("")}</div>`;
}

function renderStoryCard(entry: StoryStatusEntry): string {
  const retryBadge = entry.retryCount > 0
    ? `<span class="retry-badge">${entry.retryCount}/3 retries</span>`
    : "";
  const evidence = entry.evidence
    ? `<div class="card-evidence">${escapeHtml(entry.evidence)}</div>`
    : "";
  return `<div class="story-card ${escapeHtml(entry.status)}"><div class="card-id">${escapeHtml(entry.storyId)}</div>${retryBadge}${evidence}</div>`;
}

function renderActivityCard(activity: Activity): string {
  const stageText = activity.stage ?? "running";
  const storyIdText = activity.storyId ? `<div class="card-id">${escapeHtml(activity.storyId)}</div>` : "";
  const labelText = activity.label ? `<div class="card-label">${escapeHtml(activity.label)}</div>` : "";
  return `<div class="story-card active">
    ${storyIdText}
    <div class="card-tool">${escapeHtml(activity.tool)}</div>
    <div class="card-stage">${escapeHtml(stageText)}</div>
    ${labelText}
    <div class="card-live"><span class="hex-dot amber"></span> live</div>
  </div>`;
}

function renderBoard(brief: PhaseTransitionBrief | null, activity: Activity | null): string {
  const entries = brief?.stories ?? [];

  const byColumn: Record<string, StoryStatusEntry[]> = {
    [COLUMN_IDS.backlog]: [],
    [COLUMN_IDS.ready]: [],
    [COLUMN_IDS.inProgress]: [],
    [COLUMN_IDS.retry]: [],
    [COLUMN_IDS.done]: [],
    [COLUMN_IDS.blocked]: [],
  };

  const activeStoryId = activity?.storyId ?? null;

  for (const entry of entries) {
    // Stories whose id matches the activity signal route to in-progress,
    // regardless of their underlying StoryStatus.
    if (activeStoryId && entry.storyId === activeStoryId) {
      byColumn[COLUMN_IDS.inProgress].push(entry);
      continue;
    }
    const col = statusToColumn(entry.status);
    byColumn[col].push(entry);
  }

  // If the activity signal references a story that is not present in the
  // brief's stories array (e.g. first render before any RunRecord), the
  // activity card still shows — prepend a synthetic entry to in-progress.
  // `isToolRunning` rejects null / undefined / empty-string `tool` values
  // consistently with `readActivity` (#276, #353).
  const activityHtml = isToolRunning(activity)
    ? renderActivityCard(activity as Activity)
    : "";

  const renderColumn = (id: string, title: string, accent: string) => {
    const items = byColumn[id];
    const cards = items.map(renderStoryCard).join("");
    const extra = id === COLUMN_IDS.inProgress ? activityHtml : "";
    const count = items.length + (id === COLUMN_IDS.inProgress && activityHtml ? 1 : 0);
    const emptyState = count === 0
      ? `<div class="empty-state"><div class="empty-hex"></div></div>`
      : "";
    // Emit the accent as a class on the wrapper so the CSS does not have
    // to reference column ids via `[id="col-x"]` attribute selectors. Keeps
    // the grep `id="col-..."` count at exactly 1 per column.
    const accentClass = accent === "neutral"
      ? "accent-neutral"
      : accent === "amber"
        ? "accent-amber"
        : accent === "green"
          ? "accent-green"
          : accent === "red"
            ? "accent-red"
            : "accent-grey";
    return `<div class="kanban-column ${accentClass}" id="${id}">
  <div class="column-header"><span class="col-title">${escapeHtml(title)}</span><span class="col-count">${count}</span></div>
  <div class="column-body">${extra}${cards}${emptyState}</div>
</div>`;
  };

  return `<div class="kanban-board">
  ${renderColumn(COLUMN_IDS.backlog, "Backlog", "grey")}
  ${renderColumn(COLUMN_IDS.ready, "Ready", "neutral")}
  ${renderColumn(COLUMN_IDS.inProgress, "In Progress", "amber")}
  ${renderColumn(COLUMN_IDS.retry, "Retry", "amber")}
  ${renderColumn(COLUMN_IDS.done, "Done", "green")}
  ${renderColumn(COLUMN_IDS.blocked, "Blocked", "red")}
</div>`;
}

function renderFeed(auditEntries: ReadonlyArray<AuditFeedEntry>): string {
  if (auditEntries.length === 0) {
    return `<div class="activity-feed empty"><div class="feed-empty">No audit entries yet.</div></div>`;
  }
  const rows = auditEntries.map((e) =>
    `<div class="feed-entry">
  <span class="feed-time">${escapeHtml(formatTimeOfDay(e.timestamp))}</span>
  <span class="feed-tool"><span class="hex-dot"></span>${escapeHtml(e.tool)}</span>
  <span class="feed-stage">${escapeHtml(e.stage)}</span>
  <span class="feed-decision">(decision: ${escapeHtml(e.decision)})</span>
  <span class="feed-role">${escapeHtml(e.agentRole)}</span>
</div>`).join("");
  return `<div class="activity-feed">${rows}</div>`;
}

// ── CSS block ─────────────────────────────────────────────────────────────

const DASHBOARD_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --white: #f7f5f0; --off-white: #efece5; --light-green: #e8f0e8;
  --border: #ccc8be; --border-light: #ddd9d0;
  --text: #2c2c28; --text-secondary: #5c5c54; --text-dim: #8c8c82;
  --green: #16a34a; --green-bg: #e8f0e8;
  --amber: #b8860b; --amber-bg: #fdf8e8;
  --red: #c03030; --red-bg: #faf0f0;
  --grey: #8c8c82;
  --font-ui: 'Segoe UI', system-ui, -apple-system, sans-serif;
  --font-mono: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  --shadow-sm: 0 1px 3px rgba(60,55,45,0.10);
}
html { font-size: 15px; }
body { font-family: var(--font-ui); line-height: 1.5; background: var(--off-white); color: var(--text); min-height: 100vh; }
.dashboard { max-width: 1400px; margin: 0 auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
.top-bar { background: var(--white); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-sm); padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; position: relative; }
.top-bar::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--green-bg), var(--green), var(--green-bg)); opacity: 0.5; border-radius: 10px 10px 0 0; }
.top-bar-left, .top-bar-right { display: flex; align-items: center; gap: 12px; }
.logo { font-size: 14px; font-weight: 700; color: var(--text); }
.logo span { color: var(--green); }
.logo-divider { color: var(--border); margin: 0 2px; font-weight: 300; }
.logo-sub { font-size: 13px; font-weight: 500; color: var(--text-secondary); }
.phase-tag { font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--green); background: var(--green-bg); padding: 3px 10px; border-radius: 6px; }
.phase-status-pill { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 10px; background: var(--border-light); color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
.phase-status-pill.complete { background: var(--green-bg); color: var(--green); }
.phase-status-pill.needs-replan, .phase-status-pill.halted { background: var(--red-bg); color: var(--red); }
.phase-status-pill.in-progress { background: var(--amber-bg); color: var(--amber); }
.declaration-pill { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 10px; background: var(--green-bg); color: var(--green); display: inline-flex; align-items: center; gap: 6px; }
.declaration-pill .decl-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); font-weight: 700; }
.declaration-pill .decl-story-id { font-family: var(--font-mono); font-weight: 700; }
.declaration-pill .decl-phase { font-family: var(--font-mono); color: var(--text-secondary); font-weight: 500; }
.liveness-banner { font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; }
.liveness-banner.green { background: var(--green-bg); color: var(--green); }
.liveness-banner.amber { background: var(--amber-bg); color: var(--amber); }
.liveness-banner.red { background: var(--red-bg); color: var(--red); }
.liveness-banner.neutral { background: var(--border-light); color: var(--text-secondary); }
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.stat-card { background: var(--white); border: 1px solid var(--border-light); border-radius: 10px; padding: 12px 16px; box-shadow: var(--shadow-sm); }
.stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); font-weight: 600; }
.stat-value { font-family: var(--font-mono); font-size: 22px; font-weight: 700; color: var(--text); margin: 4px 0; }
.stat-value-sm { font-size: 13px; color: var(--text-secondary); }
.stat-sub { font-size: 12px; color: var(--text-dim); font-style: italic; }
.stat-bar { height: 6px; background: var(--border-light); border-radius: 3px; overflow: hidden; margin-top: 6px; }
.stat-bar-fill { height: 100%; background: var(--green); transition: width 0.6s ease; }
.stat-bar-fill.approaching { background: var(--amber); }
.stat-bar-fill.exceeded { background: var(--red); }
.replanning-notes { display: flex; flex-direction: column; gap: 6px; }
.replanning-note { padding: 8px 14px; border-radius: 8px; border: 1px solid; font-size: 13px; display: flex; gap: 10px; align-items: center; }
.replanning-note.blocking { background: var(--red-bg); border-color: var(--red); color: var(--red); }
.replanning-note.should-address { background: var(--amber-bg); border-color: var(--amber); color: var(--amber); }
.replanning-note.informational { background: var(--off-white); border-color: var(--border-light); color: var(--text-secondary); }
.severity-tag { font-family: var(--font-mono); font-weight: 700; font-size: 11px; }
.kanban-board { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.kanban-column { background: var(--white); border: 1px solid var(--border-light); border-radius: 10px; padding: 12px; box-shadow: var(--shadow-sm); min-height: 160px; position: relative; }
.kanban-column::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; border-radius: 10px 10px 0 0; background: var(--grey); }
.kanban-column.accent-neutral::before { background: var(--border); }
.kanban-column.accent-amber::before { background: var(--amber); }
.kanban-column.accent-green::before { background: var(--green); }
.kanban-column.accent-red::before { background: var(--red); }
.column-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); font-weight: 700; padding-bottom: 8px; border-bottom: 1px solid var(--border-light); margin-bottom: 8px; }
.column-body { display: flex; flex-direction: column; gap: 8px; }
.story-card { background: var(--off-white); border: 1px solid var(--border-light); border-radius: 8px; padding: 10px; font-size: 12px; }
.story-card.active { background: var(--amber-bg); border: 1.5px solid var(--amber); }
.story-card .card-id { font-family: var(--font-mono); font-weight: 600; color: var(--green); font-size: 13px; }
.story-card .card-tool { color: var(--text-secondary); font-weight: 600; margin-top: 4px; }
.story-card .card-stage { color: var(--text); font-size: 12px; margin-top: 2px; }
.story-card .card-label { color: var(--text-dim); font-size: 11px; margin-top: 2px; }
.story-card .card-evidence { color: var(--text-dim); font-size: 11px; margin-top: 6px; font-style: italic; }
.story-card .card-live { color: var(--amber); font-size: 11px; margin-top: 6px; }
.retry-badge { display: inline-block; font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--amber); background: var(--amber-bg); padding: 2px 6px; border-radius: 4px; margin-top: 4px; }
.empty-state { display: flex; justify-content: center; align-items: center; padding: 20px 0; }
.empty-hex { width: 32px; height: 32px; background: var(--border-light); clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%); }
.hex-dot { display: inline-block; width: 10px; height: 10px; background: var(--green); clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%); vertical-align: middle; margin-right: 4px; }
.hex-dot.amber { background: var(--amber); animation: hex-pulse 2s ease-in-out infinite; }
@keyframes hex-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.85); opacity: 0.5; } }
.activity-feed { background: var(--white); border: 1px solid var(--border-light); border-radius: 10px; padding: 12px 16px; max-height: 220px; overflow-y: auto; box-shadow: var(--shadow-sm); font-size: 12px; }
.activity-feed.empty { color: var(--text-dim); font-style: italic; }
.feed-entry { display: grid; grid-template-columns: 80px 140px 1fr auto 90px; gap: 10px; padding: 4px 0; border-bottom: 1px dashed var(--border-light); align-items: center; }
.feed-entry:last-child { border-bottom: none; }
.feed-time { font-family: var(--font-mono); color: var(--text-dim); font-size: 11px; }
.feed-tool { font-family: var(--font-mono); color: var(--green); font-weight: 600; }
.feed-stage { color: var(--text); }
.feed-decision { color: var(--text-secondary); font-style: italic; }
.feed-role { font-family: var(--font-mono); color: var(--text-dim); font-size: 11px; text-align: right; }
`;

// ── Top-level render ──────────────────────────────────────────────────────

export function renderDashboardHtml(input: DashboardRenderInput): string {
  const { brief, activity, auditEntries, renderedAt } = input;
  // Declaration is optional on the input (default null) so the wide universe
  // of renderer tests that build `DashboardRenderInput` literals keep working
  // untouched. When absent, `renderDeclarationPill` emits "" — no false
  // positives in the rendered HTML (Goal invariant 2).
  const declaration = input.declaration ?? null;
  // v0.35.1 AC-3 — idle-free elapsed; when absent, the TIME widget falls
  // back to brief.timeBudget.elapsedMs (pre-v0.35.1 behavior).
  const totalsElapsedMs =
    input.totals && typeof input.totals.elapsedMs === "number"
      ? input.totals.elapsedMs
      : null;

  const lastUpdate = activity?.lastUpdate ?? renderedAt;
  const activityStarted = activity?.startedAt ?? renderedAt;
  // Derived idle-vs-running signal: when the activity.json file is absent or
  // contains {"tool": null}, readActivity() returns null here, so "no tool
  // is running" collapses to `activity == null`. The `activity?.tool != null`
  // belt-and-braces also covers any future caller that supplies a partial
  // Activity literal. Issue #331.
  const toolRunning = isToolRunning(activity);

  // Serialize the pure classifier + banner-copy selector into the browser's
  // script block so the banner updates between meta-refreshes via setInterval.
  const classifierSrc = classifyStaleness.toString();
  const bannerCopySrc = chooseBannerCopy.toString();

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="5">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Forge Coordinate — Dashboard</title>
<style>${DASHBOARD_CSS}</style>
</head>
<body>
<div class="dashboard">
${renderHeader(brief, declaration, totalsElapsedMs)}
${renderReplanningNotes(brief)}
${renderBoard(brief, activity)}
${renderFeed(auditEntries)}
</div>
<script>
${classifierSrc}
${bannerCopySrc}
var LAST_UPDATE = ${JSON.stringify(lastUpdate)};
var ACTIVITY_STARTED = ${JSON.stringify(activityStarted)};
var TOOL_RUNNING = ${JSON.stringify(toolRunning)};
function updateBanner() {
  var banner = document.getElementById("liveness-banner");
  if (!banner) return;
  var elapsed = Date.now() - new Date(LAST_UPDATE).getTime();
  var level = classifyStaleness(elapsed);
  // Runtime branch selection lives in chooseBannerCopy (#355) so the unit
  // tests can exercise each branch directly rather than substring-matching
  // against the serialized HTML. Idle-vs-running downgrade logic and the
  // level-specific copy are encoded there. Issues #331, #352, #355.
  var copy = chooseBannerCopy(level, TOOL_RUNNING, elapsed);
  banner.className = copy.className;
  banner.textContent = copy.textContent;
}
updateBanner();
setInterval(updateBanner, 1000);
</script>
</body>
</html>`;

  return html;
}

// ── I/O orchestration ─────────────────────────────────────────────────────

async function readCoordinateBrief(projectPath: string): Promise<PhaseTransitionBrief | null> {
  const briefPath = join(projectPath, ".forge", "coordinate-brief.json");
  try {
    const raw = await readFile(briefPath, "utf-8");
    return JSON.parse(raw) as PhaseTransitionBrief;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.error(
        `forge: failed to read coordinate-brief.json (rendering degraded): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }
}

async function readActivity(projectPath: string): Promise<Activity | null> {
  const activityPath = join(projectPath, ".forge", "activity.json");
  try {
    const raw = await readFile(activityPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Activity> & { tool: string | null };
    // Reject null / undefined / empty-string tool consistently with
    // `isToolRunning` and the `renderBoard` guard (#276).
    if (!parsed || parsed.tool == null || parsed.tool === "") return null;
    return parsed as Activity;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.error(
        `forge: failed to read activity.json (rendering without live card): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }
}

/**
 * v0.35.1 AC-7 — synthesize activity-feed entries from `.forge/runs/*.json`
 * RunRecords so the dashboard surfaces `forge_evaluate` / `forge_coordinate`
 * invocations alongside `forge_plan` / `forge_generate` audit entries.
 *
 * RunRecords don't carry `stage` / `agentRole` / `decision` / `reasoning`
 * columns — we synthesize reasonable defaults:
 *   - `stage`    ← record.outcome  ("success" / "validation-failure" / …)
 *   - `agentRole`← record.tool     (same as the tool column, for the role
 *                                   sidebar in the activity feed)
 *   - `decision` ← record.evalVerdict ?? record.outcome (a one-word marker
 *                                   so the "decision:" column still reads)
 *   - `reasoning`← "" (no free-form field on RunRecord)
 *
 * Also synthesizes one entry per active declaration (from the in-memory
 * declaration store) using the declaration's `declaredAt` timestamp, so
 * `forge_declare_story` calls appear alongside the rest even though they
 * don't write RunRecords. The declaration is a singleton — at most one
 * entry ever comes from this source per render.
 *
 * `forge_status` is deliberately silent (read-only by design); polling spam
 * would drown the feed. See plan Goal invariant 7.
 */
async function readRunsFeed(projectPath: string): Promise<AuditFeedEntry[]> {
  const runsDir = join(projectPath, ".forge", "runs");
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return [];
  }
  const out: AuditFeedEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    let content: string;
    try {
      content = await readFile(join(runsDir, file), "utf-8");
    } catch {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      continue;
    }
    const tool = typeof parsed.tool === "string" ? parsed.tool : "";
    const timestamp =
      typeof parsed.timestamp === "string" ? parsed.timestamp : "";
    if (!tool || !timestamp) continue;
    const outcome =
      typeof parsed.outcome === "string" ? parsed.outcome : "";
    const evalVerdict =
      typeof parsed.evalVerdict === "string" ? parsed.evalVerdict : "";
    out.push({
      timestamp,
      stage: outcome,
      agentRole: tool,
      decision: evalVerdict || outcome || "",
      reasoning: "",
      tool,
    });
  }
  return out;
}

/**
 * v0.35.1 AC-7 — synthesize an activity-feed entry for the in-memory
 * declaration, if any. At most one entry ever comes from this source.
 */
function readDeclarationFeed(): AuditFeedEntry[] {
  const decl = getDeclaration();
  if (!decl) return [];
  return [
    {
      timestamp: decl.declaredAt,
      stage: "declared",
      agentRole: "forge_declare_story",
      decision: decl.storyId,
      reasoning: decl.phaseId ? `phase=${decl.phaseId}` : "",
      tool: "forge_declare_story",
    },
  ];
}

/**
 * Read audit entries from `.forge/audit/*.jsonl` via the shared reader,
 * annotate each with the tool name derived from its source filename,
 * sort merged entries by timestamp descending, and clip to 20.
 */
async function readAuditFeed(projectPath: string): Promise<AuditFeedEntry[]> {
  // `readAuditEntries` returns parsed JSON but strips the filename. We need
  // the filename for the tool-name accent, so we re-read directly here
  // using the same path layout (mirrors run-reader's contract for
  // graceful degradation).
  const auditDir = join(projectPath, ".forge", "audit");

  let files: string[];
  try {
    files = await readdir(auditDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    if (code === "EACCES" || code === "EPERM") {
      console.error(`forge: permission denied reading ${auditDir} (skipping)`);
      return [];
    }
    return [];
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort();
  const out: AuditFeedEntry[] = [];

  for (const file of jsonlFiles) {
    const tool = toolNameFromFilename(file);
    let content: string;
    try {
      content = await readFile(join(auditDir, file), "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Partial<AuditFeedEntry>;
        if (typeof parsed.timestamp === "string") {
          out.push({
            timestamp: parsed.timestamp,
            stage: parsed.stage ?? "",
            agentRole: parsed.agentRole ?? "",
            decision: parsed.decision ?? "",
            reasoning: parsed.reasoning ?? "",
            tool,
          });
        }
      } catch {
        // corrupt line — skip
      }
    }
  }

  // Reverse chronological — Date-object comparison, not HH:MM:SS string.
  out.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return out.slice(0, 20);
}

/**
 * Injectable I/O seam — lets unit tests mock `writeFile` and `rename`
 * without relying on ESM module-spy capability (which vitest limits on
 * re-exported native modules). Defaults to `node:fs/promises`. Production
 * callers never supply an override.
 */
export interface DashboardIo {
  writeFile: (path: string, data: string, encoding: "utf-8") => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<string | undefined>;
}

const DEFAULT_IO: DashboardIo = {
  writeFile: (p, d, e) => writeFile(p, d, e),
  rename: (o, n) => rename(o, n),
  mkdir: (p, o) => mkdir(p, o).then(() => undefined),
};

/**
 * Per-project serialization chain for `writeDashboardHtml` (#271).
 *
 * Two concurrent `renderDashboard` calls against the same `projectPath`
 * previously raced on the shared `dashboard.tmp.html` filename — the later
 * `writeFile` could overwrite the earlier one mid-flight, or the earlier
 * `rename` could miss its own tmp file (already moved), leaving stderr
 * noise and a momentarily-stale `dashboard.html`.
 *
 * This Map chains per-project writes into a serial queue: each new write
 * awaits the previous one's completion (success OR failure) before
 * attempting its own mkdir / writeFile / rename sequence. No global lock
 * — writes against different project paths still run in parallel.
 *
 * Keyed by `projectPath` so per-project state stays isolated. Entries are
 * not purged — the chain's tail is always just a resolved Promise, so
 * memory cost is one Promise-per-project, not one Promise-per-write.
 */
const renderQueue = new Map<string, Promise<void>>();

/**
 * Atomic tmp+rename writer. Exposed so tests can verify AC-09 by supplying
 * a `DashboardIo` with mocked `writeFile` and `rename`.
 *
 * Serialized per `projectPath` via `renderQueue` (#271) — concurrent calls
 * against the same project queue up rather than racing on the shared
 * `dashboard.tmp.html` filename. Independent projects still write in
 * parallel.
 */
export async function writeDashboardHtml(
  projectPath: string,
  html: string,
  io: DashboardIo = DEFAULT_IO,
): Promise<void> {
  const forgeDir = join(projectPath, ".forge");
  const tmpPath = join(forgeDir, "dashboard.tmp.html");
  const finalPath = join(forgeDir, "dashboard.html");

  const prior = renderQueue.get(projectPath) ?? Promise.resolve();
  const next = prior
    .catch(() => {
      /* swallow prior failure — each write is independent; don't chain
         cancellations across unrelated invocations. */
    })
    .then(async () => {
      await io.mkdir(forgeDir, { recursive: true });
      await io.writeFile(tmpPath, html, "utf-8");
      await io.rename(tmpPath, finalPath);
    });
  renderQueue.set(projectPath, next);
  await next;
}

/**
 * Injectable I/O seam for the auto-open path — separate from `DashboardIo`
 * so tests that mock the atomic-write contract don't have to stub the
 * auto-open-only fields. Production callers use `DEFAULT_AUTO_OPEN_IO`.
 */
export interface AutoOpenIo {
  stat: (path: string) => Promise<void>;
  openExternal: (target: string) => Promise<void>;
  writeFile: (path: string, data: string, encoding: "utf-8") => Promise<void>;
}

const DEFAULT_AUTO_OPEN_IO: AutoOpenIo = {
  stat: (p) => stat(p).then(() => undefined),
  openExternal: (target) =>
    new Promise<void>((resolve, reject) => {
      const child =
        process.platform === "win32"
          ? spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" })
          : process.platform === "darwin"
            ? spawn("open", [target], { detached: true, stdio: "ignore" })
            : spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
      child.once("error", (err) => reject(err));
    }),
  writeFile: (p, d, e) => writeFile(p, d, e),
};

/**
 * Open the dashboard in the user's default browser — env-gated, one-shot.
 *
 * Gates (both must hold):
 *   1. `FORGE_DASHBOARD_AUTO_OPEN=1` in the environment (opt-in; default off
 *      so `npm test`, CI, and MCP servers launched without the flag never
 *      spawn a browser). The env var is re-read on each invocation — toggling
 *      `FORGE_DASHBOARD_AUTO_OPEN` mid-process takes effect on the next call
 *      (per-invocation check, not a startup-time snapshot). Issue #303.
 *   2. Marker `.forge/.dashboard-opened` must be absent. First successful
 *      open writes the marker; subsequent renders are no-ops. Delete the
 *      marker to re-open the tab (e.g. after closing it accidentally).
 *
 * The marker is only written AFTER the child process emits its `"spawn"`
 * event — if the spawn fails (e.g. `xdg-open` missing on a headless box),
 * no marker lands and the next render re-attempts. Issue #281.
 *
 * The `stat` catch treats **only** `ENOENT` as "marker absent, proceed to
 * open". Any other error — including errors without a `code` property —
 * is logged and the render skips auto-open for this tick. This prevents
 * EPERM/EIO (or a non-Node-FS rejection) from being silently re-interpreted
 * as "no marker yet" and re-opening a tab on every render. Issue #283 +
 * #291 widening.
 *
 * Exported + accepts an injectable `AutoOpenIo` so the env-gated behavior
 * can be unit-tested without real filesystem side effects. Issue #282.
 *
 * Uses spawn with an argv array (no shell interpolation) to avoid any
 * command-injection surface on user-controlled paths. The child is
 * detached + unreffed so the MCP process exits independently.
 *
 * Failure-swallowed per the parent renderer's error policy.
 */
export async function maybeAutoOpenBrowser(
  projectPath: string,
  io: AutoOpenIo = DEFAULT_AUTO_OPEN_IO,
): Promise<void> {
  if (process.env.FORGE_DASHBOARD_AUTO_OPEN !== "1") return;

  const markerPath = join(projectPath, ".forge", ".dashboard-opened");
  try {
    await io.stat(markerPath);
    return;
  } catch (err) {
    // Defensive typeof guard per #300: a non-object throw (`throw "string"`,
    // `throw null`, or `throw 42`) must not trigger a property read on a
    // primitive. Only read `.code` when `err` is a non-null object; any
    // primitive throw falls through to the non-ENOENT "skip open" branch.
    const code =
      err !== null && typeof err === "object"
        ? (err as NodeJS.ErrnoException).code
        : undefined;
    if (code !== "ENOENT") {
      // Any non-ENOENT condition — including undefined code from a plain
      // Error or a primitive throw — is treated as "cannot determine
      // marker state safely; skip open". This matches the spirit of
      // #283 (#291 widening) + #300 (defensive typeof guard).
      console.error(
        "forge: dashboard auto-open stat failed (continuing):",
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    /* ENOENT — marker absent, proceed to open */
  }

  try {
    const dashboardPath = join(projectPath, ".forge", "dashboard.html");
    await io.openExternal(dashboardPath);
    await io.writeFile(markerPath, new Date().toISOString(), "utf-8");
  } catch (err) {
    console.error(
      "forge: dashboard auto-open failed (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Render the dashboard and write it to `.forge/dashboard.html`.
 *
 * Error policy: all I/O wrapped in a single try/catch. Any failure is
 * logged to stderr and swallowed — the parent tool's invocation is never
 * affected by a dashboard problem.
 *
 * Optional auto-open: if the environment variable FORGE_DASHBOARD_AUTO_OPEN
 * is "1", the first successful render also spawns the OS-native browser
 * against the rendered file. See maybeAutoOpenBrowser() for full gating.
 *
 * The `io` parameter is a test seam only; production callers omit it.
 */
/**
 * v0.35.1 AC-7 — union feed entries from all three activity sources:
 *   1. `.forge/audit/*.jsonl` (forge_plan + forge_generate write here)
 *   2. `.forge/runs/*.json`   (forge_evaluate + forge_coordinate write here)
 *   3. declaration store       (forge_declare_story lives in memory)
 *
 * Merge-sort by timestamp descending, clip to 20. `forge_status` is
 * deliberately absent — it's read-only by design.
 *
 * Exported so tests can exercise the union directly against a fixture
 * `.forge/` tree without re-rendering the whole dashboard.
 */
export async function readActivityFeed(
  projectPath: string,
): Promise<AuditFeedEntry[]> {
  const [audit, runs] = await Promise.all([
    readAuditFeed(projectPath),
    readRunsFeed(projectPath),
  ]);
  const decl = readDeclarationFeed();
  const merged = [...audit, ...runs, ...decl];
  merged.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  return merged.slice(0, 20);
}

export async function renderDashboard(
  projectPath: string,
  io: DashboardIo = DEFAULT_IO,
): Promise<void> {
  try {
    const [brief, activity, auditEntries] = await Promise.all([
      readCoordinateBrief(projectPath),
      readActivity(projectPath),
      readActivityFeed(projectPath),
    ]);
    // Declaration is a synchronous in-memory read — deliberately NOT bundled
    // into the Promise.all above because there's no I/O to overlap. Reading
    // at render time (same pattern forge_status uses via buildActiveRun in
    // server/tools/status.ts:242) lets this render pick up declarations made
    // AFTER the renderer's last invocation without any additional coupling
    // between `forge_declare_story` and the dashboard write path.
    const declaration = getDeclaration();

    // v0.35.1 AC-3 — compute idle-free totals.elapsedMs (sum of durationMs
    // across `.forge/runs/` primary records), so the TIME widget reads
    // execution time, not wall-clock. Same semantics as forge_status.totals.
    const totals = await readTotalsFromRuns(projectPath);

    const html = renderDashboardHtml({
      brief,
      activity,
      auditEntries,
      renderedAt: new Date().toISOString(),
      declaration,
      totals,
    });
    await writeDashboardHtml(projectPath, html, io);
    await maybeAutoOpenBrowser(projectPath);
  } catch (err) {
    console.error(
      "forge: failed to render dashboard (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * v0.35.1 AC-3 — sum `metrics.durationMs` across `.forge/runs/*.json`
 * primary records. Same semantics as forge_status.totals.elapsedMs. Missing
 * dir / unreadable files / corrupt JSON are silently skipped; the worst
 * case is `elapsedMs: 0`, which the renderer treats as a fallback to the
 * brief's wall-clock timeBudget.elapsedMs.
 */
async function readTotalsFromRuns(
  projectPath: string,
): Promise<{ elapsedMs: number; spentUsd: number }> {
  const runsDir = join(projectPath, ".forge", "runs");
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return { elapsedMs: 0, spentUsd: 0 };
  }
  let elapsedMs = 0;
  let spentUsd = 0;
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    let content: string;
    try {
      content = await readFile(join(runsDir, file), "utf-8");
    } catch {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      continue;
    }
    const metrics = parsed.metrics;
    if (!metrics || typeof metrics !== "object") continue;
    const m = metrics as Record<string, unknown>;
    if (typeof m.durationMs === "number") elapsedMs += m.durationMs;
    if (typeof m.estimatedCostUsd === "number") spentUsd += m.estimatedCostUsd;
  }
  return { elapsedMs, spentUsd };
}
