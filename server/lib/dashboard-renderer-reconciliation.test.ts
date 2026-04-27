/**
 * Renderer-integration tests for dashboard self-reconciliation.
 *
 * Covers the upstream plan's binary AC that operate at the
 * `renderDashboard` / brief-mapper boundary:
 *   - AC-1 happy-path squash-merge ends in the Done column
 *   - AC-2 master-presence is the predicate (NOT forge_status agreement)
 *   - AC-3 upward-only — existing `done` is never demoted
 *   - AC-7 squash-merge regression — `lastGitSha` not on master, but
 *     subject contains `US-NN` ⇒ story still classified as done
 *
 * AC-4..AC-6 + AC-8 live in `git-master-stories.test.ts` because they
 * exercise the helper itself, not the renderer integration.
 *
 * Test strategy
 * ─────────────
 * Two layers:
 *   1. Pure mapper tests against `__reconcileBriefStatusesWithMasterForTests`
 *      — fast, no fixture, drives AC-1/2/3/7 directly via fabricated
 *      `shippedStoryIds` sets.
 *   2. End-to-end renderer test against a real temp git repo with one
 *      squash-merge commit on `origin/master` and a brief that lists the
 *      story as `ready`. Verifies the rendered HTML moves the card into
 *      the `col-done` column without any operator intervention. This is
 *      the "the bug is fixed" smoke check; it shells out to real git and
 *      wires the actual `renderDashboard` end to end.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  __reconcileBriefStatusesWithMasterForTests as reconcile,
  renderDashboard,
} from "./dashboard-renderer.js";
import { __resetCacheForTests } from "./git-master-stories.js";
import type {
  PhaseTransitionBrief,
  StoryStatusEntry,
} from "../types/coordinate-result.js";

// ── Brief / story fixture factories ──────────────────────────────────────

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
  stories: StoryStatusEntry[],
  overrides: Partial<PhaseTransitionBrief> = {},
): PhaseTransitionBrief {
  return {
    status: "in-progress",
    stories,
    readyStories: [],
    depFailedStories: [],
    failedStories: [],
    completedCount: stories.filter((s) => s.status === "done").length,
    totalCount: stories.length,
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

// ── AC-1 — happy path: shipped story moves to Done ────────────────────────

describe("AC-1 — story whose ID appears on master surfaces as done", () => {
  it("brief shows US-05 ready; master has it; mapper upgrades to done + bumps completedCount", () => {
    const brief = makeBrief([
      makeStoryEntry("US-05", "ready"),
      makeStoryEntry("US-06", "pending"),
    ]);
    const { brief: reconciled, upgradedIds } = reconcile(brief, {
      shippedStoryIds: new Set(["US-05"]),
      warning: null,
    });
    const us05 = reconciled.stories.find((s) => s.storyId === "US-05");
    expect(us05?.status).toBe("done");
    // STORIES x/y widget reads completedCount; verify bump.
    expect(reconciled.completedCount).toBe(1);
    // Other stories untouched.
    expect(reconciled.stories.find((s) => s.storyId === "US-06")?.status).toBe("pending");
    // v0.39.0 — upgradedIds carries the master-merged set.
    expect(upgradedIds.has("US-05")).toBe(true);
    expect(upgradedIds.has("US-06")).toBe(false);
  });

  it("upgrade applied to all the eligible non-terminal states", () => {
    const brief = makeBrief([
      makeStoryEntry("US-01", "pending"),
      makeStoryEntry("US-02", "ready"),
      makeStoryEntry("US-03", "ready-for-retry"),
      makeStoryEntry("US-04", "failed"),
      makeStoryEntry("US-05", "dep-failed"),
    ]);
    const { brief: reconciled, upgradedIds } = reconcile(brief, {
      shippedStoryIds: new Set(["US-01", "US-02", "US-03", "US-04", "US-05"]),
      warning: null,
    });
    expect(reconciled.stories.every((s) => s.status === "done")).toBe(true);
    expect(reconciled.completedCount).toBe(5);
    expect(upgradedIds.size).toBe(5);
  });
});

// ── AC-2 — gitSha-on-master is the predicate ─────────────────────────────

describe("AC-2 — master-presence predicate, not forge_status agreement", () => {
  it("story with PASS evalVerdict but NOT on master stays as-brief", () => {
    // The brief reflects the absence-of-merge state: story is `ready`
    // (forge_evaluate PASS, but no merge yet — `forge_status` would say
    // `state: shipped`). Dashboard is stricter: no master-subject ⇒ no
    // promotion to done.
    const brief = makeBrief([makeStoryEntry("US-07", "ready")]);
    const { brief: reconciled, upgradedIds } = reconcile(brief, {
      shippedStoryIds: new Set(),
      warning: null,
    });
    expect(reconciled.stories[0].status).toBe("ready");
    expect(reconciled.completedCount).toBe(0);
    expect(upgradedIds.size).toBe(0);
  });
});

// ── AC-3 — upward-only ────────────────────────────────────────────────────

describe("AC-3 — upward-only (no demote on missing master entry)", () => {
  it("brief.done + master-empty ⇒ remains done (revert scenario protection)", () => {
    const brief = makeBrief([makeStoryEntry("US-08", "done")]);
    const { brief: reconciled } = reconcile(brief, {
      shippedStoryIds: new Set(),
      warning: null,
    });
    expect(reconciled.stories[0].status).toBe("done");
    expect(reconciled.completedCount).toBe(1);
  });

  it("brief.done + master also has it ⇒ still done, no double-count", () => {
    const brief = makeBrief([makeStoryEntry("US-08", "done")]);
    const { brief: reconciled, upgradedIds } = reconcile(brief, {
      shippedStoryIds: new Set(["US-08"]),
      warning: null,
    });
    expect(reconciled.stories[0].status).toBe("done");
    // upgradable set excludes "done", so no upgrade fires, so no bump.
    expect(reconciled.completedCount).toBe(1);
    expect(upgradedIds.size).toBe(0);
  });

  it("identity preserved when no upgrades happen (referential stability)", () => {
    const brief = makeBrief([makeStoryEntry("US-09", "done")]);
    const result = reconcile(brief, {
      shippedStoryIds: new Set(["US-09"]),
      warning: null,
    });
    // No upgrade ⇒ helper returns the original brief object on `result.brief`
    // so reference checks downstream stay stable. v0.39.0 wraps the return
    // in `{brief, upgradedIds}` — the inner brief reference is what callers
    // (the renderer) actually consume.
    expect(result.brief).toBe(brief);
    expect(result.upgradedIds.size).toBe(0);
  });
});

// ── Graceful-fallback path: warning present ──────────────────────────────

describe("graceful fallback — helper warning short-circuits to verbatim brief", () => {
  it("non-null warning ⇒ brief returned unchanged + stderr surfaces warning", () => {
    const brief = makeBrief([makeStoryEntry("US-10", "ready")]);
    const errSpy = (() => {
      const calls: string[] = [];
      const orig = console.error;
      console.error = ((...args: unknown[]) => {
        calls.push(args.map((a) => String(a)).join(" "));
      }) as typeof console.error;
      return {
        calls,
        restore: () => {
          console.error = orig;
        },
      };
    })();

    try {
      const { brief: reconciled } = reconcile(brief, {
        shippedStoryIds: new Set(),
        warning: "git binary not found on PATH",
      });
      expect(reconciled.stories[0].status).toBe("ready");
      expect(reconciled.completedCount).toBe(0);
      // Operator-facing warning landed.
      expect(errSpy.calls.some((c) => c.includes("master-reconciliation degraded"))).toBe(true);
      expect(errSpy.calls.some((c) => c.includes("git binary not found on PATH"))).toBe(true);
    } finally {
      errSpy.restore();
    }
  });
});

// ── AC-7 — squash-merge regression — end-to-end with real git ─────────────

describe("AC-7 — squash-merge regression (lastGitSha NOT on master, subject still wins)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "forge-dash-reconcile-"));
    __resetCacheForTests();
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("end-to-end: brief says US-12 ready; master subject contains US-12; rendered HTML places US-12 in col-done", async () => {
    // Initialise a real git repo with origin/master containing a
    // conventional-commit squash-merge subject. The `lastGitSha`
    // recorded in the RunRecord (simulated by NOT propagating the
    // branch HEAD into master — the squash created a NEW SHA
    // unrelated to lastGitSha) is irrelevant to the helper's lookup.
    execFileSync("git", ["init", "-q", "-b", "master", tmpRoot]);
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpRoot });
    execFileSync("git", ["config", "user.name", "test"], { cwd: tmpRoot });
    await writeFile(join(tmpRoot, "README.md"), "# test\n");
    execFileSync("git", ["add", "README.md"], { cwd: tmpRoot });
    execFileSync("git", ["commit", "-q", "-m", "chore: init"], { cwd: tmpRoot });
    // The squash-merge subject — contains US-12 in the conventional
    // commit type/scope, exactly like /ship produces.
    await writeFile(join(tmpRoot, "feature.ts"), "export const x = 1;\n");
    execFileSync("git", ["add", "feature.ts"], { cwd: tmpRoot });
    execFileSync("git", ["commit", "-q", "-m", "feat(US-12): knowledge service facade (#72)"], {
      cwd: tmpRoot,
    });
    // Push to a bare clone so origin/master resolves locally.
    const remote = `${tmpRoot}.remote.git`;
    execFileSync("git", ["init", "-q", "--bare", "-b", "master", remote]);
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: tmpRoot });
    execFileSync("git", ["push", "-q", "origin", "master"], { cwd: tmpRoot });

    // Write a coordinate-brief that lists US-12 as `ready` — i.e. the
    // bug-state where the brief is stale post-merge.
    const briefDir = join(tmpRoot, ".forge");
    await mkdir(briefDir, { recursive: true });
    const brief: PhaseTransitionBrief = makeBrief(
      [makeStoryEntry("US-12", "ready"), makeStoryEntry("US-13", "pending")],
      { totalCount: 2, completedCount: 0 },
    );
    await writeFile(
      join(briefDir, "coordinate-brief.json"),
      JSON.stringify(brief),
      "utf-8",
    );

    // Render. Production path; no mocks.
    await renderDashboard(tmpRoot);
    const html = await readFile(join(briefDir, "dashboard.html"), "utf-8");

    // The col-done div should contain US-12 (was bug — it would have
    // landed in col-ready). Use the same column-extraction strategy as
    // dashboard-renderer.test.ts: anchor on the column wrapper div.
    const colDoneRe = /<div class="kanban-column[^"]*" id="col-done">([\s\S]*?)<\/div>\s*<div class="kanban-column/;
    const colReadyRe = /<div class="kanban-column[^"]*" id="col-ready">([\s\S]*?)<\/div>\s*<div class="kanban-column/;
    const doneFragment = colDoneRe.exec(html)?.[1] ?? "";
    const readyFragment = colReadyRe.exec(html)?.[1] ?? "";
    expect(doneFragment).toContain("US-12");
    expect(readyFragment).not.toContain("US-12");

    // STORIES widget reflects the bump too — the value comes from
    // brief.completedCount which was 0 in the stored brief, but the
    // renderer reconciled +1 from the master scan, so it should read
    // `1/2` (NOT `0/2`).
    expect(html).toMatch(/Stories[\s\S]*?1\/2/);

    // Cleanup the bare remote (tmpRoot itself is cleaned in afterEach).
    await rm(remote, { recursive: true, force: true });
  });
});
