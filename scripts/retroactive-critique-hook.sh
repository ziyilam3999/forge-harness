#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook: when a prompt-rule source file is edited, direct Claude to
# re-run forge_evaluate in critic mode against every plan file before its next
# response. Fast path: exit silently if the touched path is not in the allowlist.
#
# De-dup: hashes matched allowlist files and skips if unchanged since last fire
# in this session (tracked via /tmp/forge-critique-<session>-last-hash).
#
# 401 fallback: if MCP auth fails, the directive tells Claude to produce
# {findings: [...]} in-session rather than fail-closed. The contract is the
# JSON output schema, not the MCP call site.

input="$(cat)"

if [[ -z "$input" ]]; then
  echo "retroactive-critique-hook: empty stdin" >&2
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
      process.stderr.write("retroactive-critique-hook: malformed stdin JSON\n");
      process.exit(2);
    }
  });
')"

# Normalize path separators and strip leading ./ for suffix matching
norm="${file_path//\\//}"
norm="${norm#./}"

allowlist=(
  "server/lib/prompts/critic.ts"
  "server/lib/prompts/planner.ts"
  "server/lib/prompts/shared/ac-subprocess-rules.ts"
  "server/validation/ac-lint.ts"
)

matched=0
for rule in "${allowlist[@]}"; do
  if [[ "$norm" == "$rule" || "$norm" == */"$rule" ]]; then
    matched=1
    break
  fi
done

if [[ "$matched" -eq 0 ]]; then
  exit 0
fi

# --- De-dup: skip if allowlist file contents are unchanged since last fire ---
# Resolve the repo root so we hash absolute paths regardless of cwd.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
content_hash=""
for f in "${allowlist[@]}"; do
  abs="${repo_root}/${f}"
  if [[ -f "$abs" ]]; then
    content_hash+="$(md5sum "$abs" 2>/dev/null | cut -d' ' -f1)"
  fi
done
content_hash="$(printf '%s' "$content_hash" | md5sum | cut -d' ' -f1)"

session_id="${CLAUDE_SESSION_ID:-${MAILBOX_SESSION_ID:-default}}"
hash_file="/tmp/forge-critique-${session_id}-last-hash"

if [[ -f "$hash_file" ]] && [[ "$(cat "$hash_file")" == "$content_hash" ]]; then
  # Allowlist files unchanged since last fire — skip to avoid duplicate findings
  exit 0
fi
printf '%s' "$content_hash" > "$hash_file"

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "A prompt-rule source file was just edited. Before producing your next response, you MUST invoke mcp__forge__forge_evaluate in critic mode against every .ai-workspace/plans/*.json file in this repo to detect drift between the updated rule set and existing plans. Surface all findings inline. Do not defer this to a later turn.\n\nIMPORTANT — 401/auth fallback: if the mcp__forge__forge_evaluate call fails with HTTP 401, OAuth error, or any authentication failure, DO NOT retry or abort. Instead, perform the critique in-session: read each .ai-workspace/plans/*.json file, apply the updated prompt-rule set manually, and produce a well-formed JSON object matching the MCP output schema: {\"findings\": [{\"acId\": \"...\", \"severity\": \"error|warning|info\", \"message\": \"...\", \"file\": \"...\", \"line\": null}]}. The contract is the output schema, not the call site."
  }
}
JSON
exit 0
