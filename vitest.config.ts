import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts"],
    // Fixtures are pinned snapshots from external repos and contain *.test.ts
    // files that import paths only valid in their original projects. Exclude
    // the entire __fixtures__/ subtree from test discovery — they're loaded
    // explicitly by other tests as raw source rather than executed directly.
    exclude: ["**/__fixtures__/**", "node_modules/**", "dist/**"],
    passWithNoTests: true,
    // #911 — several end-to-end tests shell out to real `git` (init/config/add/
    // commit/push to a bare remote, then renderDashboard which scans git too):
    // dashboard-renderer-reconciliation, evaluate-gitsha, git-master-stories,
    // smoke-gate-check. On Linux these finish in <1s, but on the windows-latest
    // runner git subprocess spawn latency is much higher AND variable, so the
    // cumulative time occasionally crept past vitest's 5000ms default and the
    // test was killed mid-flight (observed: AC-7 at 6236ms) — a non-deterministic
    // Windows-only timeout flake, not a logic failure. Give every test generous
    // headroom (and the same for the git-shelling beforeEach/afterEach hooks) so
    // a slow-but-correct Windows git path can't time out. A genuinely hung test
    // still fails — just after 30s instead of 5s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
