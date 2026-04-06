import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditLog } from "./audit.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "forge-audit-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("AuditLog", () => {
  it("writes audit entries to .forge/audit/ as JSONL", async () => {
    const audit = new AuditLog("forge_plan", tempDir);
    await audit.log({
      stage: "planner",
      agentRole: "planner",
      decision: "generated_plan",
      reasoning: "Used feature mode",
    });

    const auditDir = join(tempDir, ".forge", "audit");
    const files = await readdir(auditDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^forge_plan-.*\.jsonl$/);

    const content = await readFile(join(auditDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.stage).toBe("planner");
    expect(entry.agentRole).toBe("planner");
    expect(entry.decision).toBe("generated_plan");
    expect(entry.timestamp).toBeDefined();
  });

  it("appends multiple entries to the same file", async () => {
    const audit = new AuditLog("forge_plan", tempDir);
    await audit.log({
      stage: "planner",
      agentRole: "planner",
      decision: "generated_plan",
      reasoning: "Draft",
    });
    await audit.log({
      stage: "critic",
      agentRole: "critic",
      decision: "reviewed_plan",
      reasoning: "Found 3 issues",
    });

    const auditDir = join(tempDir, ".forge", "audit");
    const files = await readdir(auditDir);
    expect(files).toHaveLength(1);

    const content = await readFile(join(auditDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("uses Windows-safe filenames (no colons)", async () => {
    const audit = new AuditLog("forge_plan", tempDir);
    await audit.log({
      stage: "test",
      agentRole: "test",
      decision: "test",
      reasoning: "test",
    });

    const auditDir = join(tempDir, ".forge", "audit");
    const files = await readdir(auditDir);
    expect(files[0]).not.toContain(":");
  });

  it("does not crash when projectPath is not provided", async () => {
    const audit = new AuditLog("forge_plan");
    // Should not throw
    await audit.log({
      stage: "test",
      agentRole: "test",
      decision: "test",
      reasoning: "test",
    });
    expect(audit.getFilePath()).toBeNull();
  });

  it("does not crash when write fails", async () => {
    const audit = new AuditLog("forge_plan", "/nonexistent/path/xyz");
    // Should not throw — logs warning and continues
    await expect(
      audit.log({
        stage: "test",
        agentRole: "test",
        decision: "test",
        reasoning: "test",
      }),
    ).resolves.toBeUndefined();
  });

  it("returns file path after initialization", async () => {
    const audit = new AuditLog("forge_plan", tempDir);
    await audit.log({
      stage: "test",
      agentRole: "test",
      decision: "test",
      reasoning: "test",
    });

    const filePath = audit.getFilePath();
    expect(filePath).not.toBeNull();
    expect(filePath).toContain("forge_plan");
    expect(filePath).toContain(".jsonl");
  });
});
