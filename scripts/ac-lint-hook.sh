#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook: when a .ai-workspace/plans/*.json file is edited, run the
# deterministic ac-lint sweep and surface findings via additionalContext.
# Fast path: exit silently if touched path is not a plan JSON.
#
# Q0.5/C1 polish pass (PR #183): E1+E5 (glob anchoring), E2 (whitespace strip),
# E4 (script-location-derived root, CLAUDE_PROJECT_DIR override kept for tests),
# M1 (explicit parse-failure diagnostic), M2 (linter-crashed additionalContext).
# E3 (single-file lint passthrough) is deferred pending scripts/run-ac-lint.mjs
# single-file support — see follow-up PR.

emit_additional_context() {
  # Emit a Claude Code PostToolUse additionalContext JSON to stdout.
  # Reads the context body from stdin so bodies with special chars are
  # JSON-escaped safely via node.
  node -e '
    let s = "";
    process.stdin.on("data", d => s += d);
    process.stdin.on("end", () => {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: s,
        }
      }));
    });
  '
}

input="$(cat)"

if [[ -z "$input" ]]; then
  echo "ac-lint-hook: empty stdin" >&2
  exit 1
fi

# M1: capture the node -e parser's exit status explicitly. Under set -e, a
# non-zero exit inside a command substitution aborts the script without a
# diagnostic — the explicit check ensures the user sees "stdin parse failed"
# even though the node script itself already writes its own stderr message.
set +e
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
parse_rc=$?
set -e
if [[ $parse_rc -ne 0 ]]; then
  echo "ac-lint-hook: stdin parse failed (rc=$parse_rc)" >&2
  exit $parse_rc
fi

# Normalize backslashes to forward slashes for Windows MSYS bash.
norm="${file_path//\\//}"

# E1+E5: anchor the glob properly. The old `*.ai-workspace/plans/*.json`
# pattern matched `foo.ai-workspace/plans/bar.json`. Accept only paths that
# either start with `.ai-workspace/plans/` (relative) or contain
# `/.ai-workspace/plans/` (absolute / nested). The `./`-strip line is gone.
case "$norm" in
  .ai-workspace/plans/*.json|*/.ai-workspace/plans/*.json)
    ;;
  *)
    exit 0
    ;;
esac

# E4: derive project root from the script location. CLAUDE_PROJECT_DIR remains
# honored as an intentional override so tests can redirect to a sandbox, but
# the fallback no longer trusts $(pwd) — which could point at the wrong repo
# when the hook is invoked from a nested directory.
project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

# M2: capture lint exit status explicitly. On non-zero exit, surface a
# "linter crashed" additionalContext so the session author sees the failure
# instead of the old `if ! ...; then :; fi` silent swallow.
set +e
lint_output="$(cd "$project_dir" && node scripts/run-ac-lint.mjs 2>&1)"
lint_rc=$?
set -e

if [[ $lint_rc -ne 0 ]]; then
  printf '%s' "ac-lint findings on plan files (surface these to the user before your next response):

linter crashed (exit=$lint_rc):
$lint_output" | emit_additional_context
  exit 0
fi

# E2: treat ALL whitespace (spaces, newlines, tabs) as "empty". The old
# `${lint_output// /}` stripped spaces only, so a trailing `\n` from the
# linter would defeat the empty-check and emit a directive with empty body.
stripped="${lint_output//[[:space:]]/}"
if [[ -z "$stripped" ]]; then
  exit 0
fi

# Dirty path: emit findings as additionalContext.
printf '%s' "ac-lint findings on plan files (surface these to the user before your next response):

$lint_output" | emit_additional_context
exit 0
