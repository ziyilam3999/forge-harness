#!/usr/bin/env node
/**
 * validate-adr.mjs — schema-validate one `docs/decisions/ADR-NNNN-*.md` file.
 *
 * Implements AC-C2: exit 0 iff the file conforms to `schema/adr.schema.json`
 * (front-matter shape + four required H2 sections).
 *
 * Zero-dependency: parses just enough YAML for our pinned front-matter shape
 * (scalar string/integer fields, optional null-able integer fields). Anything
 * richer is flagged as malformed — same posture as validate-tech-spec.mjs.
 *
 * Usage:
 *   node scripts/validate-adr.mjs <path>      # validate one file
 *   node scripts/validate-adr.mjs --self-test  # smoke-check the parser
 *
 * Exit codes:
 *   0 — file valid (or self-test passed)
 *   1 — file invalid (front-matter malformed, sections missing, etc.)
 *   2 — usage error (missing arg, unreadable path)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_SECTIONS = ["Context", "Decision", "Consequences", "Alternatives considered"];
const ALLOWED_STATUSES = new Set(["Proposed", "Accepted", "Superseded", "Deprecated"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Split a Markdown file into `{frontMatter: string, body: string}`.
 * Throws if the file does not begin with a `---\n` fenced block.
 */
function splitFrontMatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    throw new Error("file must begin with a `---` YAML front-matter fence");
  }
  const normalised = text.replace(/\r\n/g, "\n");
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("front-matter fence is not closed with a trailing `---`");
  }
  return { frontMatter: match[1], body: match[2] };
}

/**
 * Minimal YAML-subset parser tuned for ADR front-matter. Top-level scalar
 * fields only (no nested maps, no lists). Values may be quoted, unquoted, or
 * the literal `null`.
 */
function parseFrontMatter(yamlText) {
  const lines = yamlText.split("\n");
  const root = {};
  for (const line of lines) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent !== 0) {
      throw new Error(`unexpected indented line at top level: "${line}"`);
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(`line missing ":" — "${line}"`);
    }
    const key = line.slice(0, colonIdx).trim();
    const valueRaw = line.slice(colonIdx + 1).trim();
    root[key] = parseScalarValue(valueRaw);
  }
  return root;
}

function parseScalarValue(raw) {
  if (raw === "" || raw === "null" || raw === "~") return null;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Try integer.
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
}

/**
 * Validate parsed front-matter against the pinned schema.
 */
function validateFrontMatterShape(fm) {
  const errors = [];
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) {
    return { ok: false, errors: ["front-matter root must be an object"] };
  }
  const required = ["adr", "status", "story", "date", "title"];
  for (const k of required) {
    if (!(k in fm)) errors.push(`missing front-matter key: ${k}`);
  }
  const allowed = new Set([...required, "supersedes", "supersededBy"]);
  for (const k of Object.keys(fm)) {
    if (!allowed.has(k)) errors.push(`unexpected front-matter key: ${k}`);
  }
  if ("adr" in fm) {
    if (typeof fm.adr !== "number" || !Number.isInteger(fm.adr) || fm.adr < 1) {
      errors.push(`adr must be a positive integer (got ${JSON.stringify(fm.adr)})`);
    }
  }
  if ("status" in fm) {
    if (!ALLOWED_STATUSES.has(fm.status)) {
      errors.push(`status must be one of ${[...ALLOWED_STATUSES].join("|")} (got "${fm.status}")`);
    }
  }
  if ("story" in fm) {
    if (typeof fm.story !== "string" || fm.story.length === 0) {
      errors.push(`story must be a non-empty string (got ${JSON.stringify(fm.story)})`);
    }
  }
  if ("date" in fm) {
    if (typeof fm.date !== "string" || !DATE_RE.test(fm.date)) {
      errors.push(`date must be ISO-8601 calendar date YYYY-MM-DD (got "${fm.date}")`);
    }
  }
  if ("title" in fm) {
    if (typeof fm.title !== "string" || fm.title.length === 0) {
      errors.push(`title must be a non-empty string (got ${JSON.stringify(fm.title)})`);
    }
  }
  if ("supersedes" in fm && fm.supersedes !== null) {
    if (typeof fm.supersedes !== "number" || !Number.isInteger(fm.supersedes) || fm.supersedes < 1) {
      errors.push(`supersedes must be null or a positive integer (got ${JSON.stringify(fm.supersedes)})`);
    }
  }
  if ("supersededBy" in fm && fm.supersededBy !== null) {
    if (typeof fm.supersededBy !== "number" || !Number.isInteger(fm.supersededBy) || fm.supersededBy < 1) {
      errors.push(`supersededBy must be null or a positive integer (got ${JSON.stringify(fm.supersededBy)})`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Scan body for `## <name>` headings and return the set of names found.
 */
function parseBodySections(body) {
  const sections = new Set();
  for (const line of body.split("\n")) {
    const m = line.match(/^## (.+?)\s*$/);
    if (m) sections.add(m[1].trim());
  }
  return sections;
}

/**
 * Top-level validation.
 */
export function validateAdr(text) {
  const errors = [];
  let fmText, body;
  try {
    ({ frontMatter: fmText, body } = splitFrontMatter(text));
  } catch (e) {
    return { ok: false, errors: [e.message] };
  }
  let fm;
  try {
    fm = parseFrontMatter(fmText);
  } catch (e) {
    return { ok: false, errors: [`front-matter parse: ${e.message}`] };
  }
  const shape = validateFrontMatterShape(fm);
  if (!shape.ok) errors.push(...shape.errors);

  const sections = parseBodySections(body);
  for (const need of REQUIRED_SECTIONS) {
    if (!sections.has(need)) {
      errors.push(`missing required section "## ${need}"`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── CLI ──────────────────────────────────────────────────────────────────

function selfTest() {
  const sample = [
    "---",
    "adr: 1",
    'status: "Accepted"',
    'story: "US-01"',
    'date: "2026-04-25"',
    'title: "Use SQLite for local cache"',
    "supersedes: null",
    "supersededBy: null",
    "---",
    "",
    "## Context",
    "",
    "Some context.",
    "",
    "## Decision",
    "",
    "Use SQLite.",
    "",
    "## Consequences",
    "",
    "Local-only persistence.",
    "",
    "## Alternatives considered",
    "",
    "- LevelDB (rejected: more deps)",
    "",
  ].join("\n");
  const r = validateAdr(sample);
  if (!r.ok) { console.error("self-test failed:", r.errors); process.exit(1); }
  console.log("self-test ok");
  process.exit(0);
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") selfTest();
if (args.length === 0) {
  console.error("usage: node scripts/validate-adr.mjs <path|--self-test>");
  process.exit(2);
}
const path = resolve(args[0]);
if (!existsSync(path)) {
  console.error(`file not found: ${path}`);
  process.exit(2);
}
const text = readFileSync(path, "utf-8");
const result = validateAdr(text);
if (result.ok) {
  console.log(`OK: ${path}`);
  process.exit(0);
}
console.error(`INVALID: ${path}`);
for (const err of result.errors) console.error(`  - ${err}`);
process.exit(1);
