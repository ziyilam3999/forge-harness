#!/usr/bin/env node
// Merge forge MCP server config into ~/.claude/settings.json
// Usage: node scripts/setup-config.cjs <repo-root-path>

const fs = require("fs");
const path = require("path");
const os = require("os");

const repoRoot = process.argv[2];
if (!repoRoot) {
  console.error("ERROR: repo root path argument required.");
  console.error("Usage: node scripts/setup-config.cjs <repo-root>");
  process.exit(1);
}

const claudeDir = path.join(os.homedir(), ".claude");
const settingsPath = path.join(claudeDir, "settings.json");

// Ensure ~/.claude/ exists
if (!fs.existsSync(claudeDir)) {
  fs.mkdirSync(claudeDir, { recursive: true });
  console.error("setup-config: created ~/.claude/");
}

// Read existing settings or start fresh
let settings;
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, "utf-8");
  try {
    settings = JSON.parse(raw);
  } catch {
    console.error(
      "ERROR: ~/.claude/settings.json contains invalid JSON. Please fix it manually or delete it and re-run setup.sh."
    );
    process.exit(1);
  }
} else {
  settings = {};
  console.error("setup-config: creating new ~/.claude/settings.json");
}

// Merge forge MCP server entry
if (!settings.mcpServers) {
  settings.mcpServers = {};
}

// Resolve to absolute path and normalize to forward slashes
const normalizedRoot = path.resolve(repoRoot).replace(/\\/g, "/");

settings.mcpServers.forge = {
  command: "node",
  args: ["dist/index.js"],
  cwd: normalizedRoot,
};

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.error(
  `setup-config: registered forge MCP server (cwd: ${normalizedRoot})`
);
