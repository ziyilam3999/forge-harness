#!/usr/bin/env bash
# Acceptance wrapper for the v0.32.5 setup-config MCP-registration fix.
# Plan: .ai-workspace/plans/2026-04-19-setup-config-mcp-registration-fix.md
# AC-1..AC-10 are checked against an isolated scratch HOME so the reviewer's
# real ~/.claude.json is never touched.
#
# Exit 0 iff all AC pass. Designed for CI + local Git Bash / MSYS2.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# ---------- Scratch HOME setup (bridges Git Bash / MSYS path mismatch) ----------
# Git Bash's /tmp maps to $USERPROFILE/AppData/Local/Temp, which Node sees as
# a Windows path. Use `cygpath -m` so HOME/USERPROFILE carry a form both
# cmd.exe-invoked claude.cmd AND node can resolve consistently.

SCRATCH_MSYS="$(mktemp -d -t forge-setup-config-XXXXXX)"
if command -v cygpath >/dev/null 2>&1; then
  SCRATCH_WIN="$(cygpath -m "$SCRATCH_MSYS")"
else
  SCRATCH_WIN="$SCRATCH_MSYS"
fi

cleanup() {
  # Best-effort cleanup. Try to remove the user-scope forge registration from
  # the scratch config too, in case the primary path wrote it there.
  HOME="$SCRATCH_WIN" USERPROFILE="$SCRATCH_WIN" \
    claude mcp remove forge -s user >/dev/null 2>&1 || true
  rm -rf "$SCRATCH_MSYS"
}
trap cleanup EXIT

FAIL=0
PASS_COUNT=0

ok() { echo "  ✓ $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "  ✗ $1"; FAIL=1; }

ac() { echo; echo "=== $1 ==="; }

# ---------- Pre-flight ----------
ac "Pre-flight"
if [ ! -f "$REPO_ROOT/dist/index.js" ]; then
  echo "  ! dist/index.js not found — running npm run build..."
  npm run build >/dev/null 2>&1
fi
[ -f "$REPO_ROOT/dist/index.js" ] && ok "dist/index.js exists" || fail "dist/index.js missing after build"

# Expected absolute path for dist/index.js (forward-slash Windows form).
EXPECTED_DIST="$(cygpath -m "$REPO_ROOT/dist/index.js" 2>/dev/null || echo "$REPO_ROOT/dist/index.js")"

# ---------- AC-1 — primary path writes canonical shape ----------
ac "AC-1 — primary path shape"
rm -rf "$SCRATCH_MSYS"/.claude* 2>/dev/null || true
# scratch HOME must exist, but .claude.json absent so setup-config's primary path runs clean
mkdir -p "$SCRATCH_MSYS"

HOME="$SCRATCH_WIN" USERPROFILE="$SCRATCH_WIN" \
  node "$REPO_ROOT/scripts/setup-config.cjs" "$REPO_ROOT" >/dev/null 2>"$SCRATCH_MSYS/stderr-1.log" || {
    echo "  ! setup-config.cjs exited non-zero"
    cat "$SCRATCH_MSYS/stderr-1.log"
    fail "AC-1 setup-config.cjs exited non-zero"
  }

AC1_JSON="$SCRATCH_MSYS/.claude.json"
if [ ! -f "$AC1_JSON" ]; then
  fail "AC-1 ~/.claude.json was not created"
else
  # Verify shape via node.
  SHAPE_OK=$(node -e '
    const fs = require("fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
    const e = d.mcpServers && d.mcpServers.forge;
    if (!e) { console.log("no-forge-entry"); process.exit(0); }
    const ok =
      e.command === "node" &&
      Array.isArray(e.args) && e.args.length === 1 &&
      e.args[0].endsWith("/dist/index.js") &&
      e.env && e.env.FORGE_DASHBOARD_AUTO_OPEN === "1" &&
      e.type === "stdio";
    console.log(ok ? "ok" : "bad-shape:" + JSON.stringify(e));
  ' "$AC1_JSON")
  [ "$SHAPE_OK" = "ok" ] && ok "AC-1 entry shape correct" || fail "AC-1 shape check: $SHAPE_OK"
fi

# ---------- AC-2 — args[0] resolves to a real file ----------
ac "AC-2 — args[0] resolves"
if [ -f "$AC1_JSON" ]; then
  ARGS_PATH=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log(d.mcpServers.forge.args[0]);' "$AC1_JSON")
  if [ -f "$ARGS_PATH" ]; then
    ok "AC-2 args[0] '$ARGS_PATH' exists"
  else
    fail "AC-2 args[0] '$ARGS_PATH' does not exist on disk"
  fi
fi

# ---------- AC-3 — idempotent re-run ----------
ac "AC-3 — idempotency"
if [ -f "$AC1_JSON" ]; then
  FIRST_HASH=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log(JSON.stringify(d.mcpServers.forge));' "$AC1_JSON")
  HOME="$SCRATCH_WIN" USERPROFILE="$SCRATCH_WIN" \
    node "$REPO_ROOT/scripts/setup-config.cjs" "$REPO_ROOT" >/dev/null 2>"$SCRATCH_MSYS/stderr-3.log" || fail "AC-3 second run exited non-zero"
  SECOND_HASH=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log(JSON.stringify(d.mcpServers.forge));' "$AC1_JSON")
  [ "$FIRST_HASH" = "$SECOND_HASH" ] && ok "AC-3 forge entry identical across runs" || fail "AC-3 entry drifted: first=$FIRST_HASH second=$SECOND_HASH"
fi

# ---------- AC-4 — fallback path when claude CLI missing ----------
ac "AC-4 — fallback path (no claude CLI)"
SCRATCH2_MSYS="$(mktemp -d -t forge-setup-config-fallback-XXXXXX)"
SCRATCH2_WIN=$(cygpath -m "$SCRATCH2_MSYS" 2>/dev/null || echo "$SCRATCH2_MSYS")

# Strip `claude` from PATH by keeping only the node dir (MSYS form) plus essential
# Windows system dirs (System32 for cmd.exe — node's spawnSync(shell:true) uses it).
# Use MSYS form (`/c/...`) so Git Bash's own command lookup resolves `node`; cmd.exe
# spawned by node will see the env PATH string and resolve via its own logic.
NODE_DIR="$(dirname "$(which node)")"
SYS32_MSYS=/c/Windows/System32
STRIPPED_PATH="$NODE_DIR:$SYS32_MSYS"

HOME="$SCRATCH2_WIN" USERPROFILE="$SCRATCH2_WIN" PATH="$STRIPPED_PATH" \
  node "$REPO_ROOT/scripts/setup-config.cjs" "$REPO_ROOT" >/dev/null 2>"$SCRATCH2_MSYS/stderr-4.log" || fail "AC-4 fallback exit non-zero"

AC4_JSON="$SCRATCH2_MSYS/.claude.json"
if [ -f "$AC4_JSON" ]; then
  SHAPE_OK=$(node -e '
    const fs = require("fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
    const e = d.mcpServers && d.mcpServers.forge;
    if (!e) { console.log("no-forge-entry"); process.exit(0); }
    const ok =
      e.command === "node" &&
      Array.isArray(e.args) && e.args.length === 1 &&
      e.args[0].endsWith("/dist/index.js") &&
      e.env && e.env.FORGE_DASHBOARD_AUTO_OPEN === "1";
    console.log(ok ? "ok" : "bad-shape:" + JSON.stringify(e));
  ' "$AC4_JSON")
  [ "$SHAPE_OK" = "ok" ] && ok "AC-4 fallback wrote correct shape" || fail "AC-4 fallback shape: $SHAPE_OK"

  if grep -q "claude CLI" "$SCRATCH2_MSYS/stderr-4.log"; then
    ok "AC-4 stderr mentions 'claude CLI' (fallback acknowledged)"
  else
    fail "AC-4 stderr did not mention fallback"
    echo "    stderr was:"; sed 's/^/      /' "$SCRATCH2_MSYS/stderr-4.log"
  fi
else
  fail "AC-4 ~/.claude.json not created in fallback mode"
fi
rm -rf "$SCRATCH2_MSYS"

# ---------- AC-5 + AC-6 + AC-7 — migration warnings (don't auto-delete) ----------
ac "AC-5/6/7 — migration warnings + no auto-delete"
SCRATCH3_MSYS="$(mktemp -d -t forge-setup-config-migrate-XXXXXX)"
SCRATCH3_WIN=$(cygpath -m "$SCRATCH3_MSYS" 2>/dev/null || echo "$SCRATCH3_MSYS")

# Pre-seed stale surfaces.
mkdir -p "$SCRATCH3_MSYS/.claude"
cat > "$SCRATCH3_MSYS/.claude/settings.json" <<'EOF'
{
  "mcpServers": {
    "forge": { "command": "node", "args": ["dist/index.js"], "cwd": "/stale" }
  },
  "someUserKey": "preserve-me"
}
EOF
cat > "$SCRATCH3_MSYS/.claude/mcp.json" <<'EOF'
{
  "mcpServers": {
    "forge": { "command": "node", "args": ["dist/index.js"] }
  }
}
EOF

# Hash files BEFORE the run so we can verify no-auto-delete.
SETTINGS_BEFORE=$(node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"));' "$SCRATCH3_MSYS/.claude/settings.json")
MCP_BEFORE=$(node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"));' "$SCRATCH3_MSYS/.claude/mcp.json")

HOME="$SCRATCH3_WIN" USERPROFILE="$SCRATCH3_WIN" \
  node "$REPO_ROOT/scripts/setup-config.cjs" "$REPO_ROOT" >/dev/null 2>"$SCRATCH3_MSYS/stderr-migrate.log" || fail "AC-5/6/7 setup-config exit non-zero"

# AC-5: stderr mentions inert + settings.json
if grep -iq "inert" "$SCRATCH3_MSYS/stderr-migrate.log" && grep -q "settings.json" "$SCRATCH3_MSYS/stderr-migrate.log"; then
  ok "AC-5 migration warning for settings.json emitted"
else
  fail "AC-5 no migration warning for settings.json"
  echo "    stderr was:"; sed 's/^/      /' "$SCRATCH3_MSYS/stderr-migrate.log"
fi

# AC-6: stderr mentions inert + mcp.json
if grep -iq "inert" "$SCRATCH3_MSYS/stderr-migrate.log" && grep -q "mcp.json" "$SCRATCH3_MSYS/stderr-migrate.log"; then
  ok "AC-6 migration warning for mcp.json emitted"
else
  fail "AC-6 no migration warning for mcp.json"
fi

# AC-7: both stale files unchanged
SETTINGS_AFTER=$(node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"));' "$SCRATCH3_MSYS/.claude/settings.json" 2>/dev/null || echo "MISSING")
MCP_AFTER=$(node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"));' "$SCRATCH3_MSYS/.claude/mcp.json" 2>/dev/null || echo "MISSING")

if [ "$SETTINGS_BEFORE" = "$SETTINGS_AFTER" ] && [ "$MCP_BEFORE" = "$MCP_AFTER" ]; then
  ok "AC-7 stale files preserved unchanged"
else
  fail "AC-7 stale files mutated (settings: $SETTINGS_BEFORE -> $SETTINGS_AFTER, mcp: $MCP_BEFORE -> $MCP_AFTER)"
fi
rm -rf "$SCRATCH3_MSYS"

# ---------- AC-8 — missing dist/index.js error ----------
ac "AC-8 — missing dist/index.js error"
SCRATCH4_MSYS="$(mktemp -d -t forge-setup-config-missing-dist-XXXXXX)"
SCRATCH4_WIN=$(cygpath -m "$SCRATCH4_MSYS" 2>/dev/null || echo "$SCRATCH4_MSYS")
# Use a fake repo root that has no dist/ dir.
FAKE_ROOT_MSYS="$SCRATCH4_MSYS/fake-repo"
mkdir -p "$FAKE_ROOT_MSYS"
FAKE_ROOT_WIN=$(cygpath -m "$FAKE_ROOT_MSYS" 2>/dev/null || echo "$FAKE_ROOT_MSYS")

set +e
HOME="$SCRATCH4_WIN" USERPROFILE="$SCRATCH4_WIN" \
  timeout 5 node "$REPO_ROOT/scripts/setup-config.cjs" "$FAKE_ROOT_WIN" >/dev/null 2>"$SCRATCH4_MSYS/stderr-8.log"
EXIT_8=$?
set -e

if [ "$EXIT_8" -ne 0 ] && grep -iq "build" "$SCRATCH4_MSYS/stderr-8.log"; then
  ok "AC-8 missing dist exits non-zero with build hint (exit=$EXIT_8)"
else
  fail "AC-8 expected non-zero exit + 'build' hint; got exit=$EXIT_8"
  echo "    stderr was:"; sed 's/^/      /' "$SCRATCH4_MSYS/stderr-8.log"
fi
rm -rf "$SCRATCH4_MSYS"

# ---------- AC-10 — setup.sh unchanged vs origin/master ----------
ac "AC-10 — setup.sh unchanged"
if git diff origin/master -- setup.sh 2>/dev/null | grep -q .; then
  fail "AC-10 setup.sh has diff vs origin/master"
  git diff origin/master -- setup.sh | sed 's/^/      /'
else
  ok "AC-10 setup.sh unchanged vs origin/master"
fi

# ---------- Summary ----------
echo
echo "=== Summary ==="
echo "  Passed: $PASS_COUNT checks"
if [ "$FAIL" -ne 0 ]; then
  echo "  FAIL — one or more AC failed."
  exit 1
fi
echo "  PASS — all AC green."
