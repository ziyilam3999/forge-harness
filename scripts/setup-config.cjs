#!/usr/bin/env node
// Register forge MCP server for Claude Code.
//
// Primary path: shell out to `claude mcp add forge -s user ...`, which writes to
// `~/.claude.json` (Claude Code's canonical user-scope MCP config path).
//
// Fallback path: when `claude` CLI is not on PATH, atomically write directly to
// `~/.claude.json` top-level `mcpServers.forge`. Preserves all other keys.
//
// Migration warnings: emits (but does NOT delete) notices when pre-v0.32.5 stale
// config surfaces are present:
//   - `~/.claude/settings.json.mcpServers.forge` (dead-letter — Claude Code never read it)
//   - `~/.claude/mcp.json` (inert — Claude Code reads `~/.claude.json` not `~/.claude/mcp.json`)
//
// Usage: node scripts/setup-config.cjs <repo-root-path>

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const repoRoot = process.argv[2];
if (!repoRoot) {
  console.error("ERROR: repo root path argument required.");
  console.error("Usage: node scripts/setup-config.cjs <repo-root>");
  process.exit(1);
}

const normalizedRoot = path.resolve(repoRoot).replace(/\\/g, "/");
const distIndex = normalizedRoot + "/dist/index.js";

if (!fs.existsSync(distIndex)) {
  console.error(`ERROR: ${distIndex} does not exist.`);
  console.error("Did you forget to run `npm run build`? The MCP server entry point must exist before registration.");
  process.exit(1);
}

emitMigrationWarnings();

const primaryOk = tryClaudeMcpAdd(distIndex);
if (primaryOk) {
  console.error(`setup-config: registered forge via \`claude mcp add -s user\` ✓ (entry: ${distIndex})`);
  process.exit(0);
}

// Fallback path — claude CLI not on PATH or failed.
fallbackDirectWrite(distIndex);
console.error(`setup-config: registered forge via direct ~/.claude.json write ✓ (entry: ${distIndex})`);
console.error("setup-config: note — claude CLI was unavailable, so we wrote the config directly. If you later install the CLI, re-run setup.sh to let it manage the entry.");
process.exit(0);

function tryClaudeMcpAdd(distIndexAbs) {
  const probeSpawn = spawnClaude(["--version"]);
  if (!probeSpawn.available) {
    return false;
  }

  // Idempotency: remove any existing user-scope entry first. Ignore "not found" errors.
  spawnClaude(["mcp", "remove", "forge", "-s", "user"]);

  const add = spawnClaude([
    "mcp",
    "add",
    "forge",
    "node",
    "-s",
    "user",
    "-e",
    "FORGE_DASHBOARD_AUTO_OPEN=1",
    "--",
    distIndexAbs,
  ]);
  if (!add.available || add.result.status !== 0) {
    const stderr = add.result && add.result.stderr ? add.result.stderr.toString() : "(no stderr)";
    console.error("setup-config: WARNING — `claude mcp add` failed. Falling back to direct write.");
    console.error("setup-config: claude stderr:", stderr.trim());
    return false;
  }
  return true;
}

// Spawn the claude CLI with args. Handles Windows `.cmd` shim via shell: true.
// Returns { available: boolean, result: SpawnSyncResult | null }.
// `available: false` means the binary was not found on PATH (ENOENT).
function spawnClaude(args) {
  const result = spawnSync("claude", args, {
    encoding: "utf-8",
    shell: process.platform === "win32",
  });
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, result };
  }
  // On Windows with shell:true, ENOENT surfaces differently — a non-zero exit
  // and stderr like "'claude' is not recognized..." Treat that as unavailable too.
  if (process.platform === "win32" && result.status !== 0 && result.stderr) {
    const stderr = result.stderr.toString();
    if (stderr.includes("not recognized") || stderr.includes("command not found")) {
      return { available: false, result };
    }
  }
  return { available: true, result };
}

function fallbackDirectWrite(distIndexAbs) {
  const configPath = path.join(os.homedir(), ".claude.json");
  let config = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    try {
      config = JSON.parse(raw);
    } catch {
      console.error(`ERROR: ${configPath} contains invalid JSON. Fix or remove it and re-run setup.sh.`);
      process.exit(1);
    }
  }
  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }
  config.mcpServers.forge = {
    type: "stdio",
    command: "node",
    args: [distIndexAbs],
    env: { FORGE_DASHBOARD_AUTO_OPEN: "1" },
  };

  // Atomic write: tempfile + rename. Rename on Windows replaces the target atomically
  // when both paths are on the same filesystem (always true here — same dir).
  const tmpPath = configPath + ".tmp-" + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmpPath, configPath);
}

function emitMigrationWarnings() {
  const home = os.homedir();

  const staleSettings = path.join(home, ".claude", "settings.json");
  if (fs.existsSync(staleSettings)) {
    try {
      const raw = fs.readFileSync(staleSettings, "utf-8");
      const data = JSON.parse(raw);
      if (data && data.mcpServers && data.mcpServers.forge) {
        console.error(
          "setup-config: WARNING — ~/.claude/settings.json contains a `mcpServers.forge` entry from a pre-v0.32.5 setup. This path is INERT (Claude Code does not read mcpServers from settings.json). You can remove the `mcpServers` key manually; leave the rest of the file alone. Not auto-deleted."
        );
      }
    } catch {
      // settings.json is not valid JSON or unreadable; not our concern here, skip warning.
    }
  }

  const strayMcp = path.join(home, ".claude", "mcp.json");
  if (fs.existsSync(strayMcp)) {
    console.error(
      "setup-config: WARNING — ~/.claude/mcp.json exists. This path is INERT (Claude Code reads ~/.claude.json, not ~/.claude/mcp.json). If it only contains a forge entry, you can delete it manually; if it has other entries, verify whether your MCP client (not Claude Code) needs it. Not auto-deleted."
    );
  }
}
