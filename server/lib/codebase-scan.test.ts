import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanCodebase, SCANNER_CHAR_CAP } from "./codebase-scan.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "forge-scan-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("scanCodebase", () => {
  it("returns directory structure for a simple project", async () => {
    await mkdir(join(tempDir, "src"));
    await writeFile(join(tempDir, "src", "index.ts"), "console.log('hello');");
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test" }),
    );

    const result = await scanCodebase(tempDir);
    expect(result).toContain("Directory Structure");
    expect(result).toContain("src/");
    expect(result).toContain("package.json");
  });

  it("reads key file contents", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-project", version: "1.0.0" }),
    );

    const result = await scanCodebase(tempDir);
    expect(result).toContain("my-project");
  });

  it("extracts structured dependency info from package.json", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "2.0.0",
        dependencies: { express: "^4.18.0", zod: "^3.25.0" },
        devDependencies: { vitest: "^4.0.0" },
        scripts: { test: "vitest run", build: "tsc" },
      }),
    );

    const result = await scanCodebase(tempDir);
    expect(result).toContain("dependencies:");
    expect(result).toContain("express: ^4.18.0");
    expect(result).toContain("zod: ^3.25.0");
    expect(result).toContain("devDependencies:");
    expect(result).toContain("vitest: ^4.0.0");
    expect(result).toContain("scripts:");
    expect(result).toContain("test: vitest run");
  });

  it("skips node_modules", async () => {
    await mkdir(join(tempDir, "node_modules", "some-pkg"), { recursive: true });
    await writeFile(
      join(tempDir, "node_modules", "some-pkg", "index.js"),
      "nope",
    );

    const result = await scanCodebase(tempDir);
    expect(result).not.toContain("node_modules");
    expect(result).not.toContain("some-pkg");
  });

  it("skips .git directory", async () => {
    await mkdir(join(tempDir, ".git", "objects"), { recursive: true });

    const result = await scanCodebase(tempDir);
    expect(result).not.toContain(".git");
  });

  it("skips dist directory", async () => {
    await mkdir(join(tempDir, "dist"));
    await writeFile(join(tempDir, "dist", "bundle.js"), "compiled");

    const result = await scanCodebase(tempDir);
    expect(result).not.toContain("dist");
  });

  it("skips .claude/worktrees but keeps the rest of .claude (F-01 dogfood fix)", async () => {
    // .claude/worktrees holds stale Claude Code scratch copies of the repo.
    // Pre-fix, the walker descended into every worktree and ate ~70% of the
    // brief's codebase-context budget per the F-01 dogfood finding.
    await mkdir(join(tempDir, ".claude", "worktrees", "stale-worktree", "server"), {
      recursive: true,
    });
    await writeFile(
      join(tempDir, ".claude", "worktrees", "stale-worktree", "server", "noise.ts"),
      "// stale scratch copy",
    );
    // A real .claude/skills/ subdir should still be scanned — the prune is
    // surgical to /worktrees, not the whole .claude tree.
    await mkdir(join(tempDir, ".claude", "skills", "my-skill"), { recursive: true });
    await writeFile(
      join(tempDir, ".claude", "skills", "my-skill", "SKILL.md"),
      "# real skill",
    );

    const result = await scanCodebase(tempDir);
    expect(result).not.toContain("stale-worktree");
    expect(result).not.toContain(".claude/worktrees");
    expect(result).toContain(".claude/skills");
  });

  it("respects max depth", async () => {
    // Create deeply nested structure: d1/d2/d3/d4/d5/d6/deep.txt
    // depth 0=d1, 1=d2, 2=d3, 3=d4, 4=d5 (MAX_DEPTH=4), d6 should be excluded
    let dir = tempDir;
    for (let i = 1; i <= 6; i++) {
      dir = join(dir, `d${i}`);
      await mkdir(dir);
    }
    await writeFile(join(dir, "deep.txt"), "deep");

    const result = await scanCodebase(tempDir);
    expect(result).toContain("d5/");
    expect(result).not.toContain("d6");
  });

  it("throws for non-existent path", async () => {
    // Use an absolute path that doesn't exist on any platform
    const fakePath = join(tmpdir(), "nonexistent-forge-test-" + Date.now());
    await expect(scanCodebase(fakePath)).rejects.toThrow(
      "does not exist",
    );
  });

  it("throws for a file path (not directory)", async () => {
    const filePath = join(tempDir, "notadir.txt");
    await writeFile(filePath, "text");

    await expect(scanCodebase(filePath)).rejects.toThrow("not a directory");
  });

  it("uses forward slashes in output", async () => {
    await mkdir(join(tempDir, "src", "lib"), { recursive: true });
    await writeFile(join(tempDir, "src", "lib", "util.ts"), "export {}");

    const result = await scanCodebase(tempDir);
    // Should not contain backslashes (Windows compat)
    expect(result).not.toMatch(/\\/);
    expect(result).toContain("src/lib/");
  });

  it("truncates output at SCANNER_CHAR_CAP", async () => {
    // Create many files to exceed the cap
    await mkdir(join(tempDir, "src"));
    for (let i = 0; i < 200; i++) {
      await writeFile(
        join(tempDir, "src", `file-${String(i).padStart(3, "0")}.ts`),
        `export const x${i} = ${i};`,
      );
    }
    // Also add a large README
    await writeFile(
      join(tempDir, "README.md"),
      "# Big README\n" + "x".repeat(20000),
    );

    const result = await scanCodebase(tempDir);
    expect(result.length).toBeLessThanOrEqual(SCANNER_CHAR_CAP + "\n[truncated]".length);
    expect(result).toContain("[truncated]");
  });
});
