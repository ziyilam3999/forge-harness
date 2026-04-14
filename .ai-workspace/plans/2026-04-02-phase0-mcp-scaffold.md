# Forge Harness — Phase 0: MCP Server Scaffold

## Context

Forge Harness is the successor to Hive Mind v3 — a local MCP server that extracts 4 composable primitives (`forge_plan`, `forge_evaluate`, `forge_generate`, `forge_coordinate`) from a monolithic 2,168-line orchestrator. The repo currently has **no code, no git, no package.json** — only ~7,400 lines of planning docs in `docs/`.

This plan covers:
1. **Overall phasing** (Phases 0–4) at a high level
2. **Detailed Phase 0 implementation** broken into 5 features, each shipped as a PR via `/ship`

## ELI5

We're setting up an empty workshop (git, npm, TypeScript) and putting a sign on the door that says "Forge" so Claude Code knows where to find it. The tools inside don't work yet — they just say "coming soon" — but the wiring is proven end-to-end.

---

## Overall Phases (High Level)

| Phase | Deliverable | Dogfood | Depends On |
|-------|------------|---------|------------|
| **0** | MCP server scaffold + 4 placeholder tools + CI/CD + setup.sh | Claude Code discovers `forge_plan` tool | Nothing (greenfield) |
| **1** | `forge_plan` — planning with double-critique | Use `forge_plan` to plan Phase 2 | Phase 0 |
| **2** | `forge_evaluate` — stateless binary grading | Grade Phase 3 code as it's built | Phase 0 + 1 |
| **3** | `forge_generate` — GAN loop (implement->evaluate->fix) | Implement Phase 4 via generate+evaluate | Phase 0 + 1 + 2 |
| **4** | `forge_coordinate` — dependency-ordered orchestration | Full pipeline on real PRD | Phase 0 + 1 + 2 + 3 |

**Note:** Phase dependencies are dogfooding/workflow dependencies (each tool is used to build the next phase), not technical dependencies between the tools themselves. A contributor could build `forge_evaluate` and `forge_plan` in parallel if desired.

---

## Phase 0: Detailed Implementation

Each feature is a separate PR shipped via `/ship`.

### Feature 1: GitHub Repo + Project Init

**Goal:** Create GitHub repo, init git, set up buildable ESM TypeScript project.

**Steps:**
1. `git init` in forge-harness
2. Create GitHub repo via `gh repo create ziyilam3999/forge-harness --public --source=.`
   - **Edge case:** If the GitHub repo already exists (e.g., created manually), use `gh repo view` to check first and skip creation if present.
3. Create project config files:

**Files to create:**

- **`package.json`**
  - `"name": "forge-harness"`, `"version": "0.1.0"`, `"type": "module"`
  - Scripts: `"build": "tsc"`, `"start": "node dist/server/index.js"`, `"test": "vitest run"`, `"lint": "eslint server/"`
  - Dependencies: `@modelcontextprotocol/sdk`, `zod` (^3.25)
  - DevDependencies: `typescript`, `@types/node`, `vitest`, `eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`
  - `"postinstall": "node scripts/install-hooks.cjs"`

  **Why zod ^3.25 and not ^4.0:** The MCP SDK accepts both (`"^3.25 || ^4.0"`). We pin to 3.x because the SDK's own examples and `registerTool` input schema pattern use `z.string()`, `z.object()`, etc., which are stable in 3.x. Zod 4 introduced a new module structure (`zod/v4/mini` vs `zod/v4`) and changed some import paths. Until the MCP SDK officially updates its examples for zod 4, staying on 3.x avoids import-path surprises. Can upgrade to 4.x in a future PR once validated.

- **`tsconfig.json`**
  - `target: "ES2022"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`
  - `rootDir: "server"`, `outDir: "dist"`
  - `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`
  - `esModuleInterop: true`, `skipLibCheck: true`, `forceConsistentCasingInFileNames: true`
  - `declaration: true`, `sourceMap: true`
  - `include: ["server/**/*"]`, `exclude: ["node_modules", "dist"]`

  **Rationale:** This mirrors hive-mind's proven tsconfig (`module: "NodeNext"`, `outDir: "dist"`, `rootDir` pointing at source). `noUnusedLocals` and `noUnusedParameters` are included from day one to prevent dead-code accumulation. Note: hive-mind does NOT use these stricter options, so any code ported from hive-mind may need `_` prefixing on unused callback parameters.

- **`.gitignore`**
  - `node_modules/`, `dist/`, `.forge/`, `.ai-workspace/`

- **`.gitattributes`**
  - `*.sh text eol=lf` — prevents CRLF corruption of shell scripts on Windows
  - `*.cjs text eol=lf` — keeps hook installer safe
  - `*.yml text eol=lf` — CI workflows

4. `npm install`

**Ship:** `/ship` — first PR to main

---

### Feature 2: CI/CD + Code Review + Hooks (from hive-mind)

**Goal:** Replicate hive-mind's automation stack, adapted for forge-harness.

**Files to copy/adapt from `C:\Users\ziyil\coding_projects\hive-mind`:**

- **`.github/workflows/ci.yml`** — Build matrix (Node 20), conventional commit validation
  - Adapt: change build/test commands to work with forge-harness structure
  - **Note:** Node 18 reached EOL in April 2025. CI targets Node 20 only.
- **`.github/workflows/code-review.yml`** — AI code review via `anthropics/claude-code-action@v1`
  - Copy as-is (uses same Claude Code OAuth token)
- **`.github/ISSUE_TEMPLATE/bug_report.yml`** — Structured bug report form
- **`.github/ISSUE_TEMPLATE/feature_request.yml`** — Feature request form
- **`scripts/install-hooks.cjs`** — Postinstall hook installer
  - Installs commit-msg hook (conventional commits validation)
  - Installs pre-commit hook (TypeScript type-check via `npx tsc --noEmit`)
  - Copy as-is — the hook script does not reference source directory paths, so no path adaptation is needed.
- **`eslint.config.js`** — ESLint flat config (ESLint 9+)
  - Adapt: target `server/**/*.ts` instead of `src/**/*.ts`
  - **Note:** Verified hive-mind uses ESLint flat config format (`export default [...]`), which is compatible with `"type": "module"` in package.json. No format conversion needed.
- **`vitest.config.ts`** — Test runner config
  - Adapt: pattern `server/**/*.test.ts`
  - Add `passWithNoTests: true` to the config so CI does not fail when no test files exist yet (Feature 3 adds a smoke test, but this is a safety net).
- **`CONTRIBUTING.md`** — Update repo name
- **`CHANGELOG.md`** — Initialize with v0.1.0

**Ship:** `/ship` — PR #2

---

### Feature 3: MCP Server Scaffold

**Goal:** Working MCP server with 4 placeholder tools via stdio transport.

**Files to create:**

- **`server/index.ts`** — Entry point
  - Creates `McpServer({ name: "forge", version: "0.1.0" })`
  - Registers 4 tools via `server.registerTool()` (modern API, NOT deprecated `.tool()`)
  - Connects via `StdioServerTransport`
  - **Critical:** No `console.log()` — stdout is JSON-RPC channel. `console.error()` only.

- **`server/tools/plan.ts`** — `forge_plan` placeholder
  - Input: `{ intent: z.string() }`, annotations: `{ readOnlyHint: true }`
  - Returns: `` `forge_plan for "${intent}": not yet implemented. Phase 1 required.` ``
  - **Note:** Parameter is included in the return string to avoid `noUnusedParameters` violation.

- **`server/tools/evaluate.ts`** — `forge_evaluate` placeholder
  - Input: `{ storyId: z.string() }`, annotations: `{ readOnlyHint: true }`
  - Returns: `` `forge_evaluate for "${storyId}": not yet implemented. Phase 2 required.` ``

- **`server/tools/generate.ts`** — `forge_generate` placeholder
  - Input: `{ storyId: z.string() }`, annotations: `{ destructiveHint: true }`

- **`server/tools/coordinate.ts`** — `forge_coordinate` placeholder
  - Input: `{ planPath: z.string() }`, annotations: `{ destructiveHint: true }`

- **`server/validation/execution-plan.ts`** — Validation stub (`{ valid: true }`)

- **`schema/execution-plan.schema.json`** — Skeleton JSON Schema v3.0.0
- **`schema/eval-report.schema.json`** — Skeleton
  - **Note:** Schema files live at the repo root, outside `server/` and `dist/`. The validation stub returns `{ valid: true }` and does not read these files. When Phase 1+ implements real validation, a build copy step or runtime resolution strategy (e.g., `path.resolve(process.cwd(), 'schema/...')`) will be needed. This is acceptable for Phase 0 — the schemas are structural placeholders.

- **`server/tools/plan.test.ts`** — Smoke test
  - Imports the plan placeholder handler and asserts it returns the expected `"forge_plan for ... not yet implemented"` string. This ensures `vitest run` has at least one test to execute.

**Key pattern (from MCP SDK reference `~/.claude/skills/mcp-builder/reference/node_mcp_server.md`):**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

server.registerTool("forge_plan", {
  title: "Forge Plan",
  description: "Transform intent into a structured execution plan",
  inputSchema: { intent: z.string().describe("What to build") },
  annotations: { readOnlyHint: true }
}, async ({ intent }) => ({
  content: [{ type: "text", text: `forge_plan for "${intent}": not yet implemented.` }]
}));
```

**Ship:** `/ship` — PR #3

---

### Feature 4: Setup Script + README

**Goal:** One-command setup that registers Forge in Claude Code's MCP config.

**Files to create:**

- **`setup.sh`** (executable)
  - **Requires:** Git Bash or MSYS2 on Windows (the project's development environment). Not compatible with PowerShell or cmd.exe.
  - Detects repo root via `SCRIPT_DIR`
  - Runs `npm install` + `npx tsc` if needed
  - Calls `node scripts/setup-config.cjs "$REPO_ROOT"` to merge MCP config (see below)
  - **Idempotency:** If `mcpServers.forge` already exists, overwrite it (preserving all other entries). Running setup.sh twice produces the same result.
  - Preserves all existing settings (currently: `context7` MCP + env/permissions)

- **`scripts/setup-config.cjs`** — Config merge helper
  - Accepts repo root as CLI argument
  - Reads `~/.claude/settings.json`, merges `mcpServers.forge`, writes back
  - MCP entry: `{ "command": "node", "args": ["dist/server/index.js"], "cwd": "<repo-path>" }`
  - **Edge case — missing config:** If `~/.claude/settings.json` does not exist, create it with `{ "mcpServers": { "forge": { ... } } }`. If `~/.claude/` directory does not exist, create it first.
  - **Edge case — corrupted config:** If `~/.claude/settings.json` exists but contains invalid JSON, print a clear error message (`ERROR: ~/.claude/settings.json contains invalid JSON. Please fix it manually or delete it and re-run setup.sh.`) and exit 1.
  - **Why a separate script instead of inline `node -e`:** Embedding Node.js in bash `node -e '...'` is fragile — shell quoting differs between Git Bash, MSYS2, and native Windows process creation. A dedicated `.cjs` file avoids all quoting issues and is independently testable.

- **`README.md`** — Project description, setup instructions, tool list

**Ship:** `/ship` — PR #4

---

### Feature 5: Integration Verification

**Goal:** Prove end-to-end: Claude Code starts -> Forge server starts -> tools appear.

**Steps:**
1. Run `./setup.sh` (or `bash setup.sh` on Windows if executable bit is not set)
2. Start new Claude Code session
3. Verify `forge_plan` appears in tool list
4. Call `forge_plan` — returns "not yet implemented" placeholder

**No PR needed** — this is a manual verification step.

---

## Test Cases & AC

| # | Test | Pass Condition | Verification Command |
|---|------|---------------|---------------------|
| AC-1 | `npm install` | Exit code 0 | `npm install && echo PASS` |
| AC-2 | `npx tsc` | Exit code 0, zero errors | `npx tsc && echo PASS` |
| AC-3 | `package.json` type field | `"type": "module"` present | `node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));process.exit(p.type==='module'?0:1)"` |
| AC-4 | CI workflow exists | `.github/workflows/ci.yml` present and valid | `test -f .github/workflows/ci.yml && echo PASS` |
| AC-5 | Code review workflow exists | `.github/workflows/code-review.yml` present | `test -f .github/workflows/code-review.yml && echo PASS` |
| AC-6 | Commit hooks install | `npm install` triggers postinstall, hooks appear in `.git/hooks/` | `test -f .git/hooks/commit-msg && test -f .git/hooks/pre-commit && echo PASS` |
| AC-7 | Server starts and accepts MCP init | Sends `initialize` JSON-RPC request, receives valid response with `"result"` field within 5 seconds | `timeout 5 bash -c 'echo '"'"'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'"'"' \| node dist/server/index.js 2>/dev/null \| head -1' \| node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.exit(r.result?0:1)})"` |
| AC-8 | `setup.sh` runs | Exit code 0 | `bash setup.sh && echo PASS` |
| AC-9 | MCP config written | `~/.claude/settings.json` has `mcpServers.forge.command === "node"` | `node -e "const s=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8'));process.exit(s.mcpServers?.forge?.command==='node'?0:1)"` |
| AC-10 | Existing MCP preserved | `mcpServers.context7` still present after setup | `node -e "const s=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8'));process.exit(s.mcpServers?.context7?0:1)"` |
| AC-11 | Tools discoverable | Claude Code session shows `forge_plan` in tool list (manual) | Manual: open new Claude Code session, check tool list |
| AC-12 | `.gitattributes` exists | Line ending rules present for `.sh`, `.cjs`, `.yml` | `test -f .gitattributes && grep -q 'eol=lf' .gitattributes && echo PASS` |
| AC-13 | Smoke test passes | `vitest run` exits 0, at least 1 test passes | `npx vitest run && echo PASS` |

---

## Files Summary

```
forge-harness/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # Build + test + conventional commits
│   │   └── code-review.yml        # AI code review on PRs
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.yml
│       └── feature_request.yml
├── server/
│   ├── index.ts                    # MCP server entry + tool registration
│   ├── tools/
│   │   ├── plan.ts                 # forge_plan placeholder
│   │   ├── plan.test.ts            # Smoke test for plan placeholder
│   │   ├── evaluate.ts             # forge_evaluate placeholder
│   │   ├── generate.ts             # forge_generate placeholder
│   │   └── coordinate.ts           # forge_coordinate placeholder
│   └── validation/
│       └── execution-plan.ts       # Schema validation stub
├── schema/
│   ├── execution-plan.schema.json  # Skeleton v3.0.0
│   └── eval-report.schema.json    # Skeleton
├── scripts/
│   ├── install-hooks.cjs           # Git hook installer (postinstall)
│   └── setup-config.cjs           # MCP config merge helper
├── dist/                           # (git-ignored) compiled output
├── docs/                           # (existing) planning documents
├── package.json
├── tsconfig.json
├── eslint.config.js
├── vitest.config.ts
├── .gitignore
├── .gitattributes                  # LF line endings for scripts/hooks
├── setup.sh
├── README.md
├── CONTRIBUTING.md
└── CHANGELOG.md
```

---

## Checkpoint

- [x] Feature 1: GitHub repo + project init (git, npm, tsconfig, .gitattributes) -> direct to master (bootstrap)
- [x] Feature 2: CI/CD + code review + hooks from hive-mind -> PR #1 merged
- [x] Feature 3: MCP server scaffold (index.ts, 4 tool stubs, schemas, smoke test) -> PR #2 merged
- [x] Feature 4: Setup script + README -> PR #3 merged
- [x] Feature 5: Integration verification (AC-1 through AC-13) — all 12 automated ACs pass
- [x] Send status update to smart-han via `/mailbox send`

Last updated: 2026-04-02T08:20+08:00

---

## Critique Log

### Round 1 (Critic-1)
- **CRITICAL:** 1
- **MAJOR:** 3
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | CRITICAL | AC-7 unreliable server test (passes on any non-1 exit code) | Yes | Replaced with proper MCP initialize JSON-RPC test |
| 2 | MAJOR | Zod ^3.25 unjustified when SDK accepts ^4.0 | Yes | Added explicit rationale (zod 4 module restructure risk) |
| 3 | MAJOR | destructiveHint: false on generate/coordinate (will be destructive) | Yes | Changed both to destructiveHint: true |
| 4 | MAJOR | setup.sh no error handling for corrupted JSON | Yes | Added corrupted JSON edge case with clear error + exit 1 |
| 5 | MINOR | "6 features" count wrong (only 5 exist) | Yes | Changed to "5 features" |
| 6 | MINOR | noUnusedParameters fires on placeholder stubs | Yes | Include parameter in return string via template literal |
| 7 | MINOR | Phase dependencies unexplained (workflow vs technical) | Yes | Added note clarifying dogfooding dependencies |
| 8 | MINOR | AC-3 uses import attributes unsupported on Node 18 | Yes | Dropped Node 18 from CI (EOL), changed AC-3 to fs.readFileSync |

### Round 2 (Critic-2)
- **CRITICAL:** 1
- **MAJOR:** 2
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | CRITICAL | AC-7 test hangs (no timeout, server won't exit after stdin EOF) | Yes | Wrapped with timeout 5 bash -c |
| 2 | MAJOR | AC-7 uses /dev/stdin (not portable on Windows) | Yes | Changed to process.stdin streaming |
| 3 | MAJOR | Schema files outside server/ with no build copy step | Yes | Added note that Phase 1+ needs resolution strategy |
| 4 | MINOR | ESLint config format unverified | Yes | Confirmed hive-mind uses flat config |
| 5 | MINOR | node -e quoting fragility in setup.sh | Yes | Extracted to scripts/setup-config.cjs helper |
| 6 | MINOR | No test files despite vitest setup | Yes | Added plan.test.ts smoke test + passWithNoTests |
| 7 | MINOR | Stricter tsconfig vs hive-mind portability | Yes | Added note about _ prefixing for ported code |

### Summary
- Total findings: 15 across both rounds
- Applied: 15 (100%)
- Rejected: 0 (0%)
- Key changes: Fixed AC-7 with proper MCP protocol test + timeout + Windows portability, added zod version rationale, corrected destructiveHint annotations, extracted setup.sh JSON logic to helper script, added smoke test, dropped Node 18 from CI, added .gitattributes for CRLF protection

---

## Corrector Notes — Findings Disposition (Round 1)

### Finding 1: AC-7 Server verification test is unreliable — VALID, FIXED

**Severity:** CRITICAL

The critic is correct. `test $? -ne 1` passes for segfaults (139), OOM (137), and other crash codes. The test proved nothing about the server actually working.

**Fix applied:** Replaced with a proper MCP protocol test. The new AC-7 sends an `initialize` JSON-RPC request on stdin and verifies the server returns a valid JSON-RPC response with a `result` field. This proves the server starts, reads the transport, and responds to the MCP protocol.

---

### Finding 2: Zod version pinned to ^3.25 but SDK accepts ^4.0 — VALID, FIXED

**Severity:** MAJOR

The critic is right that the choice was unstated. However, the fix is NOT to upgrade to zod 4 — it's to document why 3.x is chosen. Zod 4 changed its module structure (new `zod/v4/mini` path, different import conventions), and the MCP SDK examples all use zod 3.x patterns. Staying on 3.x for a Phase 0 scaffold is the conservative choice.

**Fix applied:** Added explicit rationale note under the `package.json` spec explaining why ^3.25 is chosen over ^4.0.

---

### Finding 3: `forge_generate` and `forge_coordinate` annotations — VALID, FIXED

**Severity:** MAJOR

The critic is correct. Annotations should reflect the tool's intended behavior, not its placeholder behavior. If these ship as `destructiveHint: false` and later change to `true`, that's a silent semantic change that affects Claude Code's auto-approval behavior.

**Fix applied:** Changed both `forge_generate` and `forge_coordinate` to `{ destructiveHint: true }`.

---

### Finding 4: No Feature 6 despite "6 features" claim — VALID, FIXED

**Severity:** MINOR

Straightforward counting error. There are 5 features (Features 1-5) plus a mailbox send step.

**Fix applied:** Changed "6 features" to "5 features" in the Context section.

---

### Finding 5: Missing error handling for setup.sh JSON manipulation — VALID, FIXED

**Severity:** MAJOR

The critic is right that corrupted JSON is a likely failure mode (hand-edited settings file). The permission errors and concurrent writes concerns are real but low-probability and harder to handle portably — those are MINOR at best and would over-engineer setup.sh for Phase 0.

**Fix applied:** Added an edge case bullet for corrupted JSON: print a clear error message and exit 1. Did NOT add handling for permission errors or concurrent writes (out of scope for Phase 0 scaffold).

---

### Finding 6: `noUnusedParameters` interaction with tool handler signatures — VALID, FIXED

**Severity:** MINOR

The critic is correct. The drafter's self-review claimed "parameters are used in the return value" but the code pattern shows `intent` destructured and never referenced — it returned a hardcoded string. This WILL trigger `noUnusedParameters`.

**Fix applied:** Changed the placeholder return strings to include the parameter via template literal (e.g., `` `forge_plan for "${intent}": not yet implemented.` ``). This is option (b) from the critic's suggestions — it both fixes the warning and produces more useful debug output. Updated the code example in the Key Pattern block to match.

---

### Finding 7: Phase dependency chain unexplained — VALID, FIXED

**Severity:** MINOR

The critic makes a fair point. The dependency is a workflow choice (dogfooding), not a technical constraint.

**Fix applied:** Added a note below the phases table clarifying these are dogfooding/workflow dependencies, not technical dependencies.

---

### Finding 8: AC-3 verification command uses import attributes (Node 20.10+ only) — VALID, FIXED

**Severity:** MINOR

The critic is correct that `import ... with { type: 'json' }` requires Node 20.10+. Since Node 18 is EOL (April 2025), the right fix is both: drop Node 18 from CI AND simplify the AC-3 command to use `require('fs').readFileSync` for robustness.

**Fix applied:**
- Changed CI matrix from "Node 18+20" to "Node 20" in Feature 2.
- Added a note that Node 18 is EOL.
- Changed AC-3 verification command to use `require('fs').readFileSync` + `JSON.parse`.

---

## Corrector Notes — Findings Disposition (Round 2)

### Finding 1: AC-7 test may hang — no timeout, server won't exit after stdin EOF — VALID, FIXED

**Severity:** CRITICAL

The critic is correct. The MCP SDK's `StdioServerTransport` keeps the process alive waiting for more input after stdin EOF. On Windows (Git Bash/MSYS2), SIGPIPE behavior from `head -1` closing its read end is unreliable — the pipeline could hang indefinitely.

**Fix applied:** Wrapped the AC-7 command with `timeout 5 bash -c '...'` so the test is bounded to 5 seconds. If the server hangs, the test fails cleanly with a non-zero exit code rather than blocking forever.

---

### Finding 2: AC-7 uses `/dev/stdin` — not portable on Windows — VALID, FIXED

**Severity:** MAJOR

The critic is correct. Node.js on Windows does not reliably support `readFileSync('/dev/stdin')`. Even though Git Bash provides some `/dev/` emulation, the Node.js process runs natively on Windows and may fail with ENOENT or EACCES.

**Fix applied:** Changed the AC-7 verification to use `process.stdin.on('data'/'end')` streaming instead of `readFileSync('/dev/stdin')`. This is portable across all platforms.

---

### Finding 3: Schema files outside `server/` with no build copy step — VALID, NOTED

**Severity:** MAJOR

The critic is correct that `schema/` lives outside `rootDir: "server"` and won't be included in `dist/`. However, this is not an active problem in Phase 0 — the validation stub returns `{ valid: true }` and does not read the schema files. The schema files are structural placeholders.

**Fix applied:** Added a note in Feature 3 under the schema files acknowledging this gap and specifying that Phase 1+ will need either a build copy step or runtime resolution via `process.cwd()`. Did NOT move the schemas under `server/` because they are not TypeScript source files and don't belong in the compilation unit.

---

### Finding 4: ESLint config format not verified — VALID, NOTED

**Severity:** MINOR

The critic raises a valid concern. However, I verified that hive-mind uses ESLint flat config format (`export default [...]` in `eslint.config.js`), which is compatible with `"type": "module"`.

**Fix applied:** Added a note in Feature 2 confirming the flat config format has been verified.

VERIFIED: hive-mind ESLint uses flat config format — found at `C:\Users\ziyil\coding_projects\hive-mind\eslint.config.js` line 4 — `"export default ["`

---

### Finding 5: `node -e` in setup.sh fragile on Windows quoting — VALID, FIXED

**Severity:** MINOR

The critic is correct. Embedding Node.js inside `node -e '...'` with JSON manipulation is prone to quoting issues across Git Bash, MSYS2, and native Windows.

**Fix applied:** Changed setup.sh to call `node scripts/setup-config.cjs "$REPO_ROOT"` instead of inline `node -e`. The new `scripts/setup-config.cjs` helper handles all JSON read/merge/write logic. Added to Files Summary.

---

### Finding 6: No test files created despite vitest config — VALID, FIXED

**Severity:** MINOR

The critic is correct. `vitest run` with zero test files may exit non-zero depending on version/config. Two fixes applied:

**Fix applied:**
1. Added `passWithNoTests: true` to vitest config spec in Feature 2 as a safety net.
2. Added `server/tools/plan.test.ts` smoke test in Feature 3. This gives CI a real test to run and verifies the placeholder handler works.
3. Added AC-13 to verify the smoke test passes.

---

### Finding 7: Stricter tsconfig vs hive-mind code portability — VALID, NOTED

**Severity:** MINOR

The critic is correct. Hive-mind does not use `noUnusedLocals` or `noUnusedParameters`, so any code ported from hive-mind may need `_` prefixing on unused callback parameters.

**Fix applied:** Added a one-line note in the tsconfig rationale section.

---

## Self-Review Checklist (Final)

### 1. Conflicts
- AC-7 rewrite uses `timeout 5` (Unix). This is available in Git Bash/MSYS2 (provided by coreutils). The setup.sh already requires Git Bash/MSYS2, so this is consistent. No conflict.
- `scripts/setup-config.cjs` is a new file: added to Feature 4 (where setup.sh is defined), Files Summary, and the checkpoint. All three locations agree. No conflict.
- `plan.test.ts` is a new file: added to Feature 3, Files Summary, AC-13, and checkpoint. All four locations agree. No conflict.
- `passWithNoTests` is added to vitest config in Feature 2 — this is a safety net alongside the smoke test in Feature 3. They don't conflict; they complement each other (belt and suspenders).
- Changing from inline `node -e` to `scripts/setup-config.cjs`: Feature 4's MCP entry still says `"args": ["dist/server/index.js"]`. The setup-config.cjs writes this entry. No conflict with Feature 1's `"start"` script which also references `dist/server/index.js`. Consistent.

### 2. Edge cases
- AC-7 with `timeout 5`: If the MCP server takes >5s to start (e.g., slow `npm install` or cold module resolution), the test would false-fail. However, a Phase 0 scaffold with 4 placeholder tools should start in <1s. 5 seconds is generous. No real edge case.
- `setup-config.cjs` receives repo root as CLI argument. If called without an argument, `process.argv[2]` is undefined. The script should validate this. This is an implementation detail — added a note about "accepts repo root as CLI argument" which implies validation. Acceptable for a plan-level spec.
- Smoke test imports placeholder handler: the handler is defined inline in `server/tools/plan.ts`. It needs to be exported for testing. This means the tool registration in `server/index.ts` imports the handler from `plan.ts`, and the test also imports it. This is a standard pattern. No edge case.

### 3. Interactions
- Finding 5 (setup-config.cjs) + Finding 6 (smoke test): Both add new files. No interaction — they affect different features (4 and 3 respectively).
- Finding 1 (AC-7 timeout) + Finding 2 (process.stdin portability): Both modify AC-7. They compose cleanly — the outer `timeout` wraps the pipeline, and the inner `node -e` uses `process.stdin`. No interaction.
- AC-13 (smoke test) + vitest `passWithNoTests`: If the smoke test exists, `passWithNoTests` is a no-op. If the smoke test were deleted, `passWithNoTests` prevents CI failure. No negative interaction.

### 4. New additions traced
- **`scripts/setup-config.cjs`:** Defined in Feature 4. Referenced in setup.sh description ("Calls `node scripts/setup-config.cjs`"). Listed in Files Summary. Not in AC table — AC-8 (`bash setup.sh && echo PASS`) tests it indirectly via setup.sh. Complete.
- **`server/tools/plan.test.ts`:** Defined in Feature 3. Listed in Files Summary. Tested by AC-13. Complete.
- **AC-13:** Added to AC table. Checkpoint updated to "AC-1 through AC-13". Complete.
- **`passWithNoTests` in vitest config:** Noted in Feature 2 vitest.config.ts spec. Not tested by a dedicated AC (it's a safety-net config). Acceptable.
- **`timeout 5` in AC-7:** Applied to AC-7 verification command only. Not referenced elsewhere. Complete.

### 5. Evidence-gated verification
- VERIFIED: hive-mind uses ESLint flat config — found at `C:\Users\ziyil\coding_projects\hive-mind\eslint.config.js` line 4 — `"export default ["`
- VERIFIED: hive-mind install-hooks.cjs has no `src/` references — found at `C:\Users\ziyil\coding_projects\hive-mind\scripts\install-hooks.cjs` lines 1-70 — no occurrence of `src/` in the entire file. The pre-commit hook runs `npx tsc --noEmit` (project-wide, not path-specific).
- VERIFIED: hive-mind tsconfig has NO `noUnusedLocals` or `noUnusedParameters` — found at `C:\Users\ziyil\coding_projects\hive-mind\tsconfig.json` — neither option present (confirmed during Round 1).
- VERIFIED: MCP SDK peer dep is `zod: "^3.25 || ^4.0"` — `npm view @modelcontextprotocol/sdk peerDependencies` returned `{ '@cfworker/json-schema': '^4.1.1', zod: '^3.25 || ^4.0' }` (confirmed during Round 1).
- VERIFIED: MCP SDK reference says "DO NOT use: Old deprecated APIs such as server.tool()" — found at `~/.claude/skills/mcp-builder/reference/node_mcp_server.md` line 60 (confirmed during Round 1).
