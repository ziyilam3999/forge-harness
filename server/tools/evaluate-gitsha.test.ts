/**
 * v0.35.1 AC-2 — forge_evaluate captures gitSha on PASS.
 *
 * End-to-end-ish test: sets up a real git working tree in a temp dir,
 * seeds an executable acceptance criterion that passes, invokes
 * `handleEvaluate({ evaluationMode: "story", ... })`, then reads the
 * written RunRecord JSON and asserts `gitSha` is a 40-char hex string
 * matching `git rev-parse HEAD` in that tree.
 *
 * The test does NOT mock run-record / anthropic / evaluator — it
 * exercises the full write path so the gitSha is captured by the real
 * production code in `handleStoryEval`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// v0.36.0 Phase B — spec-generator runs synchronously inside `handleStoryEval`
// on PASS and would otherwise reach for the real Anthropic API in this
// integration-style test (which has no mock for the SDK). Stub it with a
// no-op deterministic synth so the gitSha capture path stays focused.
vi.mock("../lib/spec-generator.js", () => ({
  generateSpecForStory: vi.fn(async (input: { projectPath: string; storyId: string }) => ({
    specPath: `${input.projectPath}/docs/generated/TECHNICAL-SPEC.md`,
    genTimestamp: "2026-04-25T00:00:00.000Z",
    genTokens: { inputTokens: 0, outputTokens: 0 },
    contracts: [],
    bodyChanged: true,
  })),
}));

import { handleEvaluate } from "./evaluate.js";

async function initGitRepo(cwd: string): Promise<string> {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "test"], { cwd });
  // Allow commits on a minimal file so HEAD exists.
  await writeFile(join(cwd, "README.md"), "# test\n");
  execFileSync("git", ["add", "README.md"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" }).trim();
}

async function writePlan(projectPath: string): Promise<string> {
  // A story with one AC whose `command` just `echo`s — passes on any shell.
  const plan = {
    schemaVersion: "3.0.0",
    stories: [
      {
        id: "US-01",
        title: "Test story",
        acceptanceCriteria: [
          {
            id: "US-01-AC01",
            description: "echo succeeds",
            command: "echo ok",
          },
        ],
      },
    ],
  };
  const planPath = join(projectPath, "plan.json");
  await writeFile(planPath, JSON.stringify(plan), "utf-8");
  return planPath;
}

describe("AC-2 — evaluate writes git HEAD sha on PASS", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "forge-eval-gitsha-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("forge_evaluate captures gitSha on PASS — 40-char hex matches git rev-parse HEAD", async () => {
    // Arrange: init a git repo at tmpRoot with one commit; capture HEAD.
    const expectedSha = await initGitRepo(tmpRoot);
    expect(expectedSha).toMatch(/^[0-9a-f]{40}$/);

    // Write a plan file in the same repo.
    const planPath = await writePlan(tmpRoot);

    // Act: run forge_evaluate in story mode.
    await mkdir(join(tmpRoot, ".forge", "runs"), { recursive: true });
    const response = await handleEvaluate({
      evaluationMode: "story",
      storyId: "US-01",
      planPath,
      projectPath: tmpRoot,
    });
    expect(response.isError).not.toBe(true);

    // Assert: read the freshly-written RunRecord and check gitSha.
    const runsDir = join(tmpRoot, ".forge", "runs");
    const files = (await readdir(runsDir)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const recordContent = await readFile(join(runsDir, files[0]), "utf-8");
    const record = JSON.parse(recordContent) as {
      gitSha?: string;
      evalVerdict?: string;
    };
    expect(record.evalVerdict).toBe("PASS");
    expect(record.gitSha).toBeDefined();
    expect(record.gitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(record.gitSha).toBe(expectedSha);
  });

  it("forge_evaluate omits gitSha when cwd is not a git repo", async () => {
    // No `git init` — handleStoryEval must capture undefined and omit the
    // field rather than writing `null` or throwing.
    const planPath = await writePlan(tmpRoot);
    await mkdir(join(tmpRoot, ".forge", "runs"), { recursive: true });

    const response = await handleEvaluate({
      evaluationMode: "story",
      storyId: "US-01",
      planPath,
      projectPath: tmpRoot,
    });
    expect(response.isError).not.toBe(true);

    const runsDir = join(tmpRoot, ".forge", "runs");
    const files = (await readdir(runsDir)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const record = JSON.parse(
      await readFile(join(runsDir, files[0]), "utf-8"),
    ) as { gitSha?: string };
    expect(record.gitSha).toBeUndefined();
  });
});
