#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook: when a .ai-workspace/plans/*.json file is edited, run the
# deterministic ac-lint sweep against all plan files and surface findings via
# additionalContext. Fast path: exit silently if touched path is not a plan JSON.

input="$(cat)"

if [[ -z "$input" ]]; then
  echo "ac-lint-hook: empty stdin" >&2
  exit 1
fi

file_path="$(printf '%s' "$input" | node -e '
  let s = "";
  process.stdin.on("data", d => s += d);
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(s);
      process.stdout.write((j.tool_input && j.tool_input.file_path) || "");
    } catch (e) {
      process.stderr.write("ac-lint-hook: malformed stdin JSON\n");
      process.exit(2);
    }
  });
')"

norm="${file_path//\\//}"
norm="${norm#./}"

# Match ".ai-workspace/plans/*.json" anywhere in the path.
case "$norm" in
  *.ai-workspace/plans/*.json)
    ;;
  *)
    exit 0
    ;;
esac

project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"

if ! lint_output="$(cd "$project_dir" && node scripts/run-ac-lint.mjs 2>&1)"; then
  # Linter exited non-zero — still surface the output.
  :
fi

if [[ -z "${lint_output// /}" ]]; then
  exit 0
fi

# Emit findings as additionalContext. Encode via node to safely JSON-escape.
printf '%s' "$lint_output" | node -e '
  let s = "";
  process.stdin.on("data", d => s += d);
  process.stdin.on("end", () => {
    const msg = "ac-lint findings on plan files (surface these to the user before your next response):\n\n" + s;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: msg,
      }
    }));
  });
'
exit 0
