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
  },
});
