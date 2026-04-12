#!/usr/bin/env bash
set -euo pipefail

ANCHOR_PATH="${1:-.ai-workspace/q0-l4-anchor.json}"
MERGE_SHA="${2:?merge sha required}"
MERGED_AT="${3:?merged-at ISO-8601 required}"

if [ ! -f "$ANCHOR_PATH" ]; then
  echo "error: anchor file not found at $ANCHOR_PATH" >&2
  exit 1
fi

CURRENT_FILL_MODE=$(jq -r '.q0FillMode // "workflow-fill"' "$ANCHOR_PATH")
CURRENT_MERGED_AT=$(jq -r '.q0MergedAt' "$ANCHOR_PATH")

if [ "$CURRENT_FILL_MODE" = "bootstrap" ]; then
  echo "skipped: fill mode is bootstrap — no-op" >&2
  exit 0
fi

if [ "$CURRENT_MERGED_AT" != "PENDING" ]; then
  echo "skipped: q0MergedAt is already $CURRENT_MERGED_AT — no-op" >&2
  exit 0
fi

jq --arg sha "$MERGE_SHA" --arg at "$MERGED_AT" \
  '.q0MergeSha = $sha | .q0MergedAt = $at' \
  "$ANCHOR_PATH" > "${ANCHOR_PATH}.tmp"
mv "${ANCHOR_PATH}.tmp" "$ANCHOR_PATH"

echo "filled: q0MergeSha=$MERGE_SHA, q0MergedAt=$MERGED_AT"
