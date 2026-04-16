#!/bin/bash
# scripts/lib/hook-helpers.sh
#
# Shared helpers for Claude Code PostToolUse hook scripts.
#
# Sourced (not executed) from scripts/*-hook.sh. Do NOT add `set -euo pipefail`
# here — callers own their own error-handling mode. Do NOT rely on this file
# being invoked directly; it exists purely to expose helper functions to the
# caller's shell.
#
# Primary function: emit_additional_context
#   - Reads the additionalContext body from stdin.
#   - Emits a Claude Code PostToolUse hookSpecificOutput JSON object to stdout,
#     with the body safely JSON-escaped via node's JSON.stringify.
#   - Extracted from ac-lint-hook.sh to share the JSON-safe emission path with
#     retroactive-critique-hook.sh, whose prior literal heredoc would silently
#     produce malformed JSON if the directive ever interpolated a path or rule
#     name. See issue #186.

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
