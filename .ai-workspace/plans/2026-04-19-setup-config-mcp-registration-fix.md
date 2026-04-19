---
task: v0.32.5 — fix setup-config.cjs MCP registration path
status: drafting
owner: forge-plan
created: 2026-04-19
supersedes: none
---

## ELI5

When you run `./setup.sh` in forge-harness, it's supposed to tell Claude Code "hey, there's a tool called `forge` — please load it so the user can use it." It does this by writing a config file.

The problem: it's writing to the **wrong config file**. It writes to `~/.claude/settings.json`, but Claude Code never reads MCP server entries from there — it reads them from `~/.claude.json` (a different file, same-ish name). So every user who ran `./setup.sh` and then tried to use `forge` tools from a directory that isn't forge-harness itself got silently broken: Claude Code starts, reads the real config, sees no forge, and doesn't load the tools.

Monday ran into this today while building monday-bot. Her session's working directory is `monday-bot`, so she gets none of the forge tools despite having run `./setup.sh` cleanly.

The fix: rewrite `scripts/setup-config.cjs` to use the official CLI — `claude mcp add forge node -s user -e FORGE_DASHBOARD_AUTO_OPEN=1 -- <absolute-path-to-dist/index.js>` — which writes to the correct file (`~/.claude.json`). We also add a warning (not a delete) for the old stale entries so users know they can clean them up.

## Context

**Root cause verified on-disk** (see `~/.claude/agent-working-memory/tier-b/topics/infra-bugs/2026-04-19-forge-setup-sh-wrong-mcp-path.md` for the full blocker card and mailbox trail):

- Current `scripts/setup-config.cjs:50-56` writes `mcpServers.forge` to `~/.claude/settings.json`.
- Claude Code does NOT read `mcpServers` from that path (dead-letter). Confirmed: on the reporting machine, `~/.claude/settings.json` contains a `context7` MCP entry but `claude mcp list` also doesn't surface `context7`.
- Canonical user-scope MCP path is `~/.claude.json` top-level `mcpServers` key, written by `claude mcp add ... -s user`.
- A stray `~/.claude/mcp.json` exists on this machine with a `forge` entry (also inert — Claude Code doesn't read that path either). Authorship unclear; likely fallout from an older setup-config.cjs version.

**Why monday hit it and I didn't notice sooner:**

- Monday's session cwd is `monday-bot` → no project-scope `.mcp.json` → falls back to user-scope → user-scope is empty (`~/.claude.json.mcpServers = {}`) → forge tools silently missing.
- My session cwd is forge-harness itself → project-scope `.mcp.json` (TOFU) registers forge → I had access all along without realizing user-scope was broken.

**Key CLI finding (v2.1.114 of `claude`):**

- `claude mcp add` does NOT have a `--cwd` flag. The JSON it writes contains `{type, command, args, env}` only — no `cwd` field.
- Consequence: passing a relative arg like `dist/index.js` means Claude Code spawns `node dist/index.js` with some default cwd that is NOT the repo root. For users whose session cwd ≠ forge-harness, `dist/index.js` fails to resolve.
- **Fix: pass the absolute path** to `dist/index.js` as the positional arg. This sidesteps cwd entirely.
- Correction to prior sanctioned workaround: the `--cwd "..."` flag I mailed to monday on 2026-04-19T14:21Z is silently ignored by the current CLI. The follow-up mail must correct this.

**Idempotency:**

- `claude mcp add` errors "already exists" on re-add. Setup-config must `claude mcp remove forge -s user` first (ignoring "not found"), then `add`.

**Migration — the two stale surfaces, handled with warnings only, no auto-delete:**

- `~/.claude/settings.json.mcpServers.forge` — may exist on any machine that ran an older setup.sh. Inert. Warn user.
- `~/.claude/mcp.json` — may exist from some earlier attempt. Inert. Warn user.
- Rationale for no auto-delete: both files may contain user-authored entries we don't own (`context7`, etc.). Leave them alone; surface awareness, let the user decide.

**Fallback path — when `claude` CLI is not on PATH:**

- `claude` is a hard dep of running Claude Code, so PATH availability is near-guaranteed.
- Edge case: user installed claude via a method that didn't add the npm bin dir to PATH. For this case, fall back to direct atomic write of `~/.claude.json` top-level `mcpServers.forge` (write to temp, rename).
- Direct write is the second choice because it risks corrupting unrelated keys in `~/.claude.json` (~40 user-config keys); we mitigate by always read-parse-mutate-atomic-rename, never blind overwrite.

## Goal

After `./setup.sh` completes on a machine where monday-bot (or any non-forge-harness cwd) runs Claude Code:
1. `claude mcp list` shows `forge: node <abs-path>/dist/index.js - ✓ Connected`
2. The registered entry carries `FORGE_DASHBOARD_AUTO_OPEN=1` in its env block
3. A second run of `./setup.sh` succeeds (idempotent)
4. Any stale `~/.claude/settings.json.mcpServers.forge` or `~/.claude/mcp.json` triggers a visible migration warning to stderr but is **not** auto-deleted

## Binary AC

All ACs below are checkable by the wrapper at `scripts/setup-config-acceptance.sh` unless otherwise noted. The wrapper drives setup-config.cjs against an isolated scratch HOME (via `HOME=<tmp>` + `USERPROFILE=<tmp>`, both claude CLI v2.1.114 and node respect this — confirmed on 2026-04-19 during planning) so the reviewer's real `~/.claude.json` is never touched.

- **AC-1** — Running `node scripts/setup-config.cjs <repo-root>` against a scratch HOME with `claude` on PATH produces `<scratch>/.claude.json` containing `mcpServers.forge` with:
  - `command === "node"`
  - `args` is a one-element array whose value ends in `/dist/index.js` (absolute path)
  - `env.FORGE_DASHBOARD_AUTO_OPEN === "1"`
  - `type === "stdio"`
- **AC-2** — `args[0]` points to a file that exists on disk (the absolute path resolves).
- **AC-3** — Running setup-config twice in succession against the same scratch HOME both exit 0, and the resulting `mcpServers.forge` entry is identical to the single-run result (no duplication, no stale state).
- **AC-4** — Fallback path: running setup-config with `PATH` stripped of `claude` (simulated via `PATH=/nonexistent`) against a scratch HOME still produces a valid `<scratch>/.claude.json.mcpServers.forge` entry matching the AC-1 shape. Stderr contains the substring `claude CLI` acknowledging the fallback.
- **AC-5** — With `<scratch>/.claude/settings.json` pre-seeded containing `{"mcpServers":{"forge":{...}}}`, setup-config stderr contains the substring `inert` (case-insensitive) referring to settings.json.
- **AC-6** — With `<scratch>/.claude/mcp.json` pre-seeded, setup-config stderr contains the substring `inert` (case-insensitive) referring to mcp.json.
- **AC-7** — After AC-5 and AC-6 conditions both trigger, both pre-seeded files still exist on disk unchanged (no auto-delete).
- **AC-8** — If `<repo-root>/dist/index.js` does not exist, setup-config exits non-zero within 2 seconds and stderr contains the word `build` (hint to run `npm run build`).
- **AC-9** — `scripts/setup-config-acceptance.sh` exists, exits 0 when AC-1..AC-8 all pass, and leaves no files outside its scratch dir.
- **AC-10** — No changes to `setup.sh` itself — `diff origin/master -- setup.sh` is empty.

## Out of scope

- Refactoring `setup.sh` driver (only setup-config.cjs + new wrapper)
- Auto-deleting stale config files (`~/.claude/settings.json.mcpServers.forge` or `~/.claude/mcp.json`) — warnings only
- Modifying the existing project-scope `.mcp.json` file (forge-harness's local one already works)
- Tracking or generating the `.claude/worktrees/` / `.claude/settings.local.json` working-tree artifacts
- Changing the `claude` CLI version constraint (accept whatever is on PATH at v2.0+)
- Documenting non-Claude-Code MCP clients (Cursor, etc. — each has its own registration path, not our concern)
- Retroactive cleanup of polluted installs in the wild — that's a post-ship mail to monday, not a code change

## Ordering constraints

- AC-1..AC-3 before AC-4: primary path must be proven before the fallback can be meaningfully tested (the fallback shares the migration-warning code path).
- AC-9 (wrapper existence + green) must be the last AC, since it depends on AC-1..AC-8 passing.

## Verification procedure

The reviewer runs these exact commands from the repo root on master's HEAD (i.e., the PR's merge-base simulation) with the PR branch checked out:

```bash
# 1. Dist must be built.
npm ci --ignore-scripts
npm run build

# 2. Wrapper must exist.
test -x scripts/setup-config-acceptance.sh || chmod +x scripts/setup-config-acceptance.sh

# 3. Run the wrapper. It must exit 0 and print a PASS summary.
bash scripts/setup-config-acceptance.sh

# 4. Spot-check setup.sh is unchanged vs master.
git diff origin/master -- setup.sh
# Expected: empty.

# 5. Manual sanity — the reviewer MAY optionally run the real thing against their own ~/.claude.json
#    (clean up via `claude mcp remove forge -s user` afterwards). Skip if the reviewer doesn't want
#    to touch their real config. AC-1..AC-9 passing in scratch already proves correctness.
```

## Critical files

- `scripts/setup-config.cjs` — primary target. Rewrite the body from "write to settings.json" to "shell out to `claude mcp add` (with claude-remove first for idempotency); fall back to atomic direct-write of `~/.claude.json` on CLI absence; emit migration warnings for the two known stale surfaces."
- `scripts/setup-config-acceptance.sh` — new plan-mandated wrapper; drives AC-1..AC-8, exits 0 iff all pass. Uses scratch HOME via `mktemp -d` + `cygpath -m` bridge for Windows compatibility.
- `setup.sh` — unchanged (AC-10). Driver already invokes `node scripts/setup-config.cjs "$SCRIPT_DIR"` correctly; the fix is entirely inside the callee.
- `package.json` — patch version bump 0.32.4 → 0.32.5 (done by `/ship` Stage 7).
- `CHANGELOG.md` — new `### Bug Fixes` entry covering this commit (done by `/ship` Stage 7).
- `README.md` — touch only if the setup-troubleshooting section needs an "if you previously ran a pre-v0.32.5 setup.sh" migration call-out. Check during implementation; add if absent, leave alone if already current.
- `~/.claude/agent-working-memory/tier-b/topics/infra-bugs/2026-04-19-forge-setup-sh-wrong-mcp-path.md` — load-bearing context card (read-only for this task; mark card "resolved" only after v0.32.5 ships successfully).

## Checkpoint

- [x] Plan drafted
- [x] Critiqued via `/coherent-plan` (or inline reasoning — this is a short plan with binary AC)
- [x] Root cause re-verified on-disk via Rule #9 (measure before describing)
- [x] `claude mcp add` behavior probed (no --cwd flag, idempotency, HOME-override support)
- [x] `scripts/setup-config.cjs` rewritten
- [x] `scripts/setup-config-acceptance.sh` written
- [x] Wrapper runs clean locally (11/11 checks green, verified real ~/.claude.json untouched)
- [x] `vitest run` passes (749 passed, 4 skipped, 40/41 test files)
- [x] `npm run build` succeeds
- [x] GitHub issue filed for the bug (#304)
- [ ] `/ship` pipeline (branch, commit, PR, CI, review, merge, release tag v0.32.5)
- [ ] README migration-note added if missing
- [ ] Monday mailed with: v0.32.5 tag, migration instructions, correction that `--cwd` in my 14:21Z workaround was silently ignored (but her reboot worked anyway)
- [ ] Tier-b card at `infra-bugs/2026-04-19-forge-setup-sh-wrong-mcp-path.md` updated to `status: resolved` post-ship

Last updated: 2026-04-19T22:40:00+08:00 — implementation + wrapper green; ready for /ship.
