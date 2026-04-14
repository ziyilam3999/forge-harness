#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook: when a prompt-rule source file is edited, direct Claude to
# re-run forge_evaluate in critic mode against every plan file before its next
# response. Fast path: exit silently if the touched path is not in the allowlist.

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

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "A prompt-rule source file was just edited. Before producing your next response, you MUST invoke mcp__forge__forge_evaluate in critic mode against every .ai-workspace/plans/*.json file in this repo to detect drift between the updated rule set and existing plans. Surface all findings inline. Do not defer this to a later turn."
  }
}
JSON
exit 0
