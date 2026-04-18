---
date: 2026-04-19
task: fix memory-cli `$HOME` non-expansion leak (task #74)
shape: outcome + binary AC
option: C (source fix + guard + cleanup)
---

# Plan: memory-cli `$HOME` leak — sanitize at source + guard + cleanup

## ELI5

A global Claude Code settings file sets a variable (`WORKING_MEMORY_ROOT`) to the
literal string `$HOME/.claude/agent-working-memory` — but Claude Code doesn't
turn `$HOME` into `/c/Users/ziyil` when it launches processes. So every script
that reads the variable gets a broken path with the dollar-sign still in it.
When those scripts try to save a file, they accidentally create a folder
literally named `$HOME` inside whatever project happens to be the current
working directory.

The fix has three pieces:
1. **Remove the variable from settings.json** — every consumer already has a
   built-in fallback (`${VAR:-$HOME/...}`) that expands `$HOME` properly *when
   the variable is unset*, so just unsetting it cures the bug at the source.
2. **Add a safety check in the main Node helper** so if anyone re-introduces
   the literal `$HOME` in the future (or any other unexpanded shell token),
   the helper throws instead of silently misrouting writes.
3. **Clean up the garbage folders** that prior sessions created inside
   forge-harness. One extra Windows-path-mangling artefact (`C:Users...`) is
   filed as a separate follow-up bug.

## Context

- **Discovery.** 2026-04-18 `/ship` Stage 10 (card emission) caught the bug when its
  gate check spotted `WORKING_MEMORY_ROOT` holding literal
  `$HOME/.claude/agent-working-memory`. Stage 10's graceful-degradation contract
  averted a card write into the forge-harness repo working tree.
- **Scope proof.** The tier-b card at
  `~/.claude/agent-working-memory/tier-b/topics/infra-bugs/2026-04-18-memory-cli-home-leak-downstream.md`
  documents that this is not a memory-cli-local bug: any consumer of
  `WORKING_MEMORY_ROOT` in any process misroutes writes. Stage 10 was the
  accidental canary.
- **Root cause.** `~/.claude/settings.json` (the `env` block, line 6 as of
  2026-04-19 — line number will shift after the delete) sets the env var to
  the literal string `$HOME/.claude/agent-working-memory`. Claude Code's
  `env` block does NOT shell-expand values (confirmed empirically:
  `echo $WORKING_MEMORY_ROOT` returns the dollar-sign unaltered). Downstream
  `${VAR:-default}` fallbacks only fire when the var is *unset*, not when it's
  set-but-literal — so `session-bookmark.sh:184`, `session-start.sh:18`, and
  `refresh.mjs:13` (`resolveRoot()`) all happily pass the unexpanded string
  to `path.join()` / `mkdir -p`, which treat it as a relative path component
  under CWD.
- **settings.json is a symlink** to `ai-brain/claude-global-settings.json` per
  the CLAUDE.md mapping; the edit lands in the ai-brain PR flow.
- **Polluted artefacts observed in forge-harness working tree** (measured
  2026-04-19):
  - `$HOME/.claude/` (literal `$HOME` dir with a nested `.claude/` child) —
    primary target, created by memory-cli write.
  - `C:Usersziyilcoding_projectsforge-harnesstmp/` — separate Windows-path bug
    (backslashes stripped, not this task).

## Goal

1. `WORKING_MEMORY_ROOT`, when read by any consumer in any future session, is
   either unset (consumers fall back to a properly-expanded `$HOME/...`
   default) or a fully-expanded absolute path — never a string containing an
   unexpanded shell token.
2. `resolveRoot()` in `agent-working-memory/src/refresh.mjs` refuses to return
   a path containing unexpanded shell-variable tokens (`$HOME`, `${HOME}`,
   `$WORKING_MEMORY_ROOT`, etc.); it throws with a message naming the
   offending token.
3. Polluted artefact directories inside the forge-harness working tree
   (`$HOME/` and the separate `C:Users...` dir) are removed. Subsequent
   memory-cli operations cannot re-create them: either the guard from Goal 2
   throws on unexpanded tokens (hard fail), or — with the env var unset —
   the fallback expands `$HOME` correctly so writes land at the absolute
   home path. There is no silent-skip branch.
4. A smoke test run with CWD=forge-harness lands the card at the intended
   absolute path under the user's home directory, not inside the repo.
5. Existing agent-working-memory test suite still passes (no regressions).

## Binary AC

Each is a command whose pass/fail is observable from outside the diff.

- AC-01 — In a fresh Claude Code session after the settings edit,
  `bash -c '! printf "%s" "${WORKING_MEMORY_ROOT:-}" | grep -q "\$HOME"'`
  exits 0. (Reads: the env var is either unset or contains no unexpanded
  `$HOME` token. Single-command oracle.)
- AC-02 — `cd ~/coding_projects/agent-working-memory && WORKING_MEMORY_ROOT='$HOME/.claude/agent-working-memory' node -e 'import("./src/refresh.mjs").then(m => m.resolveRoot()).catch(e => { process.stderr.write(e.message); process.exit(42); })' 2>/tmp/awm-ac02.err; EX=$?; test "$EX" -eq 42 && grep -q 'HOME' /tmp/awm-ac02.err`
  exits 0. (Reads: `resolveRoot()` threw with exit code 42 AND the error
  message contains the token `HOME`. Portable across Windows/Unix: uses
  relative `./src/refresh.mjs` import + `cd`, avoids Windows file-URL
  absolute-path pitfall.)
- AC-03 — `cd ~/coding_projects/agent-working-memory && unset WORKING_MEMORY_ROOT && node -e 'import("./src/refresh.mjs").then(m => console.log(m.resolveRoot()))'`
  exits 0 and prints an absolute path whose parent directory exists on
  disk (reviewer: pipe through `xargs -I{} dirname '{}' | xargs -I{} test -d '{}'`).
- AC-04 — `test ! -d '/c/Users/ziyil/coding_projects/forge-harness/$HOME'` exits 0.
- AC-05 — `ls '/c/Users/ziyil/coding_projects/forge-harness/' 2>&1 | grep -c '^C:Users'`
  returns 0.
- AC-06 — End-to-end smoke: with CWD=forge-harness and
  `WORKING_MEMORY_ROOT` unset, run
  `node ~/coding_projects/agent-working-memory/src/memory-cli.mjs write --topic test --id smoke-20260419 --title 'smoke'`;
  then `test -f /c/Users/ziyil/.claude/agent-working-memory/tier-b/topics/test/smoke-20260419.md`
  exits 0 AND `test ! -d '/c/Users/ziyil/coding_projects/forge-harness/$HOME'`
  exits 0. Smoke card is deleted after the check.
- AC-07 — `grep -c 'WORKING_MEMORY_ROOT' ~/coding_projects/ai-brain/claude-global-settings.json`
  returns 0.
- AC-08 — Delta test (absolute would spuriously fail: `hygiene: committed
  repo tree is clean` already fails on main due to pre-existing historical
  plan files referencing `~/.claude/...` patterns — see Out-of-scope).
  Reviewer script: record the master baseline not-ok count, then the
  fix-branch not-ok count, assert fix-branch ≤ master AND at least one new
  test name covers the guard. Concretely:
  ```
  cd ~/coding_projects/agent-working-memory
  MASTER_SHA=$(git rev-parse origin/main)
  BEFORE=$(git stash push -u -m ac08-delta >/dev/null 2>&1; git checkout "$MASTER_SHA" >/dev/null 2>&1; npm test 2>&1 | grep -cE '^not ok'; git checkout - >/dev/null 2>&1; git stash pop >/dev/null 2>&1 || true; echo "$BEFORE")
  AFTER=$(npm test 2>&1 | tee /tmp/awm-test-output.log | grep -cE '^not ok')
  test "$AFTER" -le "$BEFORE" && grep -cE '(resolveRoot.*HOME|HOME.*resolveRoot|unexpanded|literal)' /tmp/awm-test-output.log | grep -qE '^[1-9]'
  ```
  Exits 0 iff fix branch has no NEW failures AND at least one new guard
  test is actually executed. Reviewer may substitute any equivalent delta
  check.

## Out of scope

- The Windows-backslash-to-nothing bug that created
  `C:Usersziyilcoding_projectsforge-harnesstmp/` — clean up only; do NOT
  diagnose the source here. File a follow-up task.
- Changes to `session-bookmark.sh`, `session-start.sh`, or any other bash
  hook. Their existing `${VAR:-$HOME/...}` fallbacks will correctly expand
  once the env var is unset; no edits needed.
- Any changes to how Claude Code itself processes `env` blocks (we treat it
  as "literal, no expansion" and design around that).
- Refactoring `memory-cli.mjs` or `write-card.mjs` beyond whatever is needed
  to satisfy AC-02/AC-03 (usually just `resolveRoot()`).
- ai-brain's `setup.sh` / install flow.
- Documentation updates (README, architecture.md) beyond whatever a reviewer
  demands to match the new behaviour.
- Other siblings of task #74 (other Windows quirks, MCP determinism, etc.).
- **Pre-existing hygiene-scanner failures** in `agent-working-memory` due to
  historical plan files (`.ai-workspace/plans/2026-04-17-cairn-memory-pipeline-overhaul.md`,
  `.ai-workspace/plans/2026-04-17-fix-memory-pipeline-quad.md`) containing
  `~/.claude/...` patterns. AC-08 is delta-based to avoid holding the
  executor responsible for these. If the executor wants to silence them,
  that is a SEPARATE follow-up PR.
- **This plan file itself being hygiene-clean.** The plan lives in
  `forge-harness/.ai-workspace/plans/` deliberately — forge-harness has no
  equivalent scanner. Do NOT copy the plan file into agent-working-memory.

## Ordering constraints

- AC-07 (remove line from settings.json) must land before AC-01 is verified
  end-to-end, because AC-01 measures the post-fix environment.
- AC-02 and AC-03 (guard in `resolveRoot()`) land independently of AC-07;
  either order works for those two.
- AC-04 and AC-05 (cleanup) happen AFTER AC-02 and AC-07 are in place, so
  the cleanup is not re-polluted by a misconfigured write mid-fix.
- AC-06 (smoke) runs LAST, after all other ACs green, to prove the
  round-trip.

## Verification procedure

Reviewer runs these in order; any non-zero exit on a PASS step blocks
closure.

1. `cat ~/.claude/settings.json | grep -c '"WORKING_MEMORY_ROOT"'` → `0`.
2. Start a fresh Claude Code session (or new bash shell after symlink edit)
   → `echo "${WORKING_MEMORY_ROOT:-UNSET}"` → prints `UNSET` or a path with
   no `$HOME`.
3. `cd ~/coding_projects/agent-working-memory && node -e 'import("./src/refresh.mjs").then(m => console.log(m.resolveRoot()))'`
   → prints an absolute path (e.g., `/c/Users/ziyil/.claude/agent-working-memory`
   or `C:\Users\ziyil\.claude\agent-working-memory`).
4. `cd ~/coding_projects/agent-working-memory && WORKING_MEMORY_ROOT='$HOME/.claude/agent-working-memory' node -e 'import("./src/refresh.mjs").then(m => m.resolveRoot()).catch(e => { process.stderr.write(e.message); process.exit(42); })' 2>/tmp/awm-ac02.err; test $? -eq 42`
   → exits 0 (guard threw, exit code captured).
5. `test ! -d '/c/Users/ziyil/coding_projects/forge-harness/$HOME'`.
6. `ls '/c/Users/ziyil/coding_projects/forge-harness/' | grep -c '^C:Users'`
   → `0`.
7. `cd /c/Users/ziyil/coding_projects/forge-harness && node ~/coding_projects/agent-working-memory/src/memory-cli.mjs write --topic test --id smoke-20260419 --title 'smoke'`
   then `test -f /c/Users/ziyil/.claude/agent-working-memory/tier-b/topics/test/smoke-20260419.md`
   AND `test ! -d '/c/Users/ziyil/coding_projects/forge-harness/$HOME'`
   (delete smoke card after check).
8. `cd ~/coding_projects/agent-working-memory && npm test` → exits 0.

## Critical files

| Path | Role |
|---|---|
| `ai-brain/claude-global-settings.json` (symlinked to `~/.claude/settings.json`) | Delete the `WORKING_MEMORY_ROOT` entry from the `env` block (line 6 as of 2026-04-19). |
| `agent-working-memory/src/refresh.mjs` | Add unexpanded-shell-token guard in `resolveRoot()`. |
| `agent-working-memory/tests/` | Add unit test(s) proving AC-02 (guard throws on literal `$HOME`) and AC-03 (unset env → fallback expands). |
| `forge-harness/` working tree | `rm -r` the polluted `$HOME/` dir and the `C:Users...` dir. Single `chore(cleanup)` commit. |
| `~/.claude/agent-working-memory/tier-b/topics/infra-bugs/2026-04-18-memory-cli-home-leak-downstream.md` | After ship, append a resolution note to the body. Frontmatter change is OPTIONAL and only if `card-shape.mjs` supports a resolution/status field — the body-appended note is the required part. |

## Checkpoint

- [ ] Plan critiqued via `/coherent-plan`
- [ ] ai-brain: delete `WORKING_MEMORY_ROOT` from `claude-global-settings.json` on a branch; `/ship` PR
- [ ] agent-working-memory: add guard in `resolveRoot()`; add unit test; `/ship` PR
- [ ] forge-harness: cleanup PR removing both polluted dirs
- [ ] All three PRs merged
- [ ] Fresh session verification: AC-01..AC-08 all green
- [ ] Task #74 closed; tier-b card updated to resolved
- [ ] Follow-up task filed for Windows-backslash-stripping bug (source of `C:Users...` dir)

Last updated: 2026-04-19T00:00:00+08:00 — initial draft, option C approved.
