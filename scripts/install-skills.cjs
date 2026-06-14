#!/usr/bin/env node
// Install the forge-harness bundled skills into the user's global Claude Code
// skills directory so they are available in every project.
//
// Today this installs the `/prd` skill. The destination is the GLOBAL skills
// dir (`~/.claude/skills/`), derived from os.homedir() — never a hardcoded
// home path — so `/prd` works in every Claude Code session after one install.
//
// Idempotency policy: BACKUP-THEN-OVERWRITE. If a `prd` skill already exists at
// the destination, the existing directory is moved aside to a timestamped backup
// (`~/.claude/skills/_prd-backup-YYYYMMDD-HHMMSS/`, mv-not-rm — recoverable) and
// the bundled version is copied in fresh. This keeps the bundled skill
// authoritative after every setup.sh run while never destroying a prior install.
//
// Usage: node scripts/install-skills.cjs [<repo-root-path>]
//   repo-root-path defaults to the parent dir of this script.

const fs = require("fs");
const path = require("path");
const os = require("os");

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));

// Skills bundled in this repo that get installed globally. Add new entries here
// as more skills are bundled.
const SKILLS = ["prd"];

const skillsSrcRoot = path.join(repoRoot, "skills");
const skillsDestRoot = path.join(os.homedir(), ".claude", "skills");

function timestamp() {
  // YYYYMMDD-HHMMSS in local time, zero-padded.
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function installSkill(name) {
  const src = path.join(skillsSrcRoot, name);
  if (!fs.existsSync(path.join(src, "SKILL.md"))) {
    console.error(
      `install-skills: ERROR — bundled skill '${name}' not found at ${src} (missing SKILL.md). Did the clone complete?`
    );
    process.exit(1);
  }

  fs.mkdirSync(skillsDestRoot, { recursive: true });
  const dest = path.join(skillsDestRoot, name);

  // Backup-then-overwrite: if a prior install exists, move it aside (mv-not-rm).
  if (fs.existsSync(dest)) {
    const backup = path.join(skillsDestRoot, `_${name}-backup-${timestamp()}`);
    fs.renameSync(dest, backup);
    console.error(
      `install-skills: existing '${name}' skill backed up to ${backup}`
    );
  }

  // Copy (not symlink): a public user's clone may move or disappear, and a
  // dangling symlink would silently break the skill.
  fs.cpSync(src, dest, { recursive: true });
  console.error(`install-skills: installed '/${name}' skill → ${dest} ✓`);
}

for (const name of SKILLS) {
  installSkill(name);
}

console.error(
  "install-skills: done. Restart Claude Code so the skill(s) are picked up."
);
process.exit(0);
