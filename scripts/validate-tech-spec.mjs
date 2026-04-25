#!/usr/bin/env node
/**
 * validate-tech-spec.mjs — schema-validate `docs/generated/TECHNICAL-SPEC.md`.
 *
 * Implements AC-B3: exit 0 iff the file conforms to
 * `schema/technical-spec.schema.json` (front-matter shape + required body
 * subsections per story).
 *
 * Zero-dependency: parses just enough YAML for our pinned front-matter shape
 * (scalar string fields + a `stories:` list of objects with three scalar
 * fields each). Anything richer is flagged as malformed.
 *
 * Usage:
 *   node scripts/validate-tech-spec.mjs <path>      # validate one file
 *   node scripts/validate-tech-spec.mjs --self-test  # smoke-check the parser
 *
 * Exit codes:
 *   0 — file valid (or self-test passed)
 *   1 — file invalid (front-matter malformed, sections missing, etc.)
 *   2 — usage error (missing arg, unreadable path)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_SECTIONS = ["api-contracts", "data-models", "invariants", "test-surface"];
const SCHEMA_VERSION = "1.0.0";
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SHA_OR_UNKNOWN_RE = /^([0-9a-f]{40}|unknown)$/;

/**
 * Split a Markdown file into `{frontMatter: string, body: string}`.
 * Throws if the file does not begin with a `---\n` fenced block.
 */
function splitFrontMatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    throw new Error("file must begin with a `---` YAML front-matter fence");
  }
  // Normalise CRLF → LF for the split, then operate on LF-only text.
  const normalised = text.replace(/\r\n/g, "\n");
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("front-matter fence is not closed with a trailing `---`");
  }
  return { frontMatter: match[1], body: match[2] };
}

/**
 * Minimal YAML subset parser tuned for our pinned front-matter shape:
 *
 *   schemaVersion: "1.0.0"
 *   lastUpdated: "2026-04-25T..."
 *   stories:
 *     - id: "US-01"
 *       lastUpdated: "..."
 *       lastGitSha: "abc..."
 *
 * Anything richer (nested maps under stories items, multi-line scalars,
 * anchors/aliases) is rejected. This is deliberate: simpler grammar = simpler
 * audit surface = fewer ways to smuggle non-conforming content.
 */
function parseFrontMatter(yamlText) {
  const lines = yamlText.split("\n");
  const root = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) { i++; continue; }
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
    if (key === "stories") {
      if (valueRaw !== "" && valueRaw !== "[]") {
        throw new Error(`stories: expected list (newline-then-"-" entries) or "[]" empty list, got "${valueRaw}"`);
      }
      if (valueRaw === "[]") { root.stories = []; i++; continue; }
      const items = [];
      i++;
      while (i < lines.length) {
        const subLine = lines[i];
        if (subLine.trim() === "") { i++; continue; }
        const subIndent = subLine.length - subLine.trimStart().length;
        if (subIndent === 0) break; // back to top level
        // Each item begins with `  - key: value`.
        const itemMarker = subLine.match(/^(\s+)-\s+(.+)$/);
        if (!itemMarker) {
          throw new Error(`expected list item under "stories:", got "${subLine}"`);
        }
        const itemIndent = itemMarker[1].length;
        const firstField = itemMarker[2];
        const item = parseScalarKvp(firstField);
        i++;
        // Subsequent same-indent `<itemIndent + 2>:`-leading lines belong to this item.
        const fieldIndent = itemIndent + 2;
        while (i < lines.length) {
          const fLine = lines[i];
          if (fLine.trim() === "") { i++; continue; }
          const fIndent = fLine.length - fLine.trimStart().length;
          if (fIndent < fieldIndent) break;
          if (fIndent !== fieldIndent) {
            throw new Error(`unexpected indent ${fIndent} (want ${fieldIndent}) on "${fLine}"`);
          }
          if (fLine.trimStart().startsWith("- ")) break; // next item starts
          const kvp = parseScalarKvp(fLine.trimStart());
          Object.assign(item, kvp);
          i++;
        }
        items.push(item);
      }
      root.stories = items;
      continue;
    }
    // Plain top-level scalar.
    root[key] = unquoteScalar(valueRaw);
    i++;
  }
  return root;
}

function parseScalarKvp(text) {
  const colonIdx = text.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(`scalar field missing ":" — "${text}"`);
  }
  const key = text.slice(0, colonIdx).trim();
  const value = unquoteScalar(text.slice(colonIdx + 1).trim());
  return { [key]: value };
}

function unquoteScalar(raw) {
  if (raw === "") return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Validate a parsed front-matter object against our pinned schema.
 * Returns `{ ok: true }` or `{ ok: false, errors: [...] }`.
 */
function validateFrontMatterShape(fm) {
  const errors = [];
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) {
    return { ok: false, errors: ["front-matter root must be an object"] };
  }
  const requiredTop = ["schemaVersion", "lastUpdated", "stories"];
  for (const k of requiredTop) {
    if (!(k in fm)) errors.push(`missing front-matter key: ${k}`);
  }
  const allowedTop = new Set(requiredTop);
  for (const k of Object.keys(fm)) {
    if (!allowedTop.has(k)) errors.push(`unexpected front-matter key: ${k}`);
  }
  if (fm.schemaVersion !== undefined && fm.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be exactly "${SCHEMA_VERSION}" (got "${fm.schemaVersion}")`);
  }
  if (fm.lastUpdated !== undefined && !ISO8601_RE.test(fm.lastUpdated)) {
    errors.push(`lastUpdated must be ISO-8601 (got "${fm.lastUpdated}")`);
  }
  if (fm.stories !== undefined) {
    if (!Array.isArray(fm.stories)) {
      errors.push("stories must be a list");
    } else {
      const seenIds = new Set();
      fm.stories.forEach((s, idx) => {
        if (typeof s !== "object" || s === null) {
          errors.push(`stories[${idx}] must be an object`); return;
        }
        const required = ["id", "lastUpdated", "lastGitSha"];
        for (const k of required) {
          if (!(k in s)) errors.push(`stories[${idx}] missing field: ${k}`);
        }
        const allowed = new Set(required);
        for (const k of Object.keys(s)) {
          if (!allowed.has(k)) errors.push(`stories[${idx}] unexpected field: ${k}`);
        }
        if (s.id && seenIds.has(s.id)) errors.push(`stories[${idx}] duplicate id: ${s.id}`);
        if (s.id) seenIds.add(s.id);
        if (s.lastUpdated && !ISO8601_RE.test(s.lastUpdated)) {
          errors.push(`stories[${idx}].lastUpdated invalid ISO-8601`);
        }
        if (s.lastGitSha && !SHA_OR_UNKNOWN_RE.test(s.lastGitSha)) {
          errors.push(`stories[${idx}].lastGitSha must be 40-char hex or "unknown" (got "${s.lastGitSha}")`);
        }
      });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Parse the body into a list of `{id, sections: Set<string>}` records, one
 * per `## story: <id>` heading. Sections are gathered between this `##` and
 * the next `##` (or EOF).
 */
function parseBodyStories(body) {
  const lines = body.split("\n");
  const stories = [];
  let current = null;
  for (const line of lines) {
    const storyMatch = line.match(/^## story: (\S.*)$/);
    if (storyMatch) {
      if (current) stories.push(current);
      current = { id: storyMatch[1].trim(), sections: new Set() };
      continue;
    }
    if (line.match(/^## /) && current) {
      stories.push(current);
      current = null;
      continue;
    }
    if (current) {
      const sectionMatch = line.match(/^### (\S+)\s*$/);
      if (sectionMatch) current.sections.add(sectionMatch[1]);
    }
  }
  if (current) stories.push(current);
  return stories;
}

/**
 * Top-level validation: parse + shape + body cross-check.
 */
export function validateTechSpec(text) {
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

  const bodyStories = parseBodyStories(body);
  const declaredIds = (fm.stories || []).map((s) => s.id);
  const bodyIds = bodyStories.map((s) => s.id);

  // Every front-matter story must appear in the body.
  for (const id of declaredIds) {
    if (!bodyIds.includes(id)) {
      errors.push(`front-matter story "${id}" has no "## story: ${id}" heading in body`);
    }
  }
  // Every body story must appear in the front-matter.
  for (const id of bodyIds) {
    if (!declaredIds.includes(id)) {
      errors.push(`body heading "## story: ${id}" has no front-matter entry`);
    }
  }
  // Each body story must contain all four required subsections.
  for (const s of bodyStories) {
    for (const need of REQUIRED_SECTIONS) {
      if (!s.sections.has(need)) {
        errors.push(`story "${s.id}" missing required subsection "### ${need}"`);
      }
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── CLI ──────────────────────────────────────────────────────────────────

function selfTest() {
  const sample = [
    "---",
    'schemaVersion: "1.0.0"',
    'lastUpdated: "2026-04-25T12:00:00Z"',
    "stories:",
    '  - id: "US-01"',
    '    lastUpdated: "2026-04-25T12:00:00Z"',
    '    lastGitSha: "0123456789abcdef0123456789abcdef01234567"',
    "---",
    "",
    "## story: US-01",
    "",
    "### api-contracts",
    "",
    "(none)",
    "",
    "### data-models",
    "",
    "(none)",
    "",
    "### invariants",
    "",
    "(none)",
    "",
    "### test-surface",
    "",
    "(none)",
    "",
  ].join("\n");
  const r = validateTechSpec(sample);
  if (!r.ok) { console.error("self-test failed:", r.errors); process.exit(1); }
  console.log("self-test ok");
  process.exit(0);
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") selfTest();
if (args.length === 0) {
  console.error("usage: node scripts/validate-tech-spec.mjs <path|--self-test>");
  process.exit(2);
}
const path = resolve(args[0]);
if (!existsSync(path)) {
  console.error(`file not found: ${path}`);
  process.exit(2);
}
const text = readFileSync(path, "utf-8");
const result = validateTechSpec(text);
if (result.ok) {
  console.log(`OK: ${path}`);
  process.exit(0);
}
console.error(`INVALID: ${path}`);
for (const err of result.errors) console.error(`  - ${err}`);
process.exit(1);
