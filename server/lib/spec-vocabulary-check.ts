import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Spec-vocabulary-drift detection (F-03 secondary).
 *
 * Mechanical check that PRD backtick-quoted `TypeName.fieldName` references
 * match the actual TypeScript interface/type declarations in source files.
 *
 * Multi-root walker: covers both server/types/ (pure type modules) and
 * server/lib/ (co-located types like RunRecord) to avoid structural blind
 * spots. See PH-04 US-05 description for rationale.
 *
 * Known limitation: nested references (e.g. `RunRecord.metrics.estimatedCostUsd`)
 * only verify the top-level field (`metrics`). Verifying nested paths requires
 * walking the type alias graph and is deferred.
 */

export interface TypeRef {
  type: string;
  field: string;
  line: number;
}

export interface DriftResult {
  type: string;
  field: string;
  line: number;
  kind: "unknown-type" | "unknown-field";
}

/**
 * Walk every .ts file (excluding *.test.ts) under each provided source root
 * recursively. Build a Map<TypeName, Set<FieldName>> from interface and type
 * alias declarations.
 */
export async function parseTypeDefinitions(sourceDirs: ReadonlyArray<string>): Promise<Map<string, Set<string>>> {
  const typeMap = new Map<string, Set<string>>();

  for (const dir of sourceDirs) {
    const files = await collectTsFiles(dir);
    for (const filePath of files) {
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        continue;
      }
      extractTypesFromSource(content, typeMap);
    }
  }

  return typeMap;
}

async function collectTsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  for (const name of entries) {
    const fullPath = join(dir, name);
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      results.push(fullPath);
    } else if (!name.includes(".")) {
      // Likely a directory — recurse (readdir will fail gracefully if not)
      results.push(...(await collectTsFiles(fullPath)));
    }
  }

  return results;
}

/**
 * Parse interface and type alias declarations from TypeScript source text.
 * Regex-based — interface field syntax is regular enough for this purpose.
 */
function extractTypesFromSource(source: string, typeMap: Map<string, Set<string>>): void {
  const blockRegex = /(?:export\s+)?(?:interface|type)\s+([A-Z][A-Za-z0-9]*)\s*(?:=\s*)?\{/g;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(source)) !== null) {
    const typeName = match[1];
    const startIndex = match.index + match[0].length;
    const fields = extractFieldsFromBlock(source, startIndex);

    const existing = typeMap.get(typeName);
    if (existing) {
      for (const f of fields) existing.add(f);
    } else {
      typeMap.set(typeName, new Set(fields));
    }
  }
}

/**
 * Extract field names from a TypeScript block body starting after `{`.
 * Tracks brace depth line-by-line. A field is extracted when the line starts
 * at depth 1 (even if the line itself contains `{` for an inline object type).
 */
function extractFieldsFromBlock(source: string, startIndex: number): string[] {
  const fields: string[] = [];
  let depth = 1;
  let i = startIndex;

  while (i < source.length && depth > 0) {
    const newlineIdx = source.indexOf("\n", i);
    const lineEnd = newlineIdx === -1 ? source.length : newlineIdx;
    const line = source.slice(i, lineEnd).trim();

    // Extract field at current depth (before processing braces on this line)
    if (depth === 1 && line.length > 0) {
      const fieldMatch = line.match(
        /^(?:readonly\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[?]?\s*:/,
      );
      if (fieldMatch) {
        fields.push(fieldMatch[1]);
      }
    }

    // Update depth by counting braces on this line
    for (let j = i; j < lineEnd; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") {
        depth--;
        if (depth === 0) return fields;
      }
    }

    i = lineEnd + 1;
  }

  return fields;
}

/**
 * Scan PRD/markdown content for backtick-quoted `TypeName.fieldName` patterns.
 * Field must start with lowercase (camelCase) — PascalCase after the dot
 * indicates a sub-type reference (e.g. `MasterPlan.Phase`), not a field.
 */
export function extractTypeReferences(content: string): ReadonlyArray<TypeRef> {
  const refs: TypeRef[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const regex = /`([A-Z][A-Za-z0-9]*)\.([a-z_$][a-zA-Z0-9_$]*)(?:\.[^`]*)?`/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(lines[i])) !== null) {
      refs.push({ type: m[1], field: m[2], line: i + 1 });
    }
  }

  return refs;
}

/**
 * File-path based entry point: reads PRD from disk, then checks vocabulary.
 */
export async function verifySpecVocabulary(prdPath: string, sourceDirs: ReadonlyArray<string>): Promise<ReadonlyArray<DriftResult>> {
  let prdContent: string;
  try {
    prdContent = await readFile(prdPath, "utf-8");
  } catch (err) {
    console.error(
      `forge: spec-vocabulary-check: failed to read PRD at ${prdPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  return verifySpecVocabularyFromContent(prdContent, sourceDirs);
}

/**
 * Content-based variant for when PRD text is already in memory
 * (e.g., coherence eval receives prdContent inline).
 */
export async function verifySpecVocabularyFromContent(prdContent: string, sourceDirs: ReadonlyArray<string>): Promise<ReadonlyArray<DriftResult>> {
  const typeMap = await parseTypeDefinitions(sourceDirs);
  const refs = extractTypeReferences(prdContent);
  const results: DriftResult[] = [];

  for (const ref of refs) {
    const fields = typeMap.get(ref.type);
    if (!fields) {
      results.push({ type: ref.type, field: ref.field, line: ref.line, kind: "unknown-type" });
    } else if (!fields.has(ref.field)) {
      results.push({ type: ref.type, field: ref.field, line: ref.line, kind: "unknown-field" });
    }
  }

  return results;
}
