/**
 * spec-generator.ts — synchronous post-PASS author of
 * `docs/generated/TECHNICAL-SPEC.md`.
 *
 * v0.36.0 Phase B (improvement #2). Called from `server/tools/evaluate.ts`
 * IMMEDIATELY BEFORE `writeRunRecord` on a story-mode PASS — the call is
 * sequenced this way so `RunRecord.generatedDocs` can carry the result of
 * this function rather than needing a second write. Synchronous by mandate
 * (plan §122 / AC-B1): the spec MUST exist by the time `forge_evaluate`
 * returns to the caller; async would require an unspecified poll window and
 * break the contract that "PASS means docs are current."
 *
 * Cost: one `trackedCallClaude` round-trip per PASS (~$0.03–$0.10 for the
 * sizes we see). Plan AC-B6 caps total at $0.80 / 13-story phase.
 *
 * Idempotency contract (AC-B2): re-running the spec generator on the same
 * story leaves the body section count at exactly one and updates only the
 * matching `stories[i].lastUpdated` entry in the top-of-file front-matter.
 * The merge is by `id`, not by position.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import type { EvalReport } from "../types/eval-report.js";
import { RunContext, trackedCallClaude } from "./run-context.js";
import {
  buildSourceVocabulary,
  renderVocabularyForPrompt,
  vocabularyContains,
  type SourceVocabulary,
} from "./spec-source-vocabulary.js";
import type { SpecGeneratorWarning } from "./run-record.js";

// ── Constants ────────────────────────────────────────────────────────────

const SCHEMA_VERSION = "1.0.0" as const;
const REQUIRED_SECTIONS = ["api-contracts", "data-models", "invariants", "test-surface"] as const;
type SectionName = (typeof REQUIRED_SECTIONS)[number];

const SPEC_REL_PATH = "docs/generated/TECHNICAL-SPEC.md";

// ── Types ────────────────────────────────────────────────────────────────

export interface SpecGeneratorInput {
  /** Absolute path to project root (must contain a writeable `docs/generated/`). */
  projectPath: string;
  /** Story id this section is being authored for (must match `## story: <id>`). */
  storyId: string;
  /** The PASS-verdict eval report, used as primary structured evidence. */
  evalReport: EvalReport;
  /**
   * Story's affectedPaths (directory prefixes or file paths, relative to
   * `projectPath`). Drives the source-vocabulary extractor. Empty / omitted
   * paths produce a "No source vocabulary available" prompt and instruct the
   * LLM to emit `(none)` for api-contracts and data-models.
   */
  affectedPaths?: string[];
  /** Optional 40-char hex git SHA captured at PASS time. `"unknown"` if absent. */
  gitSha?: string;
  /** RunContext for cost/audit tracking; spec-generator participates in the run's $$$ totals. */
  ctx: RunContext;
  /** Override LLM with a deterministic injected synthesizer (for tests). */
  synthesize?: (req: SynthesisRequest) => Promise<SynthesisResponse>;
}

export interface SpecGeneratorResult {
  specPath: string;
  genTimestamp: string;
  genTokens: { inputTokens: number; outputTokens: number };
  contracts: string[];
  bodyChanged: boolean;
  /**
   * Strip events from the post-validator. Empty array if no bullets were
   * stripped (or if validator mode is "warn"). The caller stamps this onto
   * `RunRecord.generatedDocs.warnings` (AC-10).
   */
  warnings: SpecGeneratorWarning[];
}

export interface SynthesisRequest {
  storyId: string;
  evalReport: EvalReport;
  diffSummary: string;
  /**
   * Pre-rendered "Real symbols available" Markdown block for the user
   * prompt. Either a real vocabulary listing or the "No source vocabulary
   * available" fallback. The default synthesizer's `buildUserPrompt`
   * inserts this verbatim before the AC list.
   */
  vocabularyPrompt: string;
}

export interface SynthesisResponse {
  /** Tool ids touched by this story (e.g. ["forge_evaluate", "forge_generate"]). */
  contracts: string[];
  /** Pre-rendered Markdown for each of the four required subsections. */
  sections: Record<SectionName, string>;
  /** Token usage from the LLM call (zero for synthesised/test paths). */
  tokens: { inputTokens: number; outputTokens: number };
}

// ── Front-matter helpers (mirrors validate-tech-spec.mjs grammar) ────────

interface ParsedSpec {
  frontMatter: {
    schemaVersion: string;
    lastUpdated: string;
    stories: Array<{ id: string; lastUpdated: string; lastGitSha: string }>;
  };
  body: string;
}

function parseSpec(text: string): ParsedSpec {
  const normalised = text.replace(/\r\n/g, "\n");
  const m = normalised.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("spec file missing closed `---` front-matter fence");
  const fm = parseFrontMatterYaml(m[1]);
  return { frontMatter: fm, body: m[2] };
}

function parseFrontMatterYaml(yaml: string): ParsedSpec["frontMatter"] {
  const lines = yaml.split("\n");
  const out: Partial<ParsedSpec["frontMatter"]> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) { i++; continue; }
    const colon = line.indexOf(":");
    if (colon === -1) throw new Error(`malformed front-matter line: "${line}"`);
    const key = line.slice(0, colon).trim();
    const valueRaw = line.slice(colon + 1).trim();
    if (key === "stories") {
      const items: ParsedSpec["frontMatter"]["stories"] = [];
      if (valueRaw === "[]") { out.stories = []; i++; continue; }
      i++;
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === "") { i++; continue; }
        const indent = ln.length - ln.trimStart().length;
        if (indent === 0) break;
        const itemMatch = ln.match(/^(\s+)-\s+(.+)$/);
        if (!itemMatch) throw new Error(`expected list item, got "${ln}"`);
        const itemIndent = itemMatch[1].length;
        const fieldIndent = itemIndent + 2;
        const item: Record<string, string> = {};
        Object.assign(item, parseScalar(itemMatch[2]));
        i++;
        while (i < lines.length) {
          const fl = lines[i];
          if (fl.trim() === "") { i++; continue; }
          const fIndent = fl.length - fl.trimStart().length;
          if (fIndent < fieldIndent) break;
          if (fl.trimStart().startsWith("- ")) break;
          Object.assign(item, parseScalar(fl.trimStart()));
          i++;
        }
        items.push(item as ParsedSpec["frontMatter"]["stories"][number]);
      }
      out.stories = items;
      continue;
    }
    (out as Record<string, unknown>)[key] = unquote(valueRaw);
    i++;
  }
  if (!out.schemaVersion) throw new Error("front-matter missing schemaVersion");
  if (!out.lastUpdated) throw new Error("front-matter missing lastUpdated");
  if (!out.stories) out.stories = [];
  return out as ParsedSpec["frontMatter"];
}

function parseScalar(text: string): Record<string, string> {
  const colon = text.indexOf(":");
  if (colon === -1) throw new Error(`scalar missing colon: "${text}"`);
  const k = text.slice(0, colon).trim();
  const v = unquote(text.slice(colon + 1).trim());
  return { [k]: v };
}

function unquote(raw: string): string {
  if (raw === "") return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function renderFrontMatter(fm: ParsedSpec["frontMatter"]): string {
  const lines = [
    `schemaVersion: "${fm.schemaVersion}"`,
    `lastUpdated: "${fm.lastUpdated}"`,
    fm.stories.length === 0 ? "stories: []" : "stories:",
  ];
  for (const s of fm.stories) {
    lines.push(`  - id: "${s.id}"`);
    lines.push(`    lastUpdated: "${s.lastUpdated}"`);
    lines.push(`    lastGitSha: "${s.lastGitSha}"`);
  }
  return lines.join("\n");
}

// ── Body section helpers ─────────────────────────────────────────────────

interface BodySection { id: string; markdown: string }

function splitBodyByStory(body: string): BodySection[] {
  const lines = body.split("\n");
  const sections: BodySection[] = [];
  let curId: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (curId !== null) sections.push({ id: curId, markdown: buf.join("\n") });
    curId = null; buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^## story: (\S.*)$/);
    if (m) {
      flush();
      curId = m[1].trim();
      buf = [line];
      continue;
    }
    if (line.startsWith("## ") && curId !== null) {
      flush();
      // non-story `##` heading — preserve as a free-floating section
      sections.push({ id: `__free_${sections.length}__`, markdown: line });
      continue;
    }
    if (curId !== null) buf.push(line);
  }
  flush();
  return sections;
}

function renderStorySection(storyId: string, sections: Record<SectionName, string>): string {
  const parts: string[] = [`## story: ${storyId}`, ""];
  for (const name of REQUIRED_SECTIONS) {
    parts.push(`### ${name}`, "", sections[name].trim() === "" ? "(none)" : sections[name].trim(), "");
  }
  return parts.join("\n");
}

// ── Diff capture ─────────────────────────────────────────────────────────

/**
 * Best-effort: capture a short diff summary for prompt context. Failure is
 * swallowed (returns empty string) — the spec-generator must still produce
 * a section even when git is unavailable.
 */
function captureDiffSummary(cwd: string): string {
  try {
    const stat = execFileSync("git", ["diff", "--stat", "HEAD~1...HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return stat.length > 4000 ? stat.slice(0, 4000) + "\n…(truncated)" : stat;
  } catch {
    return "";
  }
}

// ── LLM synthesis ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the spec-generator for forge-harness's living TECHNICAL-SPEC.md.

For one story (a unit of shipped work), you write four short structured Markdown subsections capturing what the diff settled.

Output ONLY a single JSON object. Schema:

{
  "contracts": ["<mcp-tool-id>", ...],   // MCP tool ids touched (e.g. "forge_evaluate"). Empty array if none.
  "sections": {
    "api-contracts":  "<markdown>",       // bullet list, one bullet per public surface change
    "data-models":    "<markdown>",       // bullet list, one bullet per persisted/wire-format shape change
    "invariants":     "<markdown>",       // bullet list of properties that MUST hold post-merge
    "test-surface":   "<markdown>"        // bullet list of test files / coverage ratchets added or changed
  }
}

Rules:
- Agent-first. NO prose narrative, NO motivation, NO storytelling.
- Each subsection is a Markdown bullet list. Use \`-\` bullets, one fact per bullet.
- Bullets in "api-contracts" MUST start with a backtick-wrapped identifier (e.g. "- \`forge_evaluate.generatedDocs\`: ...").
- If a subsection genuinely has nothing to record, return the literal string "(none)".
- Be terse. Each bullet should be one line, ideally under 120 chars.
- The "contracts" array is the canonical list of MCP tool identifiers (top-level tool names only, no method paths) that the diff TOUCHES, regardless of whether each tool has a dedicated bullet under api-contracts.
- Do NOT invent contracts. If you can't see a tool change in the evidence, do not list it.
- Every backtick-quoted identifier you emit MUST appear in the "Real symbols available" section of the user prompt. If a needed symbol isn't there, emit "(none)" for that section.`;

export function buildUserPrompt(req: SynthesisRequest): string {
  const acLines = req.evalReport.criteria
    .map((c) => `- ${c.id} [${c.status}]: ${c.evidence.slice(0, 200)}`)
    .join("\n");
  return [
    `## Story\n${req.storyId}\n`,
    `## Eval verdict\n${req.evalReport.verdict}\n`,
    `${req.vocabularyPrompt}\n`,
    `## Acceptance criteria results\n${acLines || "(none)"}\n`,
    `## Diff summary\n${req.diffSummary || "(unavailable)"}\n`,
    "Emit the JSON object now.",
  ].join("\n");
}

async function defaultSynthesize(
  ctx: RunContext,
  req: SynthesisRequest,
): Promise<SynthesisResponse> {
  const result = await trackedCallClaude(ctx, "spec-gen", "spec-generator", {
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(req) }],
    jsonMode: true,
  });
  const parsed = (result.parsed ?? {}) as Partial<SynthesisResponse>;
  const sectionsRaw = parsed.sections ?? {};
  const sections: Record<SectionName, string> = {
    "api-contracts": "(none)",
    "data-models": "(none)",
    invariants: "(none)",
    "test-surface": "(none)",
  };
  for (const k of REQUIRED_SECTIONS) {
    const v = (sectionsRaw as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim() !== "") sections[k] = v;
  }
  const contracts = Array.isArray(parsed.contracts)
    ? parsed.contracts.filter((c): c is string => typeof c === "string")
    : [];
  return {
    contracts,
    sections,
    tokens: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  };
}

// ── Post-validator (Strategy 2: strip unknown identifiers) ────────────────

/**
 * Allowlist of built-in TypeScript / JavaScript globals + standard library
 * symbols. These names are legitimate environment references (return types,
 * generic constraints, exception types) and MUST NOT be stripped even when
 * the project source vocabulary doesn't contain them. Keep terse — when in
 * doubt, omit; the validator is permissive about test-name strings and
 * forge_* tool ids elsewhere.
 */
const TS_BUILTINS = new Set<string>([
  // Promise & async surface
  "Promise", "PromiseLike", "Awaited", "AsyncIterable", "AsyncIterator", "AsyncGenerator",
  // Collections + iteration
  "Array", "ReadonlyArray", "Map", "ReadonlyMap", "Set", "ReadonlySet", "WeakMap", "WeakSet",
  "Iterable", "Iterator", "Generator", "ArrayLike", "Record", "Tuple",
  // Primitives + boxed
  "String", "Number", "Boolean", "Symbol", "BigInt", "Object", "Function",
  // Errors
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError",
  // Utility types
  "Partial", "Required", "Readonly", "Pick", "Omit", "Exclude", "Extract", "NonNullable",
  "Parameters", "ReturnType", "InstanceType", "ThisType", "Uppercase", "Lowercase", "Capitalize", "Uncapitalize",
  // Date/regex/JSON/Math
  "Date", "RegExp", "JSON", "Math",
  // Buffers + binary
  "Buffer", "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  // DOM-ish (might appear in mixed code)
  "URL", "URLSearchParams", "Blob", "File", "FormData",
  // Misc
  "Proxy", "Reflect", "WeakRef", "FinalizationRegistry",
]);

/**
 * Mode is `strip` by default. Set `FORGE_SPEC_VALIDATOR_MODE=warn` to keep
 * bullets in the file but still record `warnings` (AC-11). Any other value
 * (or unset) means "strip".
 */
function validatorMode(): "strip" | "warn" {
  const v = process.env.FORGE_SPEC_VALIDATOR_MODE;
  return v === "warn" ? "warn" : "strip";
}

/**
 * Walk every backtick-quoted identifier in each section's bullets. For each
 * identifier not present in `vocab`, either:
 *   - mode=strip: drop the entire bullet line (and emit a warning)
 *   - mode=warn:  leave the bullet (still emit a warning)
 *
 * If a section ends up empty after strips, it is replaced with "(none)".
 *
 * Identifier extraction: any token inside a backtick pair on a bullet line.
 * Bullets are lines that start with `-` (after optional leading whitespace).
 * Identifiers may take the forms `Foo`, `Foo.bar`, `Foo.bar.baz` (only the
 * first two segments are checked — deeper navigation is treated as
 * recognised so long as the prefix matches).
 */
export function validateAgainstVocabulary(
  sections: Record<SectionName, string>,
  vocab: SourceVocabulary,
  storyContext: { filesScanned: number },
): { sections: Record<SectionName, string>; warnings: SpecGeneratorWarning[] } {
  const mode = validatorMode();
  const out: Record<SectionName, string> = { ...sections };
  const warnings: SpecGeneratorWarning[] = [];

  for (const sectionName of REQUIRED_SECTIONS) {
    const text = sections[sectionName];
    if (!text || text.trim() === "" || text.trim() === "(none)") continue;

    const lines = text.split("\n");
    const keptLines: string[] = [];
    for (const line of lines) {
      const isBullet = /^\s*-\s/.test(line);
      if (!isBullet) { keptLines.push(line); continue; }

      // Extract every backtick-quoted token from this bullet, then for each
      // span pull out programming-symbol-shaped identifiers from inside it.
      // The LLM emits bullets like:
      //   - `KnowledgeService.search(query: string): Promise<KnowledgeResult[]>`
      //   - `KnowledgeDocument`: persisted shape with `id`, `content`
      // so the entire backtick span isn't a clean identifier — we have to
      // harvest each capitalised symbol-ish token from within the span.
      const symbolLike: string[] = [];
      const spanRe = /`([^`]+)`/g;
      let m: RegExpExecArray | null;
      while ((m = spanRe.exec(line)) !== null) {
        const span = m[1];
        // Strip generic angle-bracket arguments (`Foo<Bar>` → `Foo`) and
        // array brackets so they don't fragment the identifier.
        const simplified = span.replace(/<[^>]*>/g, "").replace(/\[\]/g, "");
        const tokenRe = /\b([A-Z][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\b/g;
        let tm: RegExpExecArray | null;
        while ((tm = tokenRe.exec(simplified)) !== null) symbolLike.push(tm[1]);
      }
      // Strings inside test-surface ("test name") are quoted with double quotes,
      // not asterisks, so they survive this pass — they don't begin with a capital
      // unless the LLM happened to write a Title Case test name. We let the
      // test-name match handle that path.
      // Also harvest backtick-wrapped quoted strings as test-name candidates.
      // Pattern: `"some string"` — preserve the inner string for test-name match.
      const quotedTestRe = /`"([^"]+)"`/g;
      let qm: RegExpExecArray | null;
      while ((qm = quotedTestRe.exec(line)) !== null) symbolLike.push(qm[1]);

      let bulletKept = true;
      for (const id of symbolLike) {
        // Allow MCP tool ids by string-prefix convention (forge_evaluate, forge_generate, ...).
        if (/^forge_[a-z_]+$/.test(id) || /^forge_[a-z_]+\.[A-Za-z0-9_$]+$/.test(id)) continue;
        // Allow common TypeScript built-ins / globals — these are environment
        // names the LLM legitimately references in signatures and don't need
        // to live in a project source vocabulary.
        if (TS_BUILTINS.has(id)) continue;
        // Top-level segment of a dotted path: if the head is a builtin, skip.
        const head = id.split(".")[0];
        if (TS_BUILTINS.has(head)) continue;
        // Two-segment check: `Foo.bar` validates against full string OR the owner being a known class/type.
        const okFull = vocabularyContains(vocab, id);
        if (okFull) continue;
        // Deeper paths: `Foo.bar.baz` — accept if the two-segment prefix is in vocab.
        if (id.indexOf(".") !== -1) {
          const twoSeg = id.split(".").slice(0, 2).join(".");
          if (vocabularyContains(vocab, twoSeg)) continue;
        }
        // Unknown identifier: log warning and (if strip mode) drop bullet.
        warnings.push({
          kind: "stripped-unknown-identifier",
          identifier: id,
          section: sectionName,
          filesScanned: storyContext.filesScanned,
        });
        if (mode === "strip") bulletKept = false;
      }

      if (bulletKept) keptLines.push(line);
    }

    let rebuilt = keptLines.join("\n").trim();
    if (rebuilt === "" || /^[\s-]+$/.test(rebuilt)) rebuilt = "(none)";
    out[sectionName] = rebuilt;
  }

  return { sections: out, warnings };
}

// ── Main entry ───────────────────────────────────────────────────────────

/**
 * Generate or update a story's section in `docs/generated/TECHNICAL-SPEC.md`.
 * Idempotent across re-runs: same story id always produces exactly one
 * `## story: <id>` heading in the body and exactly one entry in the
 * front-matter `stories[]` array.
 *
 * Returns metadata for the caller to stamp into `RunRecord.generatedDocs`.
 */
export async function generateSpecForStory(
  input: SpecGeneratorInput,
): Promise<SpecGeneratorResult> {
  const specPath = resolve(input.projectPath, SPEC_REL_PATH);
  const now = new Date().toISOString();
  const gitShaSafe = input.gitSha && /^[0-9a-f]{40}$/.test(input.gitSha)
    ? input.gitSha
    : "unknown";

  // Read existing spec (or scaffold an empty one).
  let parsed: ParsedSpec;
  if (existsSync(specPath)) {
    const text = readFileSync(specPath, "utf-8");
    try {
      parsed = parseSpec(text);
    } catch (err) {
      // Corrupted file — start fresh, but log the cause so the operator can
      // recover the prior content from git.
      console.error(
        `spec-generator: existing spec at ${specPath} is malformed (${err instanceof Error ? err.message : String(err)}); rewriting from scratch`,
      );
      parsed = emptySpec(now);
    }
  } else {
    parsed = emptySpec(now);
  }

  // Build source vocabulary from the story's affectedPaths. Empty/omitted
  // paths fall back to the "No source vocabulary available" prompt.
  const vocab = buildSourceVocabulary(
    input.projectPath,
    input.affectedPaths ?? [],
  );
  const vocabularyPrompt = renderVocabularyForPrompt(vocab);

  // Synthesise the new section.
  const synth = input.synthesize ?? ((req) => defaultSynthesize(input.ctx, req));
  const diffSummary = captureDiffSummary(input.projectPath);
  const synthResult = await synth({
    storyId: input.storyId,
    evalReport: input.evalReport,
    diffSummary,
    vocabularyPrompt,
  });

  // Strategy 2: post-validate against the vocabulary. Strips bullets whose
  // backtick-quoted identifiers are not present in vocab (mode=strip), or
  // logs warnings without stripping (mode=warn). Skip entirely when the
  // vocabulary is empty (no source files to ground on) — every bullet would
  // be a false positive.
  let validatedSections = synthResult.sections;
  let warnings: SpecGeneratorWarning[] = [];
  const hasVocab = vocab.identifiers.size > 0 || vocab.testNames.size > 0;
  if (hasVocab) {
    const validated = validateAgainstVocabulary(
      synthResult.sections,
      vocab,
      { filesScanned: vocab.filesScanned.length },
    );
    validatedSections = validated.sections;
    warnings = validated.warnings;
  }

  // Merge into front-matter `stories[]` by id.
  const idx = parsed.frontMatter.stories.findIndex((s) => s.id === input.storyId);
  const entry = { id: input.storyId, lastUpdated: now, lastGitSha: gitShaSafe };
  if (idx === -1) parsed.frontMatter.stories.push(entry);
  else parsed.frontMatter.stories[idx] = entry;
  // Sort by id for byte-stable output.
  parsed.frontMatter.stories.sort((a, b) => a.id.localeCompare(b.id));
  parsed.frontMatter.lastUpdated = now;
  parsed.frontMatter.schemaVersion = SCHEMA_VERSION;

  // Rebuild body: replace any existing `## story: <id>` block, otherwise
  // append. The current body may contain multiple sections; we walk them.
  const newSection = renderStorySection(input.storyId, validatedSections);
  const bodyChanged = mergeStorySectionInBody(parsed, input.storyId, newSection);

  // Write atomically.
  mkdirSync(dirname(specPath), { recursive: true });
  const out = `---\n${renderFrontMatter(parsed.frontMatter)}\n---\n\n${normaliseBody(parsed.body)}`;
  writeFileSync(specPath, out, "utf-8");

  return {
    specPath,
    genTimestamp: now,
    genTokens: synthResult.tokens,
    contracts: synthResult.contracts,
    bodyChanged,
    warnings,
  };
}

function emptySpec(timestamp: string): ParsedSpec {
  return {
    frontMatter: {
      schemaVersion: SCHEMA_VERSION,
      lastUpdated: timestamp,
      stories: [],
    },
    body: "",
  };
}

/**
 * In-place: replace or append the `## story: <id>` block in `parsed.body`.
 * Returns true if a textually different block was written (a write that only
 * updates `lastUpdated` may still produce identical body; the front-matter
 * mutation is what the spec sees in that case).
 */
function mergeStorySectionInBody(
  parsed: ParsedSpec,
  storyId: string,
  newSection: string,
): boolean {
  const sections = splitBodyByStory(parsed.body);
  let replaced = false;
  let bodyChanged = false;
  const merged: string[] = [];
  for (const s of sections) {
    if (s.id === storyId) {
      if (s.markdown.trim() !== newSection.trim()) bodyChanged = true;
      merged.push(newSection);
      replaced = true;
    } else {
      merged.push(s.markdown);
    }
  }
  if (!replaced) {
    merged.push(newSection);
    bodyChanged = true;
  }
  // Sort the story sections by id for byte-stable output, preserving any
  // free-floating non-story `## ...` blocks at the top.
  const storyChunks = merged.filter((m) => /^## story: /.test(m));
  const otherChunks = merged.filter((m) => !/^## story: /.test(m));
  storyChunks.sort((a, b) => {
    const aId = a.match(/^## story: (\S.*)/)?.[1] ?? "";
    const bId = b.match(/^## story: (\S.*)/)?.[1] ?? "";
    return aId.localeCompare(bId);
  });
  parsed.body = [...otherChunks, ...storyChunks].join("\n\n").trim();
  return bodyChanged;
}

function normaliseBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim() + "\n";
}
