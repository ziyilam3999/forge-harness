#!/usr/bin/env node
// End-to-end test for the post-merge / post-rewrite auto-rebuild hooks
// (plan: 2026-05-10-auto-rebuild-after-ship-or-merge.md, AC-6).
//
// Materializes a temp git repo with fake server/ + dist/ + package.json,
// installs hooks via scripts/install-hooks.cjs, and exercises 3 cases:
//   (a) source-newer-than-dist  → hook rebuilds (marker.lastRebuildAt advances)
//   (b) source-older-than-dist  → hook no-ops    (marker.lastRebuildAt stays null/sticky)
//   (c) absent dist/            → hook rebuilds (marker.lastRebuildAt advances)
//
// Cross-platform: pure Node fs.utimesSync; no shell stat; npm-build is stubbed
// to a node -e that just touches dist/ files (avoids needing a real tsc setup).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const INSTALL_HOOKS = path.join(REPO_ROOT, "scripts", "install-hooks.cjs");

let testsRun = 0;
let testsFailed = 0;

function assert(cond, msg) {
  testsRun++;
  if (!cond) {
    testsFailed++;
    console.error(`  FAIL: ${msg}`);
  } else {
    console.log(`  PASS: ${msg}`);
  }
}

function setupTempProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forge-rebuild-hook-test-"));
  // Initialize git repo
  execFileSync("git", ["init", "-q", tmp], { stdio: "ignore" });
  execFileSync("git", ["-C", tmp, "config", "user.email", "test@test"], { stdio: "ignore" });
  execFileSync("git", ["-C", tmp, "config", "user.name", "test"], { stdio: "ignore" });
  // Stub package.json with a build script that just touches dist/ files
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify(
      {
        name: "rebuild-hook-fixture",
        scripts: {
          build:
            "node -e \"const fs=require('fs');const path=require('path');if(!fs.existsSync('dist')){fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.js','module.exports={};\\\\n')}function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())w(p);else if(p.endsWith('.js'))fs.utimesSync(p,Date.now()/1000,Date.now()/1000)}}w('dist')\"",
        },
      },
      null,
      2,
    ),
  );
  // Create server/ with one .ts file
  fs.mkdirSync(path.join(tmp, "server"));
  fs.writeFileSync(path.join(tmp, "server", "index.ts"), "export const x = 1;\n");
  // Install hooks by running the real installer with cwd = tmp
  // (install-hooks.cjs walks up from __dirname to find .git, so we copy it in)
  fs.mkdirSync(path.join(tmp, "scripts"));
  fs.copyFileSync(INSTALL_HOOKS, path.join(tmp, "scripts", "install-hooks.cjs"));
  execFileSync("node", [path.join(tmp, "scripts", "install-hooks.cjs")], {
    cwd: tmp,
    stdio: "ignore",
  });
  return tmp;
}

function staleAge() {
  return (Date.now() - 24 * 60 * 60 * 1000) / 1000; // 1 day ago, in seconds
}
function freshAge() {
  return Date.now() / 1000;
}

function cleanup(tmp) {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // best-effort; tmp dirs are gitignored noise either way
  }
}

function readMarker(tmp) {
  const p = path.join(tmp, ".git", ".forge-rebuild-hook-marker");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { __corrupt: true };
  }
}

function fireHook(tmp, name = "post-merge") {
  const hook = path.join(tmp, ".git", "hooks", name);
  const result = spawnSync(hook, [], { cwd: tmp, encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

// --- CASE A: source newer than dist/ → hook rebuilds ---
console.log("\n[CASE A] source-newer-than-dist → hook rebuilds");
{
  const tmp = setupTempProject();
  // Create dist/ with one fresh .js, then make it stale
  fs.mkdirSync(path.join(tmp, "dist"));
  fs.writeFileSync(path.join(tmp, "dist", "index.js"), "module.exports = {};\n");
  fs.utimesSync(path.join(tmp, "dist", "index.js"), staleAge(), staleAge());
  // Source mtime = now (fresher than dist/)
  fs.utimesSync(path.join(tmp, "server", "index.ts"), freshAge(), freshAge());

  const preDistMtime = fs.statSync(path.join(tmp, "dist", "index.js")).mtimeMs;
  const result = fireHook(tmp);
  const postDistMtime = fs.statSync(path.join(tmp, "dist", "index.js")).mtimeMs;
  const marker = readMarker(tmp);

  assert(result.status === 0, `[A] hook exited 0 (got ${result.status})`);
  assert(postDistMtime > preDistMtime, `[A] dist/index.js mtime advanced (${preDistMtime} → ${postDistMtime})`);
  assert(marker !== null && !marker.__corrupt, `[A] marker exists + parseable`);
  assert(marker && typeof marker.lastRunAt === "number", `[A] marker.lastRunAt is a number`);
  assert(marker && typeof marker.lastRebuildAt === "number", `[A] marker.lastRebuildAt is a number (rebuild fired)`);
  assert(marker && marker.trigger === "post-merge", `[A] marker.trigger === "post-merge"`);
  cleanup(tmp);
}

// --- CASE B: source older than dist/ → hook no-ops, lastRebuildAt stays null ---
console.log("\n[CASE B] source-older-than-dist → hook no-ops");
{
  const tmp = setupTempProject();
  // dist/ fresh (= now), source stale (= 1 day ago)
  fs.mkdirSync(path.join(tmp, "dist"));
  fs.writeFileSync(path.join(tmp, "dist", "index.js"), "module.exports = {};\n");
  fs.utimesSync(path.join(tmp, "dist", "index.js"), freshAge(), freshAge());
  fs.utimesSync(path.join(tmp, "server", "index.ts"), staleAge(), staleAge());

  const preDistMtime = fs.statSync(path.join(tmp, "dist", "index.js")).mtimeMs;
  const result = fireHook(tmp);
  const postDistMtime = fs.statSync(path.join(tmp, "dist", "index.js")).mtimeMs;
  const marker = readMarker(tmp);

  assert(result.status === 0, `[B] hook exited 0 (got ${result.status})`);
  assert(postDistMtime === preDistMtime, `[B] dist/index.js mtime unchanged (${preDistMtime} === ${postDistMtime})`);
  assert(marker !== null && !marker.__corrupt, `[B] marker exists + parseable`);
  assert(marker && typeof marker.lastRunAt === "number", `[B] marker.lastRunAt is a number`);
  assert(marker && marker.lastRebuildAt === null, `[B] marker.lastRebuildAt is null (no rebuild fired; got ${marker?.lastRebuildAt})`);
  cleanup(tmp);
}

// --- CASE C: absent dist/ → hook rebuilds ---
console.log("\n[CASE C] absent-dist → hook rebuilds");
{
  const tmp = setupTempProject();
  // No dist/ at all; source exists
  fs.utimesSync(path.join(tmp, "server", "index.ts"), freshAge(), freshAge());

  const result = fireHook(tmp);
  const marker = readMarker(tmp);

  assert(result.status === 0, `[C] hook exited 0 (got ${result.status})`);
  assert(marker !== null && !marker.__corrupt, `[C] marker exists + parseable`);
  assert(marker && typeof marker.lastRunAt === "number", `[C] marker.lastRunAt is a number`);
  assert(
    marker && typeof marker.lastRebuildAt === "number",
    `[C] marker.lastRebuildAt is a number (rebuild fired due to absent dist/)`,
  );
  // Now that the stub `build` script CREATES dist/index.js when absent, we can
  // assert the rebuild produced output (tightens CASE C from "build ran" to
  // "build produced output" per T4 reviewer's CC#5 finding).
  assert(
    fs.existsSync(path.join(tmp, "dist", "index.js")),
    `[C] dist/index.js exists post-hook (rebuild produced output, not just exited 0)`,
  );
  cleanup(tmp);
}

console.log(`\n--- Summary ---`);
console.log(`Tests run: ${testsRun}`);
console.log(`Tests failed: ${testsFailed}`);
process.exit(testsFailed === 0 ? 0 : 1);
