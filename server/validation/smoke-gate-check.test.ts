import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Q0.5/B1 — Bootstrap detection tests for `scripts/smoke-gate-check.sh`.
 *
 * Tests 15 and 16 from the B1 plan. Creates a throwaway git repo in a
 * tmpdir, seeds it with controlled revisions of `server/tools/evaluate.ts`
 * (with or without `handleSmokeTest`), then shells the smoke-gate script
 * against that repo. `origin/master` is simulated via a local bare repo.
 *
 * Runs only on platforms where bash is available. Skipped silently on
 * Windows without Git Bash rather than failing — the real CI runs on
 * ubuntu-latest where bash is always present.
 */

const SCRIPT_PATH = resolve(
  fileURLToPath(new URL("../../scripts/smoke-gate-check.sh", import.meta.url)),
);

function hasBash(): boolean {
  try {
    if (process.platform === "win32") {
      // Prefer the same resolver the executor uses — if Git Bash is
      // installed, `where bash` will find it.
      execSync("where bash", { stdio: "ignore" });
      return true;
    }
    execSync("which bash", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function initFixtureRepo(withHandleSmokeTestOnMaster: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "smoke-gate-test-"));
  const bare = join(root, "origin.git");
  const work = join(root, "work");

  // Create a bare "remote" repo so the work-tree can have origin/master.
  execSync(`git init --bare --initial-branch=master "${bare}"`, { stdio: "ignore" });
  execSync(`git clone "${bare}" "${work}"`, { stdio: "ignore" });

  // Seed evaluate.ts on master
  mkdirSync(join(work, "server", "tools"), { recursive: true });
  const masterContent = withHandleSmokeTestOnMaster
    ? "export function handleStoryEval() {}\nexport async function handleSmokeTest() {}\n"
    : "export function handleStoryEval() {}\n";
  writeFileSync(join(work, "server", "tools", "evaluate.ts"), masterContent);

  execSync(`git -C "${work}" config user.email test@test`, { stdio: "ignore" });
  execSync(`git -C "${work}" config user.name test`, { stdio: "ignore" });
  execSync(`git -C "${work}" add -A`, { stdio: "ignore" });
  execSync(`git -C "${work}" commit -m "seed master"`, { stdio: "ignore" });
  execSync(`git -C "${work}" push origin master`, { stdio: "ignore" });

  // On a branch, simulate a landing PR. Always add a marker file so the
  // branch has at least one new file — otherwise, when master already has
  // handleSmokeTest (test 16), there would be nothing to commit and `git
  // commit` would error with "nothing to commit, working tree clean".
  execSync(`git -C "${work}" checkout -b feat/b1`, { stdio: "ignore" });
  writeFileSync(
    join(work, "server", "tools", "evaluate.ts"),
    "export function handleStoryEval() {}\nexport async function handleSmokeTest() {}\n",
  );
  writeFileSync(join(work, ".branch-marker"), `branch: feat/b1\n`);
  execSync(`git -C "${work}" add -A`, { stdio: "ignore" });
  execSync(`git -C "${work}" commit -m "add handleSmokeTest"`, { stdio: "ignore" });

  return work;
}

describe("smoke-gate-check.sh / bootstrap detection", () => {
  const bashAvailable = hasBash();

  // Test 15 — bootstrap exempt: handleSmokeTest absent on master, present on HEAD
  it.skipIf(!bashAvailable)(
    "emits `smoke-gate: bootstrap-exempt` when handleSmokeTest is absent on master",
    () => {
      const work = initFixtureRepo(false);
      try {
        const stdout = execSync(`bash "${SCRIPT_PATH}"`, {
          cwd: work,
          encoding: "utf-8",
        });
        expect(stdout).toContain("smoke-gate: bootstrap-exempt");
        expect(stdout).not.toContain("smoke-gate: active");
      } finally {
        rmSync(work.replace(/\\work$/, ""), { recursive: true, force: true });
      }
    },
    15_000,
  );

  // Bootstrap sanity check (ship-fix-1): the regex MUST match the real
  // function signature in the real evaluate.ts file on disk. If a future
  // refactor changes `export async function handleSmokeTest` to `export
  // const handleSmokeTest = async` or similar, this test fails loudly
  // instead of silently flipping CI to `smoke-gate: active`.
  //
  // This test exists because the initial B1 landing PR (ship-fix-1 round)
  // had a regex that matched only `export function ...` (no `async`), so
  // the real async handler was missed and CI emitted the wrong signal.
  // Tests 15-16 passed locally because their synthetic fixtures also
  // lacked `async` — producer/consumer seam bug (P57-class).
  it("regex matches the real handleSmokeTest signature on disk", () => {
    const evalPath = resolve(
      fileURLToPath(new URL("../tools/evaluate.ts", import.meta.url)),
    );
    const source = readFileSync(evalPath, "utf-8");
    // Same pattern the bash script uses (BRE with escaped optional group).
    // JavaScript regex equivalent: `^export (?:async )?function handleSmokeTest\b`
    // with multiline flag.
    const realFnRegex = /^export (?:async )?function handleSmokeTest\b/m;
    expect(realFnRegex.test(source)).toBe(true);
  });

  // Test 16 — active: handleSmokeTest already on master
  it.skipIf(!bashAvailable)(
    "emits `smoke-gate: active` when handleSmokeTest is already present on master",
    () => {
      const work = initFixtureRepo(true);
      try {
        const stdout = execSync(`bash "${SCRIPT_PATH}"`, {
          cwd: work,
          encoding: "utf-8",
        });
        expect(stdout).toContain("smoke-gate: active");
        expect(stdout).not.toContain("smoke-gate: bootstrap-exempt");
      } finally {
        rmSync(work.replace(/\\work$/, ""), { recursive: true, force: true });
      }
    },
    15_000,
  );
});
