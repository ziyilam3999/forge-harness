/**
 * Unit tests for the activity signal writer (S8 dashboard support).
 *
 * Covers:
 *   - Happy path: file is created with JSON payload.
 *   - Null payload clears the signal to `{ "tool": null }`.
 *   - Failures are swallowed (matches writeRunRecord / AuditLog policy).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeActivity } from "./activity.js";

describe("writeActivity", () => {
  let tmpRoot: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "forge-activity-"));
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    errSpy.mockRestore();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("writes a valid Activity object to .forge/activity.json", async () => {
    await writeActivity(tmpRoot, {
      tool: "forge_generate",
      storyId: "US-03",
      stage: "critic round 2",
      startedAt: "2026-04-18T10:30:00.000Z",
      lastUpdate: "2026-04-18T10:32:15.000Z",
    });
    const raw = await readFile(join(tmpRoot, ".forge", "activity.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.tool).toBe("forge_generate");
    expect(parsed.storyId).toBe("US-03");
    expect(parsed.stage).toBe("critic round 2");
  });

  it("clears the signal to { tool: null } when given null", async () => {
    await writeActivity(tmpRoot, null);
    const raw = await readFile(join(tmpRoot, ".forge", "activity.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ tool: null });
  });

  it("swallows write failures and does not throw", async () => {
    // Point at a guaranteed-bad path (colon is invalid on Windows; on Unix
    // we fall back to a nonexistent unwritable root). Either way, the
    // writer should log + swallow.
    const bogus = process.platform === "win32"
      ? "Z:\\nonexistent\\forge-root"
      : "/proc/self/root-nonexistent-xyz";
    await expect(writeActivity(bogus, { tool: "x", stage: "y", startedAt: "a", lastUpdate: "b" })).resolves.toBeUndefined();
  });
});
