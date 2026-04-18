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

import { writeFile, rename, mkdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type {
  PhaseTransitionBrief,
  StoryStatusEntry,
  StoryStatus,
} from "../types/coordinate-result.js";
import type { Activity } from "./activity.js";

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
}

// ── Format helpers ────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatMinutes(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatTimeOfDay(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    const ss = d.getSeconds().toString().padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}

// ── HTML builders ─────────────────────────────────────────────────────────

function renderHeader(brief: PhaseTransitionBrief | null): string {
  if (!brief) {
    return `
<div class="top-bar">
  <div class="top-bar-left">
    <div class="logo">Hive Mind <span>Forge</span><span class="logo-divider">/</span><span class="logo-sub">Coordinate</span></div>
    <div class="phase-tag">no brief</div>
    <div class="phase-status-pill">waiting</div>
  </div>
  <div class="top-bar-right">
    <span class="liveness-banner green" id="liveness-banner">initializing...</span>
  </div>
</div>`;
  }

  const budget = brief.budget;
  const budgetHtml = budget.budgetUsd === null
    ? `<div class="stat-card"><div class="stat-label">Budget</div><div class="stat-value">${formatUsd(budget.usedUsd)}</div><div class="stat-sub">no limit</div></div>`
    : `<div class="stat-card"><div class="stat-label">Budget</div><div class="stat-value">${formatUsd(budget.usedUsd)} / ${formatUsd(budget.budgetUsd)}</div><div class="stat-bar"><div class="stat-bar-fill ${budget.warningLevel}" style="width: ${Math.min(100, (budget.usedUsd / Math.max(budget.budgetUsd, 0.0001)) * 100).toFixed(1)}%"></div></div></div>`;

  const timeBudget = brief.timeBudget;
  const timeHtml = timeBudget.maxTimeMs === null
    ? `<div class="stat-card"><div class="stat-label">Time</div><div class="stat-value">${formatMinutes(timeBudget.elapsedMs)}</div><div class="stat-sub">no limit</div></div>`
    : `<div class="stat-card"><div class="stat-label">Time</div><div class="stat-value">${formatMinutes(timeBudget.elapsedMs)} / ${formatMinutes(timeBudget.maxTimeMs)}</div><div class="stat-bar"><div class="stat-bar-fill ${timeBudget.warningLevel}" style="width: ${Math.min(100, (timeBudget.elapsedMs / Math.max(timeBudget.maxTimeMs, 1)) * 100).toFixed(1)}%"></div></div></div>`;

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
  const activityHtml = activity && activity.tool
    ? renderActivityCard(activity)
    : "";

  const renderColumn = (id: string, title: string, accent: string) => {
    const items = byColumn[id];
    const cards = items.map(renderStoryCard).join("");
    const extra = id === COLUMN_IDS.inProgress ? activityHtml : "";
    const count = items.length + (id === COLUMN_IDS.inProgress && activityHtml ? 1 : 0);
    const emptyState = count === 0
      ? `<div class="empty-state"><div class="empty-hex"></div></div>`
      : "";
    return `<div class="kanban-column" id="${id}">
  <div class="column-header ${accent}"><span class="col-title">${escapeHtml(title)}</span><span class="col-count">${count}</span></div>
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
.phase-status-pill { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 10px; background: var(--grey-light); color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
.phase-status-pill.complete { background: var(--green-bg); color: var(--green); }
.phase-status-pill.needs-replan, .phase-status-pill.halted { background: var(--red-bg); color: var(--red); }
.phase-status-pill.in-progress { background: var(--amber-bg); color: var(--amber); }
.liveness-banner { font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; }
.liveness-banner.green { background: var(--green-bg); color: var(--green); }
.liveness-banner.amber { background: var(--amber-bg); color: var(--amber); }
.liveness-banner.red { background: var(--red-bg); color: var(--red); }
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
.kanban-column[id="col-ready"]::before { background: var(--border); }
.kanban-column[id="col-in-progress"]::before { background: var(--amber); }
.kanban-column[id="col-retry"]::before { background: var(--amber); }
.kanban-column[id="col-done"]::before { background: var(--green); }
.kanban-column[id="col-blocked"]::before { background: var(--red); }
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

  const lastUpdate = activity?.lastUpdate ?? renderedAt;
  const activityStarted = activity?.startedAt ?? renderedAt;

  // Serialize the pure classifier into the browser's script block so the
  // banner updates between meta-refreshes via setInterval.
  const classifierSrc = classifyStaleness.toString();

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
${renderHeader(brief)}
${renderReplanningNotes(brief)}
${renderBoard(brief, activity)}
${renderFeed(auditEntries)}
</div>
<script>
${classifierSrc}
var LAST_UPDATE = ${JSON.stringify(lastUpdate)};
var ACTIVITY_STARTED = ${JSON.stringify(activityStarted)};
function updateBanner() {
  var banner = document.getElementById("liveness-banner");
  if (!banner) return;
  var elapsed = Date.now() - new Date(LAST_UPDATE).getTime();
  var level = classifyStaleness(elapsed);
  banner.className = "liveness-banner " + level;
  if (level === "red") {
    banner.textContent = "No update for 2+ min — may be hung";
  } else if (level === "amber") {
    banner.textContent = "Last update: over 1 min ago";
  } else {
    banner.textContent = "Live — last update " + Math.round(elapsed / 1000) + "s ago";
  }
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
    if (!parsed || parsed.tool === null || parsed.tool === undefined) return null;
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
 * Read audit entries from `.forge/audit/*.jsonl` via the shared reader,
 * annotate each with the tool name derived from its source filename,
 * sort merged entries by timestamp descending, and clip to 20.
 */
async function readAuditFeed(projectPath: string): Promise<AuditFeedEntry[]> {
  // `readAuditEntries` returns parsed JSON but strips the filename. We need
  // the filename for the tool-name accent, so we re-read directly here
  // using the same path layout (mirrors run-reader's contract for
  // graceful degradation).
  const { readdir, readFile: rf } = await import("node:fs/promises");
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
      content = await rf(join(auditDir, file), "utf-8");
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
 * Atomic tmp+rename writer. Exposed so tests can verify AC-09 by supplying
 * a `DashboardIo` with mocked `writeFile` and `rename`.
 */
export async function writeDashboardHtml(
  projectPath: string,
  html: string,
  io: DashboardIo = DEFAULT_IO,
): Promise<void> {
  const forgeDir = join(projectPath, ".forge");
  const tmpPath = join(forgeDir, "dashboard.tmp.html");
  const finalPath = join(forgeDir, "dashboard.html");
  await io.mkdir(forgeDir, { recursive: true });
  await io.writeFile(tmpPath, html, "utf-8");
  await io.rename(tmpPath, finalPath);
}

/**
 * Render the dashboard and write it to `.forge/dashboard.html`.
 *
 * Error policy: all I/O wrapped in a single try/catch. Any failure is
 * logged to stderr and swallowed — the parent tool's invocation is never
 * affected by a dashboard problem.
 *
 * The `io` parameter is a test seam only; production callers omit it.
 */
export async function renderDashboard(
  projectPath: string,
  io: DashboardIo = DEFAULT_IO,
): Promise<void> {
  try {
    const [brief, activity, auditEntries] = await Promise.all([
      readCoordinateBrief(projectPath),
      readActivity(projectPath),
      readAuditFeed(projectPath),
    ]);
    const html = renderDashboardHtml({
      brief,
      activity,
      auditEntries,
      renderedAt: new Date().toISOString(),
    });
    await writeDashboardHtml(projectPath, html, io);
  } catch (err) {
    console.error(
      "forge: failed to render dashboard (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }
}
