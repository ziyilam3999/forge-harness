#!/usr/bin/env node
/**
 * spec-contract-coverage.mjs — verify that a story section in
 * `docs/generated/TECHNICAL-SPEC.md` lists every API contract that the
 * story's RunRecord declares were touched.
 *
 * Implements AC-B4: `coverage: 1.0` iff every contract id in the source list
 * appears under that story's `### api-contracts` subsection.
 *
 * Source of truth for "contracts touched" (in priority order):
 *   1. `--contracts <comma-list>` flag (used by tests + the wrapper)
 *   2. `RunRecord.generatedDocs.contracts[]` from the most-recent `.forge/runs/`
 *      record for that story (when running against a real .forge tree)
 *   3. (fallback) inferred from the spec section itself, which trivially yields
 *      coverage 1.0 — only useful when neither source is present, and we mark
 *      the run with `inferred: true`.
 *
 * Usage:
 *   node scripts/spec-contract-coverage.mjs --story US-01 [--spec PATH] \
 *        [--contracts forge_evaluate,forge_generate]
 *
 * Output (stdout): single-line JSON `{"story":"US-01","coverage":1.0,...}`.
 * Exit codes: 0 = coverage 1.0, 1 = coverage < 1.0 or invalid.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
function getFlag(name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1];
}

const storyId = getFlag("--story", null);
const specPathRaw = getFlag("--spec", "docs/generated/TECHNICAL-SPEC.md");
const contractsFlag = getFlag("--contracts", null);
const projectRoot = getFlag("--project", process.cwd());

if (!storyId) {
  console.error("usage: spec-contract-coverage.mjs --story <id> [--spec <path>] [--contracts a,b,c] [--project <dir>]");
  process.exit(2);
}

// Resolve --spec independent of --project so callers can pass either an
// absolute path OR a project-relative path; --project is only used for the
// RunRecord scan. resolve(cwd, x) treats absolute x as-is and project-relative
// x as cwd-relative — which is the desired behavior when --spec is supplied.
const specPath = resolve(specPathRaw);
if (!existsSync(specPath)) {
  console.error(`spec file not found: ${specPath}`);
  process.exit(2);
}

// ── Source: --contracts flag ────────────────────────────────────────────
let declaredContracts = null;
let source = "fallback-inferred";
if (contractsFlag !== null && contractsFlag !== "") {
  declaredContracts = contractsFlag.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  source = "flag";
}

// ── Source: latest RunRecord under .forge/runs/ ─────────────────────────
if (!declaredContracts) {
  const runsDir = join(projectRoot, ".forge", "runs");
  if (existsSync(runsDir)) {
    const candidates = readdirSync(runsDir)
      .filter((f) => f.startsWith("forge_evaluate-") && f.endsWith(".json"))
      .map((f) => ({ f, full: join(runsDir, f), mtime: statSync(join(runsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const c of candidates) {
      try {
        const rec = JSON.parse(readFileSync(c.full, "utf-8"));
        if (rec.storyId === storyId && rec.evalVerdict === "PASS" && rec.generatedDocs?.contracts) {
          declaredContracts = rec.generatedDocs.contracts;
          source = "runRecord";
          break;
        }
      } catch { /* ignore malformed records */ }
    }
  }
}

// ── Spec section parse ──────────────────────────────────────────────────
const specText = readFileSync(specPath, "utf-8");

/**
 * Find the body block for `## story: <storyId>` by walking lines: start
 * accumulating after the matching heading, stop at the next `## ` heading
 * or EOF. Avoids JS-RegExp limitations (no `\Z`, lookbehind quirks).
 */
function extractStorySection(text, id) {
  const lines = text.split(/\r?\n/);
  let inSection = false;
  const acc = [];
  for (const line of lines) {
    const m = line.match(/^## story: (\S.*)$/);
    if (m) {
      if (m[1].trim() === id) { inSection = true; acc.push(line); continue; }
      if (inSection) break;
      continue;
    }
    if (line.startsWith("## ") && inSection) break;
    if (inSection) acc.push(line);
  }
  return inSection ? acc.join("\n") : null;
}

const section = extractStorySection(specText, storyId);
if (section === null) {
  console.error(`spec has no "## story: ${storyId}" section`);
  console.log(JSON.stringify({ story: storyId, coverage: 0.0, reason: "section-missing", source }));
  process.exit(1);
}

/** Pull the `### api-contracts` subsection lines out of a story section. */
function extractApiContractsBody(sectionText) {
  const lines = sectionText.split("\n");
  let inSub = false;
  const acc = [];
  for (const line of lines) {
    if (/^### api-contracts\s*$/.test(line)) { inSub = true; continue; }
    if (inSub && /^### /.test(line)) break;
    if (inSub) acc.push(line);
  }
  return acc.join("\n");
}
const apiBody = extractApiContractsBody(section);

const listed = new Set();
for (const line of apiBody.split("\n")) {
  const m = line.match(/^[-*]\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/);
  if (m) listed.add(m[1]);
}

// ── Fallback: declaredContracts derived from listed set ─────────────────
if (!declaredContracts) {
  declaredContracts = Array.from(listed);
  source = "fallback-inferred";
}

const declaredSet = new Set(declaredContracts);
const missing = [...declaredSet].filter((c) => !listed.has(c));
const coverage = declaredSet.size === 0 ? 1.0 : (declaredSet.size - missing.length) / declaredSet.size;

const out = { story: storyId, coverage, declared: [...declaredSet], listed: [...listed], missing, source };
console.log(JSON.stringify(out));
process.exit(coverage >= 1.0 ? 0 : 1);
