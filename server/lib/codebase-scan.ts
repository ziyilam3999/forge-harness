import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/** Maximum character count for scanner output (~4000 tokens at 4:1 ratio). Tunable. */
export const SCANNER_CHAR_CAP = 16_000;

/** Maximum directory recursion depth. Tunable. */
const MAX_DEPTH = 4;

/** Directories to skip during scan. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".ai-workspace",
  ".forge",
  "__pycache__",
  ".next",
  "coverage",
]);

/** Key files to read contents of (first 100 lines each). */
const KEY_FILES = ["package.json", "tsconfig.json", "README.md"];

/**
 * Normalize path separators to forward slashes (Windows compat).
 */
function toSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Recursively list directory contents up to MAX_DEPTH.
 */
async function listDir(
  dir: string,
  rootDir: string,
  depth: number,
  lines: string[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Permission denied or other error — skip silently
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = toSlash(relative(rootDir, fullPath));
    const indent = "  ".repeat(depth);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      lines.push(`${indent}${relPath}/`);
      await listDir(fullPath, rootDir, depth + 1, lines);
    } else {
      lines.push(`${indent}${relPath}`);
    }
  }
}

/**
 * Read first N lines of a file, returning empty string if not found.
 */
async function readHead(filePath: string, maxLines: number): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.split("\n").slice(0, maxLines).join("\n");
  } catch {
    return "";
  }
}

/**
 * Extract dependency names and versions from package.json as structured data.
 * Returns a formatted section or null if package.json doesn't exist.
 */
async function extractDependencies(projectPath: string): Promise<string | null> {
  try {
    const content = await readFile(join(projectPath, "package.json"), "utf-8");
    const pkg = JSON.parse(content);
    const lines: string[] = [];

    lines.push(`## package.json`);
    if (pkg.name) lines.push(`name: ${pkg.name}`);
    if (pkg.version) lines.push(`version: ${pkg.version}`);

    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      lines.push(`\ndependencies:`);
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        lines.push(`  ${name}: ${version}`);
      }
    }

    if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
      lines.push(`\ndevDependencies:`);
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        lines.push(`  ${name}: ${version}`);
      }
    }

    if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
      lines.push(`\nscripts:`);
      for (const [name, cmd] of Object.entries(pkg.scripts)) {
        lines.push(`  ${name}: ${cmd}`);
      }
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}

/**
 * Scan a project directory and return a text summary for LLM context.
 *
 * @param projectPath - Absolute path to the project root
 * @returns Text summary capped at SCANNER_CHAR_CAP characters
 * @throws If projectPath doesn't exist or isn't a directory
 */
export async function scanCodebase(projectPath: string): Promise<string> {
  // Validate projectPath
  let stats;
  try {
    stats = await stat(projectPath);
  } catch {
    throw new Error(
      `projectPath "${projectPath}" does not exist or is not accessible.`,
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(`projectPath "${projectPath}" is not a directory.`);
  }

  const sections: string[] = [];

  // 1. Directory listing
  const dirLines: string[] = [];
  await listDir(projectPath, projectPath, 0, dirLines);
  sections.push("## Directory Structure\n```\n" + dirLines.join("\n") + "\n```");

  // 2. Structured dependency extraction from package.json
  const depSection = await extractDependencies(projectPath);
  if (depSection) {
    sections.push(depSection);
  }

  // 3. Key file contents (excluding package.json — already extracted above)
  for (const fileName of KEY_FILES) {
    if (fileName === "package.json" && depSection) continue;
    const content = await readHead(join(projectPath, fileName), 100);
    if (content) {
      sections.push(
        `## ${fileName}\n\`\`\`\n${content}\n\`\`\``,
      );
    }
  }

  let output = sections.join("\n\n");

  // 4. Truncate to cap
  if (output.length > SCANNER_CHAR_CAP) {
    output = output.slice(0, SCANNER_CHAR_CAP) + "\n[truncated]";
  }

  return output;
}
