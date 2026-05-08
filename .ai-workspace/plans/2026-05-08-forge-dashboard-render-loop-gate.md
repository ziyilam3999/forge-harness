---
title: Gate the dashboard render loop on real forge state
date: 2026-05-08
slug: forge-dashboard-render-loop-gate
ship-version: 0.40.2
prior-version: 0.40.1
conventional-commit: fix(dashboard)
status: draft
---

## ELI5

Right now, every Claude Code session auto-spawns the forge MCP server in the background — even if you never asked for forge work. On startup, that server kicks off a "redraw the dashboard every ~30 seconds" timer pinned to **whatever folder Claude was launched from**. If you happened to launch Claude from your home folder (`~`), forge cheerfully creates `~/.forge/dashboard.html` and (with the global `FORGE_DASHBOARD_AUTO_OPEN=1` env var) pops it open in your browser. The dashboard is empty because there's no forge work — but the file keeps getting rewritten every 30s for the whole session.

The fix: don't render a dashboard for a folder that isn't a forge project. Only run the loop when there's actual forge state on disk (or a forge tool has been called in this session).

## Execution model

**Subagent (single-bundle `/auto-flow`)** — one write surface (forge-harness `server/`), no cross-repo coupling, but multiple files touched (the `main()` start site + the render-loop module + at least one wake hook in tool handlers + tests). That clears the trivial-skip threshold (>10 LOC, multi-file, behavioral change with regression risk to the v0.39.0 between-call bridging feature). Rationale: the four-reviewer planning pass adds value (P1 catches behavioral edge cases, P3 grounds against prior dashboard-related cairn lessons), and the implementer can work in an isolated worktree without main-context bloat.

## Why

**Concrete evidence (measured 2026-05-08 00:14 local):**
- `~/.forge/dashboard.html` exists and mtime is "now," even though the user has never declared a story or run forge in `~`.
- `lsof -p <pid>` on the 5 running `node forge-harness/dist/index.js` MCP processes shows one with cwd=`/Users/ansonlam` (home dir). That's the source of `~/.forge/`.
- `dist/index.js:101`: `dashboardRenderLoop.start(process.cwd())` — unconditional. No gate. The loop is the v0.39.0 feature that bridges between-tool state changes (CHANGELOG L80).
- Global registration in `~/.claude.json` injects `FORGE_DASHBOARD_AUTO_OPEN=1`, so the first render also spawns `open ~/.forge/dashboard.html`.

**Cost of the bug:**
- File pollution in `~` (and any other non-forge directory Claude is launched from).
- Surprise browser tab opens on session start with no forge intent.
- Misleading "this looks like a forge project" signal — `.forge/` directories appear in unrelated repos.
- Anti-pattern F2 (mechanical-detection-over-judgment): an unconditional behavior masquerading as a feature. The loop SHOULD be gated; "MCP server is alive" is not a sufficient precondition.

**Why now:**
User hit it in the wild today. The symptom (dashboard tab in `~`) is a flag for the deeper bug: the MCP server treats every cwd as an active forge project.

## What (intent)

The dashboard render loop must only emit `<cwd>/.forge/dashboard.html` when the cwd is an active forge project. "Active" means **at least one of**:

1. **State on disk** at MCP server boot: any of
   - `<cwd>/.forge/runs/` exists AND contains at least one `*.json` file
   - `<cwd>/.forge/audit/` exists AND contains at least one `*.jsonl` file
   - `<cwd>/.forge/coordinate-brief.json` exists
   - `<cwd>/.forge/activity.json` exists
2. **State created in this session**: any forge tool that writes state (`forge_plan`, `forge_generate`, `forge_evaluate`, `forge_coordinate`, `forge_declare_story`) is invoked during the MCP server's lifetime.

**Explicitly NOT counted as active:**
- A bare `.forge/` directory containing only `dashboard.html` and/or `.dashboard-opened` (the leaky-leftover state from this very bug). Otherwise the bug is sticky: once `~/.forge/dashboard.html` exists, the gate would see `.forge/` and re-render forever.
- Empty `runs/` or `audit/` subdirectories (they can be created lazily by tooling without representing real state).

If neither (1) nor (2) holds at boot, the loop must be dormant. If a forge tool fires later, the loop must come up automatically (preserves the v0.39.0 between-call bridging benefit; CHANGELOG L80).

**Wake-signal contract.** Every handler in the 5-tool list above must signal the loop *exactly once per call* via a single, idempotent symbol (the implementer chooses the symbol name; the AC just greps for *one* shared call site per handler file). Idempotent so repeated calls are harmless; symmetric so review can verify by inspection of one line per handler.

**`forge_declare_story` asymmetry.** `declare_story` writes to an in-memory store (`dist/lib/declaration-store.js`), not to disk. The wake hook for that tool MUST trigger the loop directly — disk-state checks alone will not see a declaration.

This gate is **independent of the auto-open env var** — even when `FORGE_DASHBOARD_AUTO_OPEN=1` is unset, an empty `.forge/dashboard.html` still leaks today, and that should also stop.

**Gate scope.** The gate applies to the *loop* (`dashboardRenderLoop.start()`) only. Ad-hoc `renderDashboard()` callers from progress.ts / run-record.ts are unaffected, because those call sites only fire from inside tool handlers — which already imply state, and which the wake-signal will catch on the same call.

## Binary AC

All ACs are observable from outside the diff. No reading source required to verify.

**Verifier helpers used by AC-1, AC-2, AC-3a, AC-4, AC-7:** the MCP server uses `StdioServerTransport` and exits when stdin closes. To keep it alive for one full loop tick (>35s) without sending real JSON-RPC, pipe a long-lived `sleep` into stdin: `sleep N | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1`. `sleep` writes nothing for N seconds then EOFs, which exits the server cleanly. The original `</dev/null` formulation is wrong — stdin closes immediately, server exits at t=0, and no tick ever fires (so the AC would pass for the wrong reason). Pick `N` so the server outlives the AC's last assertion: AC-1/AC-2/AC-4/AC-7 use `N=40`; AC-3a needs `N=50` because the verifier sleeps 5s + 35s = 40s after spawn before its final `test -s`, racing the server EOF (P4 finding).

**Cross-platform `stat` helper.** `stat -f %m` is BSD/macOS only; GNU `stat -c %Y` is the Linux equivalent. Every AC that reads mtime defines this shim at the top of its verifier (do not assume macOS):
```sh
mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1"; }
```

**Loop production interval is `[15_000, 30_000]` ms** (`dashboard-render-loop.js:78`). All time-based ACs use 40s wall-clock to guarantee at least one tick.

### AC-1 — empty cwd produces no dashboard
Setup: a temporary empty directory `T` (no `.forge/`); spawn the MCP server with `cwd=T`; keep it alive 40s; kill.
Pass: `T/.forge/dashboard.html` does **not** exist.
Verifier:
```sh
T=$(mktemp -d)
( cd "$T" && sleep 40 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) || true
test ! -e "$T/.forge/dashboard.html"
```

### AC-2 — populated cwd renders as before (regression guard, including auto-open)
Setup: a fresh cwd `T`; copy `tests/fixtures/forge-with-runs/.forge/` into `T/.forge/`. The implementer creates this fixture as part of the change. **Fixture validity gate (defends F37/F38):** before the time-based assertion, the fixture's `runs/*.json` is parsed by the same schema validator the production code uses (importing `parseRunRecord` from the built `dist/lib/run-record.js` if exported, or exercising it via a no-op `forge_status` call). If the fixture is malformed, AC-2 fails fast before the timer ever runs.
Then spawn the MCP server with `FORGE_DASHBOARD_AUTO_OPEN=1` in env; keep alive 40s; kill.
Pass:
- Fixture-validity probe exits 0 (malformed JSON or schema-fail aborts the AC).
- `T/.forge/dashboard.html` exists and is >1KB.
- The dashboard contains a forge-branded `<title>` tag — case-insensitive match (defends F50): `grep -iqE '<title>[^<]*forge' T/.forge/dashboard.html`.
- `T/.forge/.dashboard-opened` marker exists (proves auto-open path still fires when env var set + state present).
Verifier:
```sh
T=$(mktemp -d)
cp -R "$FORGE_HARNESS/tests/fixtures/forge-with-runs/.forge" "$T/.forge"
# Fixture-validity probe — fail fast if fixture is malformed (F37/F38 guard).
node -e "
const fs = require('fs');
const path = require('path');
const dir = '$T/.forge/runs';
for (const f of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!j.storyId || !j.metrics || typeof j.metrics.durationMs !== 'number') {
    console.error('FIXTURE INVALID:', f); process.exit(1);
  }
}
" || exit 1
( cd "$T" && FORGE_DASHBOARD_AUTO_OPEN=1 sleep 40 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) || true
test -s "$T/.forge/dashboard.html" && \
  [ "$(wc -c < "$T/.forge/dashboard.html")" -gt 1024 ] && \
  grep -iqE '<title>[^<]*forge' "$T/.forge/dashboard.html" && \
  test -e "$T/.forge/.dashboard-opened"
```

### AC-3a — empty cwd, then disk-state appears, dashboard appears
Setup: empty cwd `T`; spawn MCP server with stdin held open for **50s** (so the server outlives the assertion window — see Verifier helpers); wait 5s (loop should be dormant — assert no dashboard); externally `mkdir -p T/.forge/runs && cp <fixture-record> T/.forge/runs/`; wait 35s for next tick.
Pass: `T/.forge/dashboard.html` does NOT exist at t=5s; DOES exist at t=40s.
Verifier:
```sh
T=$(mktemp -d)
( cd "$T" && sleep 50 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) &
SERVER_PID=$!
sleep 5
test ! -e "$T/.forge/dashboard.html"   # dormant phase
mkdir -p "$T/.forge/runs"
cp "$FORGE_HARNESS/tests/fixtures/forge-with-runs/.forge/runs/"*.json "$T/.forge/runs/"
sleep 35
test -s "$T/.forge/dashboard.html"     # awake phase
wait $SERVER_PID 2>/dev/null || true
```

### AC-3b — empty cwd, then `forge_declare_story` (in-memory only), dashboard appears
Setup: empty cwd `T`; spawn MCP server via the **MCP SDK's `StdioClientTransport`** (defends F47 / honors P59 — the live smoke test at `server/smoke/mcp-surface.test.ts` already drives the server this way; reuse the pattern, do **not** hand-roll JSON-RPC framing). Issue a `tools/call` for `forge_declare_story`; wait one tick.
Pass: `T/.forge/dashboard.html` is created within one tick after the SDK call.
Verifier (model on `server/smoke/mcp-surface.test.ts` — the same pattern that ships in the existing smoke suite):
```ts
// tests/render-loop-gate/ac3b-declare-story-wake.test.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const T = mkdtempSync(join(tmpdir(), "ac3b-"));
const transport = new StdioClientTransport({
  command: "node",
  args: [join(process.cwd(), "dist/index.js")],
  cwd: T,
});
const client = new Client({ name: "ac3b", version: "0" }, { capabilities: {} });
await client.connect(transport);
// Pre-call dormancy assertion (P4 finding): prove the AC name's premise —
// "empty cwd, then declare_story" — by confirming the dashboard is absent
// BEFORE the wake signal. Without this, a regression that re-enables the
// unconditional loop would pass AC-3b because the loop would render
// regardless of the declare_story call.
if (existsSync(join(T, ".forge/dashboard.html"))) {
  throw new Error("AC-3b FAIL: dashboard exists pre-wake (loop is not dormant)");
}
await client.callTool({ name: "forge_declare_story", arguments: { storyId: "US-AC3B" } });
// Wait > 30s for the next tick after the wake signal.
await new Promise((r) => setTimeout(r, 35_000));
await client.close();

if (!existsSync(join(T, ".forge/dashboard.html"))) {
  throw new Error("AC-3b FAIL: dashboard not rendered after declare_story");
}
if (statSync(join(T, ".forge/dashboard.html")).size < 1024) {
  throw new Error("AC-3b FAIL: dashboard < 1KB (likely error stub)");
}
```
*The wrapper script `scripts/v040-2-render-loop-gate-acceptance.sh` invokes this via `npx tsx tests/render-loop-gate/ac3b-declare-story-wake.test.ts` (or the implementer's chosen test runner). Using the SDK client guarantees the wire format matches the server — no F47-class assumption about Content-Length framing.*

### AC-4 — auto-open does not fire in empty cwd
Setup: as AC-1, but with `FORGE_DASHBOARD_AUTO_OPEN=1` in env.
Pass: `T/.forge/.dashboard-opened` marker absent; `T/.forge/dashboard.html` absent.
Verifier:
```sh
T=$(mktemp -d)
( cd "$T" && FORGE_DASHBOARD_AUTO_OPEN=1 sleep 40 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) || true
test ! -e "$T/.forge/.dashboard-opened" && test ! -e "$T/.forge/dashboard.html"
```

### AC-5 — existing test suite passes
Pass: `cd $FORGE_HARNESS && npm test` exits 0. Existing dashboard-render-loop tests must keep passing. If any need updating, the PR body must include a one-line rationale per updated test.

### AC-6 — wake-signal contract: call-expression grep
Each of the 5 state-writing tool handlers must contain exactly one **call expression** of the wake symbol — not a substring match (per F32: substring matches pass on comments, JSDoc, and import lines without actually wiring the call).
Pass:
```sh
cd "$FORGE_HARNESS"
PATTERN='(ensureDashboardLoopRunning|notifyForgeStateWrite)[[:space:]]*\('
for f in server/tools/plan.ts server/tools/generate.ts server/tools/evaluate.ts server/tools/coordinate.ts server/tools/declare-story.ts; do
  [ -f "$f" ] || { echo "FAIL: $f missing (handler renamed or deleted?)"; exit 1; }
  count=$(grep -cE "$PATTERN" "$f" || echo 0)
  [ "$count" -eq 1 ] || { echo "FAIL: $f has $count wake-signal call-expressions (expected exactly 1)"; exit 1; }
done
```
*Implementer chooses one of the symbol names above (or proposes another in the PR body); AC enforces "exactly one call-expression per handler." The `[[:space:]]*\(` anchor forces a real invocation, defeating F32-class false positives. The `[ -f "$f" ]` precondition (P4 finding) ensures a renamed/deleted handler fails loudly with the right error message instead of slipping through as a "0 call-expressions" count-mismatch.*

### AC-7 — leaky-leftover `.forge/` does not count as active
Setup: empty cwd `T`; create `T/.forge/dashboard.html` (touch a stale leftover from this bug); record its mtime; spawn MCP server; keep alive 40s; kill.
Pass: `T/.forge/dashboard.html` mtime is unchanged (no rewrite); no other files appear in `T/.forge/`.
Verifier:
```sh
mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1"; }
T=$(mktemp -d)
mkdir -p "$T/.forge"
echo "<html>stale</html>" > "$T/.forge/dashboard.html"
mtime_before=$(mtime "$T/.forge/dashboard.html")
( cd "$T" && sleep 40 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) || true
mtime_after=$(mtime "$T/.forge/dashboard.html")
[ "$mtime_before" = "$mtime_after" ] && [ "$(ls "$T/.forge/" | wc -l)" -eq 1 ]
```

### AC-8 — diff scope confined to allowlist (no drive-by edits)
Pass: `git diff --name-only origin/master...HEAD` matches only the allowlist below.
```sh
cd "$FORGE_HARNESS"
ALLOWED='^(server/index\.ts|server/lib/dashboard-render-loop\.ts|server/tools/(plan|generate|evaluate|coordinate|declare-story)\.ts|tests/fixtures/forge-with-runs/.*|tests/render-loop-gate/.*|server/lib/dashboard-render-loop\.test\.ts|scripts/v040-2-render-loop-gate-acceptance\.sh|CHANGELOG\.md|package\.json|package-lock\.json)$'
SCOPE_OUT=$(mktemp)
git diff --name-only origin/master...HEAD | grep -vE "$ALLOWED" | tee "$SCOPE_OUT"
[ ! -s "$SCOPE_OUT" ]
```

### AC-9 — acceptance wrapper script
A script `scripts/v040-2-render-loop-gate-acceptance.sh` runs **ACs 1, 2, 3a, 3b, 4, 5, 6, 7, 8** in order (nine assertions) and prints `ALL V0.40.2 ACCEPTANCE CHECKS PASSED` on green. Pattern matches `2026-04-20-v0-34-0` AC-13 and `2026-04-20-v0-34-1` AC-10.
Pass: `bash scripts/v040-2-render-loop-gate-acceptance.sh` exits 0 and stdout contains the literal string `ALL V0.40.2 ACCEPTANCE CHECKS PASSED`.

## Critical files (pointers, not prescription)

- `dist/index.js:89-115` (server `main()`, render-loop `start()` site) — source: `server/index.ts`. The unconditional `dashboardRenderLoop.start(process.cwd())` is here.
- `dist/lib/dashboard-render-loop.js` — source: `server/lib/dashboard-render-loop.ts`. Owns the 30s timer.
- `dist/lib/dashboard-renderer.js:1263+` — `renderDashboard()` and `maybeAutoOpenBrowser()`. The renderer also creates `.forge/` if missing (note: this means a gate at the loop level is sufficient; the renderer itself doesn't need to change).
- `dist/lib/dashboard-renderer.js:159-260` — the `.forge/runs/*.json` and `.forge/coordinate-brief.json` reads define what "real forge state" looks like; the gate's "is this a forge project?" check should reuse the same set.
- `server/tools/declare-story.ts`, `server/tools/plan.ts`, `server/tools/generate.ts`, `server/tools/evaluate.ts`, `server/tools/coordinate.ts` — handlers that should ensure the loop is running after a state-write (mid-session wake path).

The implementer chooses *how* to wire the wake signal (event emitter, idempotent `ensureRunning()`, etc.). Plan does not prescribe.

## Considered alternatives

- **Boot-time gate only** (check `.forge/` state at `start()` and never re-check): rejected because (a) sticky-bug — once a leaky `~/.forge/dashboard.html` exists, the boot check sees `.forge/` and re-renders forever (AC-7 covers this); (b) breaks v0.39.0 between-call bridging when a session that starts in an empty cwd later runs forge work.
- **Wake-on-tool-call only** (no boot-time short-circuit): rejected because most real consumers (monday-bot, ai-BRUST-creator) already have populated `.forge/` at session start; making them wait for the first tool call before the dashboard renders would be a UX regression.
- **Single-locus design (F66 hybrid-first reflex)**: a single `ensureDashboardLoopRunning()` symbol called from (a) a one-shot startup probe that fires it iff disk-state-is-active *and* (b) every state-writing tool handler. Same enforcement as the chosen design with one code path instead of two; reduces the F66 "two parallel mechanisms" risk. **The chosen design is in fact this single-locus shape** — the boot-time disk-state check is implemented as a startup probe that calls the same wake symbol used by tool handlers, not as a separate `start()` branch. The plan's WHAT section deliberately frames the gate as "(1) state-on-disk OR (2) session tool-call" because those are the *observable preconditions*; the implementation must collapse to one symbol per the AC-6 contract.
- **Drop the loop entirely, revert to event-driven only**: rejected — the v0.39.0 loop was added specifically to bridge state changes that happen *outside* tool calls (e.g., `origin/master` moving while the dashboard is open). Removing it reintroduces the freeze bug it was built to fix.
- **Move the dashboard out of `.forge/` to a per-user cache dir** (e.g., `~/.cache/forge/<project-hash>/dashboard.html`): rejected as out-of-scope — orthogonal to the gate fix; would change the consumer contract.

## Out of scope

- Removing `FORGE_DASHBOARD_AUTO_OPEN=1` from the global MCP env — orthogonal config choice.
- Moving the forge MCP registration from global to project-scoped — orthogonal.
- The `~/.forge/` directory that already exists — not part of the fix; cleanup is `mv ~/.forge ~/_quarantine-forge-leak-20260508/` per Rule 14, done manually after the fix lands.
- Any changes to dashboard rendering content / layout.

## Cairn references

Patterns the plan applies (cite explicitly so future readers can audit):
- **P6 — Mechanical Detection Over Judgment.** Gate is mechanical (state-file presence + call-expression grep), not advisory.
- **P17 — Binary ACs Make Self-Grading Safe.** Every AC reduces to `test`, `wc`, `grep -E`, `stat -f %m`. No diff-reading required.
- **P19 — Idempotent Automation.** `ensureDashboardLoopRunning()` is safe to call N times per handler; AC-6 enforces "exactly one call expression," not "exactly one execution."
- **P32 — Config-as-Parameter Threading.** The wake symbol is an injected dependency on `dashboardRenderLoop`, not a module-global singleton (singletons are F54-fragile and untestable).
- **P51 — Resolve Relative Paths to Absolute.** The disk-state probe `path.resolve()`s `process.cwd()` first; bare `cwd` is mangled on Windows + MSYS bash (P62 evidence).
- **P59 — Real Transport Boundary in CI.** AC-3b drives the live MCP binary via `StdioClientTransport`; reuses `server/smoke/mcp-surface.test.ts` precedent rather than reinventing it.

Anti-patterns the plan deliberately defends against:
- **F2 — Behavioral Prose Without Consequences.** Unconditional `dashboardRenderLoop.start(process.cwd())` is the F2 shape. The gate plus AC-6 grep is the F2-class consequence.
- **F32 — Hollow "Grep for Others" Advice.** AC-6 anchors to a call-expression regex (`(symbol)\s*\(`), not a bare substring; comment / JSDoc / import lines won't pass.
- **F37 / F38 — Phantom / Fabricated Test Fixtures.** AC-2 fixture-validity probe parses `runs/*.json` against the live record schema before the time-based assertion runs.
- **F47 — Assumed JSON Shape From External Tools.** AC-3b uses `StdioClientTransport` instead of hand-rolled JSON-RPC framing.
- **F50 — Exact String Match.** AC-2's `<title>` check is case-insensitive + word-class regex.
- **F54 — Stale MCP Server After dist/ Rebuild.** Every AC respawns `node dist/index.js` per run; no shared/cached server state across ACs.
- **F65 — Planning Without Measuring Current State.** Why section opens with `lsof -p`, line citation, mtime measurements — model F65 avoidance.
- **F66 — Hybrid-First Design Reflex.** "Considered alternatives" enumerates the single-locus collapse; chosen design is the single-locus shape.

Operational doctrine:
- **Rule 14 — mv-not-rm.** Cleanup of leaked `~/.forge/` after fix lands uses `mv ~/.forge ~/_quarantine-forge-leak-20260508/`.

Lesson to capture *after* this ships (post-merge cairn-stone):
- _"MCP servers spawned globally must not use `process.cwd()` as ambient project root without state-on-disk verification."_ Structurally identical to the Task #74 `$HOME`-leak (`tier-b/topics/infra-bugs/2026-04-19-task-74-memory-cli-home-leak-shipped.md`) — env value used as path without verification. File via `/cairn place` from the `/ship` checkpoint.

## Notes for the reviewer chain

- Plan body is ~310 lines, but most volume is verifier shell snippets that don't need contradiction-checking. The four-reviewer chain (P1 stateless / P2 comparative / P3 cairn-grounded / P4 mechanical-sweep) has already run; `/coherent-plan` was inlined as P4. No further pre-execute review is required.
- One bundle (single write surface: forge-harness `server/` + tests). `/auto-flow` Stage 2 trivially short-circuits to single-bundle.
- No cross-repo work. No schema changes. No new env vars.
- Trust-but-verify after `/delegate`: re-run AC-1, AC-2, AC-3a, AC-4, AC-7 as the operator on the merged PR. AC-3b and AC-5 stay in CI.

## Revision log
- **2026-05-08 — initial draft.** WHAT/WHY/AC-1..5/critical-files/out-of-scope.
- **2026-05-08 — P1 stateless review applied.** Five fixes:
  1. Fixed AC-1/AC-4 verifier (`</dev/null` → `sleep 40 |`) — server was dying at t=0.
  2. Split AC-3 into AC-3a (disk-state wake, pure shell) + AC-3b (JSON-RPC stdio, in-memory `declare_story` wake).
  3. Pinned AC-2 fixture provenance (`tests/fixtures/forge-with-runs/`) + added auto-open assertion.
  4. Added AC-6 (wake-signal contract grep across all 5 tool handlers) + AC-7 (leaky-leftover gate).
  5. Tightened gate predicate: empty `runs/` / `audit/` don't count; bare `.forge/` with only `dashboard.html` doesn't count; `declare_story` asymmetry called out (in-memory only, must wake loop directly).
- **2026-05-08 — P2 comparative review applied.** Five fixes:
  1. Corrected fixture path from `tests/__fixtures__/` to `tests/fixtures/` (verified against repo — `__fixtures__` doesn't exist; `tests/fixtures/` is the live convention).
  2. Added `ship-version: 0.40.2`, `prior-version: 0.40.1`, `conventional-commit: fix(dashboard)` frontmatter to match `2026-04-27-v0-39-4` style (helps `/ship` Stage 7 bump heuristic).
  3. Added AC-8 (diff-scope allowlist grep) — matches v0.34.0 AC-11 / v0.34.1 AC-9 pattern; prevents drive-by edits.
  4. Added AC-9 (acceptance wrapper script `scripts/v040-2-render-loop-gate-acceptance.sh`) — matches v0.34.0 AC-13 / v0.34.1 AC-10 pattern; one-shot reviewer command.
  5. Added "Considered alternatives" block — explains why neither boot-time-only nor wake-on-call-only suffices.
- **2026-05-08 — P3 cairn-grounded review applied.** Five fixes:
  1. AC-6 grep anchored to call-expression regex `(symbol)\s*\(` instead of substring match (F32 — substring matches pass on comments/JSDoc/imports).
  2. AC-2 + AC-3a fixture-validity probe added (F37/F38 — AC was at risk of passing for the wrong reason if fixture was malformed).
  3. AC-3b rewritten to use `StdioClientTransport` from the MCP SDK, modeled on `server/smoke/mcp-surface.test.ts` (F47 / P59 — hand-rolled JSON-RPC framing was an unverified assumption).
  4. "Considered alternatives" extended with F66 single-locus collapse + clarified that the chosen design *is* the single-locus shape (one wake symbol, two callers: startup probe + tool handlers).
  5. Cairn references expanded from 3 IDs to 14 — explicitly cites P17/P19/P32/P51/P59 (patterns applied) and F32/F37/F38/F47/F50/F54/F65/F66 (anti-patterns defended). Added post-merge cairn-stone capture: "MCP servers spawned globally must not use `process.cwd()` as ambient project root without state-on-disk verification."
- **2026-05-08 — P4 mechanical-sweep review applied.** Seven fixes:
  1. AC-9 wording: "ACs 1 through 8" → "ACs 1, 2, 3a, 3b, 4, 5, 6, 7, 8" (nine assertions; the 3a+3b split was hidden behind an off-by-one count).
  2. AC-8 allowlist: added `tests/render-loop-gate/.*` so AC-3b's own test file is in-scope (it would have failed AC-8 otherwise).
  3. AC-3a stdin: bumped `sleep 40` to `sleep 50` so the server outlives the t=40s assertion (current timing raced server EOF).
  4. AC-1/AC-3a/AC-4/AC-7 mtime: added cross-platform `mtime()` shim (`stat -f %m` falls back to `stat -c %Y`) so Linux CI doesn't fail on macOS-only flags.
  5. AC-3b: added pre-call `existsSync(...) === false` dormancy assertion — proves the wake (not pre-existing state) caused the render.
  6. AC-6: added `[ -f "$f" ]` precondition before grep — a deleted/renamed handler now fails loudly with "file missing" instead of slipping through as "0 call-expressions."
  7. AC-8: replaced shared `/tmp/scope-violations` with `mktemp` to dodge parallel-CI race.
  Stale "~210 lines" self-report removed; reviewer-chain notes updated to reflect that all four reviewers have run.
