/**
 * v0.35.0 — dashboard surfaces active story declarations (field report from
 * monday, 2026-04-21 thread `v034-field-report-2026-04-21`).
 *
 * Covers AC-2 (positive probe — storyId appears in HTML), AC-3 (differential
 * — renderer actually reads the field), AC-4 (end-to-end disk render picks
 * up the declaration), plus a Goal-invariant-2 negative test (no placeholder
 * strings when declaration is null).
 *
 * Test names all include "declaration" so AC-6's declaration-name filter
 * sees ≥ 3 matches.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  renderDashboardHtml,
  renderDashboard,
  type DashboardRenderInput,
} from "./dashboard-renderer.js";
import { setDeclaration, clearDeclaration } from "./declaration-store.js";

function baseInput(
  extra: Partial<DashboardRenderInput> = {},
): DashboardRenderInput {
  return {
    brief: null,
    activity: null,
    auditEntries: [],
    renderedAt: "2026-04-21T09:00:00.000Z",
    ...extra,
  };
}

describe("renderDashboardHtml — active story declaration surfaces in HTML (AC-2)", () => {
  it("emits the declared storyId literal when a declaration is present", () => {
    const html = renderDashboardHtml(
      baseInput({
        declaration: {
          storyId: "US-UNIQUE-PROBE-999",
          phaseId: "PH-UNIQUE-888",
          declaredAt: "2026-04-21T09:00:00.000Z",
        },
      }),
    );
    expect(html).toContain("US-UNIQUE-PROBE-999");
  });

  it("also surfaces the phaseId when the declaration carries one", () => {
    const html = renderDashboardHtml(
      baseInput({
        declaration: {
          storyId: "US-WITH-PHASE",
          phaseId: "PH-12",
          declaredAt: "2026-04-21T09:00:00.000Z",
        },
      }),
    );
    expect(html).toContain("US-WITH-PHASE");
    expect(html).toContain("PH-12");
  });
});

describe("renderDashboardHtml — differential: renderer actually reads the declaration field (AC-3)", () => {
  it("two renders with different storyIds produce different HTML where each only contains its own id", () => {
    const base = baseInput();
    const htmlA = renderDashboardHtml({
      ...base,
      declaration: {
        storyId: "US-PROBE-AAA",
        phaseId: null,
        declaredAt: "2026-04-21T09:00:00.000Z",
      },
    });
    const htmlB = renderDashboardHtml({
      ...base,
      declaration: {
        storyId: "US-PROBE-BBB",
        phaseId: null,
        declaredAt: "2026-04-21T09:00:00.000Z",
      },
    });

    expect(htmlA).toContain("US-PROBE-AAA");
    expect(htmlA).not.toContain("US-PROBE-BBB");
    expect(htmlB).toContain("US-PROBE-BBB");
    expect(htmlB).not.toContain("US-PROBE-AAA");
    expect(htmlA).not.toEqual(htmlB);
  });
});

describe("renderDashboardHtml — no declaration ⇒ no placeholder strings (Goal invariant 2)", () => {
  // NOTE: `.declaration-pill` always appears as a literal in the stylesheet
  // block (the CSS selectors live inline in the rendered HTML), so asserting
  // on the bare class name would false-positive. Instead assert against the
  // `data-story-id="..."` attribute, which is only emitted by the actual
  // rendered pill element — not by the stylesheet.
  it("omits the rendered declaration-pill element when declaration is null", () => {
    const html = renderDashboardHtml(baseInput({ declaration: null }));
    expect(html).not.toMatch(/<div class="declaration-pill"/);
    expect(html).not.toContain('data-story-id=');
  });

  it("omits the declaration pill when declaration field is absent from input", () => {
    // Belt-and-braces: the field is optional, so callers can simply not set
    // it. Renderer must treat `undefined` identically to `null`.
    const html = renderDashboardHtml(baseInput());
    expect(html).not.toMatch(/<div class="declaration-pill"/);
    expect(html).not.toContain('data-story-id=');
  });
});

describe("renderDashboard — surfaces active declaration end-to-end", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "forge-dashboard-decl-"));
    // Clear any module-level state leaked from prior tests in the same vitest
    // worker. declaration-store is a module-scoped singleton, so a stray
    // declaration from an earlier test could otherwise bleed into this one.
    clearDeclaration();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    clearDeclaration();
    vi.restoreAllMocks();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("renderDashboard surfaces active declaration end-to-end", async () => {
    // This is the named test AC-4 greps for. Its title must stay exactly
    // "renderDashboard surfaces active declaration end-to-end".
    setDeclaration("US-E2E-PROBE-777", "PH-777");
    await renderDashboard(tmpRoot);

    const html = await readFile(join(tmpRoot, ".forge", "dashboard.html"), "utf-8");
    expect(html).toContain("US-E2E-PROBE-777");
  });

  it("renderDashboard with no declaration active emits no rendered declaration pill", async () => {
    // Isolation test for the null path: if declaration-store is empty, the
    // on-disk HTML must NOT contain any declaration pill markers. Check the
    // `<div class="declaration-pill"` opening tag and the `data-story-id`
    // attribute — the class name alone appears in the stylesheet, so it's
    // not a reliable marker. Protects the invariant that stale state from a
    // prior process can't leak into a fresh render.
    clearDeclaration();
    await renderDashboard(tmpRoot);

    const html = await readFile(join(tmpRoot, ".forge", "dashboard.html"), "utf-8");
    expect(html).not.toMatch(/<div class="declaration-pill"/);
    expect(html).not.toContain('data-story-id=');
  });
});
