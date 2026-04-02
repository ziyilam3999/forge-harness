#!/usr/bin/env bash
# Forge Harness setup — registers the MCP server in Claude Code
# Requires: Git Bash or MSYS2 on Windows, Node.js 20+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "forge setup: repo root = $SCRIPT_DIR"

# Install dependencies if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "forge setup: installing dependencies..."
  (cd "$SCRIPT_DIR" && npm install)
fi

# Build TypeScript
echo "forge setup: compiling TypeScript..."
(cd "$SCRIPT_DIR" && npx tsc)

# Register MCP server in Claude Code settings
echo "forge setup: registering MCP server..."
node "$SCRIPT_DIR/scripts/setup-config.cjs" "$SCRIPT_DIR"

echo "forge setup: done. Restart Claude Code to pick up the forge tools."
