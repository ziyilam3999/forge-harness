#!/usr/bin/env node
/**
 * forge-adr-backfill.mjs — re-run the ADR extractor against historical PASS
 * run records to recover missing INDEX.md rows.
 *
 * Why: pre-v0.39.6 the extractor's stub-front-matter parser threw on YAML
 * `|` literal block scalars (the natural form for multi-line ADR fields).
 * The throw was silently swallowed by evaluate.ts, leaving INDEX.md without
 * a row for any story whose PASS staged a multi-line stub. Consumers (e.g.
 * monday-bot) need a way to recover without hand-editing INDEX.md.
 *
 * Mechanism: scan `<project>/.forge/runs/forge_evaluate-*.json` for PASS
 * records, deduplicate by storyId, and call `processStory` from the built
 * `dist/lib/adr-extractor.js` once per storyId. processStory rebuilds
 * INDEX.md deterministically from disk on every call, so re-running on an
 * already-current project is a byte-stable no-op (idempotency comes free).
 *
 * Reuses processStory rather than reimplementing — same canonicalisation
 * rules, same numbering, same INDEX shape.
 *
 * Usage:
 *   node scripts/forge-adr-backfill.mjs --project <path>
 *   node scripts/forge-adr-backfill.mjs --help
 *
 * Exit codes:
 *   0 — success (including no-op)
 *   1 — input or runtime error (missing project, build missing, malformed record)
 *   2 — usage error (missing/unknown flag)
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HELP = `forge-adr-backfill — re-run the ADR extractor against historical PASS records.

Usage:
  node scripts/forge-adr-backfill.mjs --project <path>
  node scripts/forge-adr-backfill.mjs --help

What it scans:
  <project>/.forge/runs/forge_evaluate-*.json
    PASS records with a 'storyId' field. One processStory call per unique storyId.

What it writes:
  <project>/docs/decisions/ADR-NNNN-*.md
    For each storyId with remaining stubs at .forge/staging/adr/<storyId>/,
    canonicalises them to numbered ADR files. (If staging was already cleared
    by an earlier successful run, no new ADR files are written for that story.)
  <project>/docs/decisions/INDEX.md
    Rebuilt deterministically on every call from the on-disk ADR set.
    Stories with no stubs and no existing ADR get a 'no new decisions' row.

Idempotency:
  Re-running on an already-current project is a no-op (INDEX.md byte-stable).

Prerequisite:
  The forge-harness build must be current: run \`npm run build\` in the
  forge-harness repo before invoking this CLI. The CLI imports processStory
  from dist/lib/adr-extractor.js.

Exit codes:
  0  success (including no-op)
  1  input or runtime error (missing project path, build missing, malformed record)
  2  usage error (missing required flag, unknown flag)
`;

function parseArgs(argv) {
  let project = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--project") {
      project = argv[++i];
      if (!project || project.startsWith("--")) {
        return { error: "Missing value for --project" };
      }
      continue;
    }
    return { error: `Unknown argument: ${a}` };
  }
  return { project };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (args.error) {
    process.stderr.write(`forge-adr-backfill: ${args.error}\n`);
    process.stderr.write("Run with --help for usage.\n");
    process.exit(2);
  }
  if (!args.project) {
    process.stderr.write("forge-adr-backfill: missing required argument --project <path>\n");
    process.stderr.write("Run with --help for usage.\n");
    process.exit(2);
  }

  const projectPath = resolve(args.project);
  if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    process.stderr.write(
      `forge-adr-backfill: project path does not exist or is not a directory: ${projectPath}\n`,
    );
    process.exit(1);
  }

  // Load processStory from the built dist (sibling of this scripts/ dir).
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(scriptPath), "..");
  const adrExtractorPath = join(repoRoot, "dist", "lib", "adr-extractor.js");
  if (!existsSync(adrExtractorPath)) {
    process.stderr.write(
      `forge-adr-backfill: adr-extractor module not found at ${adrExtractorPath}\n`,
    );
    process.stderr.write("Run `npm run build` in the forge-harness repo first.\n");
    process.exit(1);
  }
  const { processStory } = await import(pathToFileURL(adrExtractorPath).href);

  // Scan run records for PASS storyIds.
  const runsDir = join(projectPath, ".forge", "runs");
  const storyIds = new Set();
  if (existsSync(runsDir)) {
    for (const name of readdirSync(runsDir)) {
      if (!name.startsWith("forge_evaluate-") || !name.endsWith(".json")) continue;
      let rec;
      try {
        rec = JSON.parse(readFileSync(join(runsDir, name), "utf-8"));
      } catch (err) {
        process.stderr.write(
          `forge-adr-backfill: skipping malformed run record ${name}: ${err.message}\n`,
        );
        continue;
      }
      const verdict = rec.evalVerdict ?? rec.verdict;
      if (verdict !== "PASS") continue;
      if (typeof rec.storyId !== "string" || rec.storyId === "") continue;
      storyIds.add(rec.storyId);
    }
  }

  if (storyIds.size === 0) {
    process.stdout.write("forge-adr-backfill: no PASS run records found. Nothing to backfill.\n");
    process.exit(0);
  }

  const sorted = [...storyIds].sort();
  process.stdout.write(
    `forge-adr-backfill: ${sorted.length} stor${sorted.length === 1 ? "y" : "ies"} to process: ${sorted.join(", ")}\n`,
  );

  let newAdrCount = 0;
  let noDecisionsAddedCount = 0;
  for (const storyId of sorted) {
    let result;
    try {
      result = processStory({ projectPath, storyId });
    } catch (err) {
      process.stderr.write(
        `forge-adr-backfill: ${storyId} failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
    newAdrCount += result.newAdrPaths.length;
    if (result.appendedNoDecisionsRow) noDecisionsAddedCount++;
    if (result.newAdrPaths.length > 0) {
      process.stdout.write(
        `  ${storyId}: created ${result.newAdrPaths.length} ADR file(s)\n`,
      );
    } else if (result.appendedNoDecisionsRow) {
      process.stdout.write(`  ${storyId}: added no-decisions row\n`);
    } else {
      process.stdout.write(`  ${storyId}: no change\n`);
    }
  }
  process.stdout.write(
    `forge-adr-backfill: done. ${newAdrCount} ADR file(s) created, ${noDecisionsAddedCount} no-decisions row(s) added.\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    `forge-adr-backfill: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
