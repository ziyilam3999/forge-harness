/**
 * spec-source-vocabulary.ts — TypeScript Compiler-API-based extractor that
 * walks a story's `affectedPaths` (directory prefixes or specific files) and
 * harvests every exported symbol the LLM is allowed to ground on when writing
 * the TECHNICAL-SPEC.md story section.
 *
 * Sibling of `spec-vocabulary-check.ts` — that module verifies PRD drift
 * (regex-based, drift-only); this one feeds prompt grounding (AST-based,
 * extraction-only). Two purposes, two modules; do NOT merge.
 *
 * Why TS Compiler API not regex: classes (with public methods), function
 * declarations, exported `const`s, default exports, re-exports, generics,
 * enums, JS/MJS files. Regex collapses on edge cases the plan AC-2 names by
 * scenario. Compiler API is the principled path; ~250 LOC vs the regex
 * mess.
 */

import * as ts from "typescript";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve, extname, basename } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

export interface SourceVocabulary {
  /** Flat set of every export name (class, interface, type, function, const, enum). */
  identifiers: Set<string>;
  /** For each class export, its public method names (qualified `Class.method`). */
  methods: Set<string>;
  /** For each interface/type/enum export, its top-level field names (qualified `Type.field`). */
  fields: Set<string>;
  /** Test-name string literals harvested from describe/it/test calls. */
  testNames: Set<string>;
  /** File paths actually parsed (for fallback diagnostics). */
  filesScanned: string[];
  /** Soft-failure reasons: parse errors, unsupported file types, etc. */
  warnings: string[];
}

const SOURCE_EXTS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

// ── File walker ──────────────────────────────────────────────────────────

/**
 * Resolve `affectedPaths` (directory prefixes per planner.ts convention OR
 * specific files) into an absolute file-path list. Skips test files
 * (`*.test.*`, `*.spec.*`) and node_modules.
 */
function resolveAffectedFiles(
  projectPath: string,
  affectedPaths: ReadonlyArray<string>,
  warnings: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of affectedPaths) {
    const abs = resolve(projectPath, p);
    if (!existsSync(abs)) {
      warnings.push(`affectedPath does not exist: ${p}`);
      continue;
    }
    const stat = statSync(abs);
    if (stat.isFile()) {
      if (!SOURCE_EXTS.has(extname(abs))) continue;
      if (basename(abs).match(/\.(test|spec)\.[mc]?[jt]sx?$/)) continue;
      if (!seen.has(abs)) { seen.add(abs); out.push(abs); }
    } else if (stat.isDirectory()) {
      walkDir(abs, out, seen, warnings);
    }
  }
  return out;
}

function walkDir(
  dir: string,
  out: string[],
  seen: Set<string>,
  warnings: string[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    warnings.push(`cannot read dir ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === "build") continue;
    const full = join(dir, name);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      walkDir(full, out, seen, warnings);
    } else if (stat.isFile()) {
      if (!SOURCE_EXTS.has(extname(name))) continue;
      if (name.match(/\.(test|spec)\.[mc]?[jt]sx?$/)) continue;
      if (!seen.has(full)) { seen.add(full); out.push(full); }
    }
  }
}

// ── Test-name walker (separate pass over *.test.* + *.spec.*) ────────────

function collectTestFiles(
  projectPath: string,
  affectedPaths: ReadonlyArray<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of affectedPaths) {
    const abs = resolve(projectPath, p);
    if (!existsSync(abs)) continue;
    const stat = statSync(abs);
    if (stat.isFile()) {
      if (basename(abs).match(/\.(test|spec)\.[mc]?[jt]sx?$/)) {
        if (!seen.has(abs)) { seen.add(abs); out.push(abs); }
      }
    } else if (stat.isDirectory()) {
      walkTestDir(abs, out, seen);
    }
  }
  return out;
}

function walkTestDir(dir: string, out: string[], seen: Set<string>): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === "build") continue;
    const full = join(dir, name);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) walkTestDir(full, out, seen);
    else if (stat.isFile() && name.match(/\.(test|spec)\.[mc]?[jt]sx?$/)) {
      if (!seen.has(full)) { seen.add(full); out.push(full); }
    }
  }
}

// ── AST visitors ─────────────────────────────────────────────────────────

function harvestFromSourceFile(
  sf: ts.SourceFile,
  vocab: SourceVocabulary,
): void {
  ts.forEachChild(sf, (node) => visitTopLevel(node, vocab));
}

function visitTopLevel(node: ts.Node, vocab: SourceVocabulary): void {
  // export class Foo { ... }   |   export default class Foo { ... }
  if (ts.isClassDeclaration(node) && hasExportModifier(node) && node.name) {
    const className = node.name.text;
    vocab.identifiers.add(className);
    if (hasDefaultModifier(node)) vocab.identifiers.add("default");
    for (const member of node.members) {
      if (
        (ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) &&
        member.name &&
        ts.isIdentifier(member.name) &&
        !hasPrivateLikeModifier(member)
      ) {
        vocab.methods.add(`${className}.${member.name.text}`);
      } else if (
        ts.isPropertyDeclaration(member) &&
        member.name &&
        ts.isIdentifier(member.name) &&
        !hasPrivateLikeModifier(member)
      ) {
        vocab.fields.add(`${className}.${member.name.text}`);
      }
    }
    return;
  }

  // export interface Foo { field: ... }
  if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) {
    const name = node.name.text;
    vocab.identifiers.add(name);
    for (const member of node.members) {
      if (member.name && ts.isIdentifier(member.name)) {
        vocab.fields.add(`${name}.${member.name.text}`);
      }
    }
    return;
  }

  // export type Foo = { field: ... } | otherShape
  if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) {
    const name = node.name.text;
    vocab.identifiers.add(name);
    if (node.type && ts.isTypeLiteralNode(node.type)) {
      for (const member of node.type.members) {
        if (member.name && ts.isIdentifier(member.name)) {
          vocab.fields.add(`${name}.${member.name.text}`);
        }
      }
    }
    return;
  }

  // export enum Foo { A, B, C }
  if (ts.isEnumDeclaration(node) && hasExportModifier(node)) {
    const name = node.name.text;
    vocab.identifiers.add(name);
    for (const member of node.members) {
      if (member.name && ts.isIdentifier(member.name)) {
        vocab.fields.add(`${name}.${member.name.text}`);
      }
    }
    return;
  }

  // export function foo(...) { ... }   (generics included; bare name only)
  // Also covers `export default function foo() {}`.
  if (ts.isFunctionDeclaration(node) && hasExportModifier(node) && node.name) {
    vocab.identifiers.add(node.name.text);
    if (hasDefaultModifier(node)) vocab.identifiers.add("default");
    return;
  }

  // export const foo = ..., bar = ...
  if (ts.isVariableStatement(node) && hasExportModifier(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) vocab.identifiers.add(decl.name.text);
    }
    return;
  }

  // export default <expr>   (function/class/identifier)
  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    const expr = node.expression;
    if (ts.isIdentifier(expr)) {
      vocab.identifiers.add(expr.text);
    } else if (ts.isClassExpression(expr) && expr.name) {
      vocab.identifiers.add(expr.name.text);
    } else if (ts.isFunctionExpression(expr) && expr.name) {
      vocab.identifiers.add(expr.name.text);
    }
    // Anonymous default exports (export default () => {}, export default class {})
    // contribute "default" as a usable identifier alias.
    vocab.identifiers.add("default");
    return;
  }

  // export default function foo() {} | export default class Foo {}
  if (
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
    hasDefaultModifier(node)
  ) {
    if (node.name) vocab.identifiers.add(node.name.text);
    vocab.identifiers.add("default");
    return;
  }

  // export { X } from "./y"   |   export { X, Y as Z }
  if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const spec of node.exportClause.elements) {
      // The exported binding name (after `as` if present)
      vocab.identifiers.add(spec.name.text);
    }
    return;
  }

  // export * from "./y"  — without resolution we can't know names; skip silently.
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

function hasPrivateLikeModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!mods) return false;
  return mods.some(
    (m) =>
      m.kind === ts.SyntaxKind.PrivateKeyword ||
      m.kind === ts.SyntaxKind.ProtectedKeyword,
  );
}

// ── Test-name harvester ──────────────────────────────────────────────────

function harvestTestNames(sf: ts.SourceFile, vocab: SourceVocabulary): void {
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name: string | null = null;
      if (ts.isIdentifier(callee)) name = callee.text;
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) name = callee.expression.text;
      if (name === "describe" || name === "it" || name === "test") {
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) {
          vocab.testNames.add(first.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

// ── Public entry ─────────────────────────────────────────────────────────

/**
 * Build a vocabulary by parsing every source file under `affectedPaths`
 * (directory prefixes or specific files, relative to `projectPath`).
 *
 * Soft-failure posture: parse errors, missing files, unsupported extensions
 * become entries in `vocab.warnings` rather than thrown errors. The caller
 * (spec-generator) decides whether to short-circuit to `(none)` or proceed
 * with whatever the partial vocabulary captured.
 */
export function buildSourceVocabulary(
  projectPath: string,
  affectedPaths: ReadonlyArray<string>,
): SourceVocabulary {
  const vocab: SourceVocabulary = {
    identifiers: new Set(),
    methods: new Set(),
    fields: new Set(),
    testNames: new Set(),
    filesScanned: [],
    warnings: [],
  };

  if (affectedPaths.length === 0) {
    vocab.warnings.push("affectedPaths empty — no source vocabulary available");
    return vocab;
  }

  const sourceFiles = resolveAffectedFiles(projectPath, affectedPaths, vocab.warnings);
  const testFiles = collectTestFiles(projectPath, affectedPaths);
  const allFiles = [...sourceFiles, ...testFiles];

  if (allFiles.length === 0) {
    vocab.warnings.push("affectedPaths yielded no source files");
    return vocab;
  }

  // Per-file parse with `ts.createSourceFile` — lighter than `createProgram`
  // (no checker, no module-resolution overhead). We do not need cross-file
  // typechecking for vocabulary harvest.
  for (const file of allFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch (err) {
      vocab.warnings.push(`read failure ${file}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const ext = extname(file);
    const isJs = ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs";
    const sf = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.ES2022,
      /*setParentNodes*/ true,
      isJs ? ts.ScriptKind.JS : (ext === ".tsx" || ext === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
    );
    vocab.filesScanned.push(file);

    if (basename(file).match(/\.(test|spec)\.[mc]?[jt]sx?$/)) {
      harvestTestNames(sf, vocab);
    } else {
      harvestFromSourceFile(sf, vocab);
    }
  }

  return vocab;
}

// ── Rendering helpers (used by spec-generator's prompt-build path) ───────

/**
 * Render the vocabulary as a Markdown block to insert into the user prompt.
 * Caps the output at `byteLimit` (default 2000 bytes) — truncates at the
 * last full line before the cap and appends `…(N more)`.
 */
export function renderVocabularyForPrompt(
  vocab: SourceVocabulary,
  byteLimit = 2000,
): string {
  if (vocab.identifiers.size === 0 && vocab.testNames.size === 0) {
    return "## Real symbols available\nNo source vocabulary available — emit `(none)` for api-contracts and data-models.";
  }

  // Group methods + fields by class/type prefix so the block reads as
  // "ClassName { method, method }".
  const methodsByOwner = new Map<string, string[]>();
  for (const m of vocab.methods) {
    const [owner, name] = m.split(".");
    const arr = methodsByOwner.get(owner) ?? [];
    arr.push(name);
    methodsByOwner.set(owner, arr);
  }
  const fieldsByOwner = new Map<string, string[]>();
  for (const f of vocab.fields) {
    const [owner, name] = f.split(".");
    const arr = fieldsByOwner.get(owner) ?? [];
    arr.push(name);
    fieldsByOwner.set(owner, arr);
  }

  const classLines: string[] = [];
  const typeLines: string[] = [];
  const funcLines: string[] = [];
  const sortedIds = Array.from(vocab.identifiers).sort();
  for (const id of sortedIds) {
    if (methodsByOwner.has(id)) {
      classLines.push(`- ${id} { ${methodsByOwner.get(id)!.sort().join(", ")} }`);
    } else if (fieldsByOwner.has(id)) {
      typeLines.push(`- ${id} { ${fieldsByOwner.get(id)!.sort().join(", ")} }`);
    } else {
      funcLines.push(`- ${id}`);
    }
  }

  const testLines: string[] = Array.from(vocab.testNames)
    .sort()
    .map((n) => `- "${n}"`);

  const sectionsRendered: string[] = ["## Real symbols available"];
  sectionsRendered.push("Restrict yourself to these. Do NOT invent names not in this list.");
  if (classLines.length) {
    sectionsRendered.push("", "### Classes");
    sectionsRendered.push(...classLines);
  }
  if (typeLines.length) {
    sectionsRendered.push("", "### Interfaces / types");
    sectionsRendered.push(...typeLines);
  }
  if (funcLines.length) {
    sectionsRendered.push("", "### Functions / values");
    sectionsRendered.push(...funcLines);
  }
  if (testLines.length) {
    sectionsRendered.push("", "### Test names");
    sectionsRendered.push(...testLines);
  }
  sectionsRendered.push("", "If you cannot ground a section in these symbols, emit `(none)`.");

  const full = sectionsRendered.join("\n");
  return capByteLength(full, byteLimit);
}

/**
 * Truncate `text` (UTF-8) at the last newline at or before `byteLimit`,
 * appending `\n…(N more)` where N is the count of trailing lines dropped.
 */
function capByteLength(text: string, byteLimit: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= byteLimit) return text;

  // Reserve ~30 bytes for the `…(N more)` footer.
  const reserve = 30;
  const sliceLimit = Math.max(0, byteLimit - reserve);
  const head = buf.subarray(0, sliceLimit).toString("utf8");
  const lastNewline = head.lastIndexOf("\n");
  const truncated = lastNewline > 0 ? head.slice(0, lastNewline) : head;
  // Count remaining lines for the suffix.
  const totalLines = text.split("\n").length;
  const keptLines = truncated.split("\n").length;
  const dropped = Math.max(0, totalLines - keptLines);
  return `${truncated}\n…(${dropped} more)`;
}

/**
 * Predicate used by the post-validator: does `identifier` (which may be
 * `Foo`, `Foo.bar`, or a bare test-name string) appear in the vocabulary?
 */
export function vocabularyContains(vocab: SourceVocabulary, identifier: string): boolean {
  if (vocab.identifiers.has(identifier)) return true;
  if (vocab.methods.has(identifier)) return true;
  if (vocab.fields.has(identifier)) return true;
  if (vocab.testNames.has(identifier)) return true;
  // Allow `Foo` to match if `Foo` is the owner of any method/field.
  if (identifier.indexOf(".") === -1) {
    for (const m of vocab.methods) {
      if (m.startsWith(`${identifier}.`)) return true;
    }
    for (const f of vocab.fields) {
      if (f.startsWith(`${identifier}.`)) return true;
    }
  }
  return false;
}
