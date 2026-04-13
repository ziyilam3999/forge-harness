#!/usr/bin/env node
/**
 * Q0.5/A1c — advisory ac-lint driver for the `.github/workflows/ac-lint.yml`
 * CI workflow.
 *
 * Globs every `.ai-workspace/plans/*.json`, runs `lintPlan` against each,
 * prints a markdown summary to stdout, and always exits 0 (advisory mode).
 *
 * The binding merge gate for plan-file lint violations is Q0.5/C1's
 * retroactive-critique workflow; this script is observability-only.
 *
 * Usage:
 *   npm run build              # produces dist/
 *   node scripts/run-ac-lint.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Import the built module from dist/ so we don't need tsx at runtime.
const lintModulePath = join(repoRoot, "dist", "validation", "ac-lint.js");
if (!existsSync(lintModulePath)) {
  console.error(
    `ac-lint: cannot find ${lintModulePath}. Run \`npm run build\` first.`,
  );
  // Advisory mode: exit 0 so CI doesn't fail.
  process.exit(0);
}
const { lintPlan } = await import(pathToFileURL(lintModulePath).href);

const plansDir = join(repoRoot, ".ai-workspace", "plans");
if (!existsSync(plansDir)) {
  console.log("# ac-lint advisory report");
  console.log("");
  console.log("No `.ai-workspace/plans/` directory found. Nothing to lint.");
  process.exit(0);
}

const jsonFiles = readdirSync(plansDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const lines = [];
lines.push("# ac-lint advisory report");
lines.push("");
lines.push(
  "Advisory-only (Q0.5/A1c). The binding merge gate is Q0.5/C1's retroactive-critique workflow.",
);
lines.push("");

let totalFindings = 0;
let totalSuspectAcs = 0;
let totalGovViolations = 0;
let filesScanned = 0;
let filesWithFindings = 0;

for (const file of jsonFiles) {
  const fullPath = join(plansDir, file);
  let raw;
  try {
    raw = JSON.parse(readFileSync(fullPath, "utf8"));
  } catch {
    // Not a valid JSON plan file — skip silently (e.g. config files).
    continue;
  }
  if (!raw || !Array.isArray(raw.stories)) continue;
  filesScanned += 1;

  const report = lintPlan(raw);
  if (report.findings.length === 0 && !report.governanceViolation) continue;

  filesWithFindings += 1;
  totalFindings += report.findings.length;
  totalSuspectAcs += report.suspectAcIds.length;
  if (report.governanceViolation) totalGovViolations += 1;

  lines.push(`## \`${file}\``);
  lines.push("");
  lines.push(
    `- Suspect ACs: **${report.suspectAcIds.length}** (${report.suspectAcIds.join(", ") || "none"})`,
  );
  lines.push(
    `- lintExempt entries: ${report.lintExemptCount}${
      report.governanceViolation ? " — **governance cap exceeded (>3)**" : ""
    }`,
  );
  lines.push("");
  lines.push("| Story | AC | Rule | Exempt |");
  lines.push("|---|---|---|---|");
  for (const f of report.findings) {
    lines.push(
      `| ${f.storyId} | ${f.acId} | \`${f.ruleId}\` | ${f.exempt ? "yes" : "no"} |`,
    );
  }
  lines.push("");
}

const header = [
  "# ac-lint advisory report",
  "",
  `**Summary:** ${filesScanned} plan file(s) scanned, ${filesWithFindings} with findings, ${totalFindings} total findings, ${totalSuspectAcs} suspect AC(s), ${totalGovViolations} governance violation(s).`,
  "",
];
// Drop the old duplicated header prefix at the top of `lines`.
const body = lines.slice(4);
console.log(header.concat(body).join("\n"));
// Always exit 0 — advisory mode.
process.exit(0);
