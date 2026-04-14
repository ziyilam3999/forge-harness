# Windows Compat & Test Resilience

## ELI5
Fix a test that breaks on Windows because it uses a fake Unix path, make some other tests work on any computer (not just Mac/Linux), pull out a shared helper so tests don't repeat themselves, and stop using fragile "check the 3rd call" in tests so they don't break when we add new internal calls.

## Changes

### 1. Fix codebase-scan.ts path validation (failing test)
- **Root cause**: On Windows, `/nonexistent/path/xyz` is drive-root-relative — `stat()` resolves it to `C:\nonexistent\path\xyz` instead of throwing
- **Fix**: Use `path.resolve()` before `stat()` so the path is fully resolved on all platforms
- **Test fix**: Use `path.join(os.tmpdir(), "nonexistent-xyz-" + random)` for a guaranteed-missing absolute path

### 2. Issue #60: Replace tail/head in dogfood AC commands
- Lines 172, 185, 190 in `dogfood-divergence.test.ts`
- Replace `| tail -N | head -1` with `npx vitest run ... --reporter=json` or just drop the pipe and check exit code

### 3. Issue #61: Extract shared extractPlanJson utility
- Move `extractPlanJson()` from `three-tier-integration.test.ts` to `server/lib/test-utils.ts`
- Update imports

### 4. Issue #62: Replace magic mock.calls indices
- Lines 322, 530 in `three-tier-integration.test.ts`
- Replace `mock.calls[2][0]` / `mock.calls[3][0]` with `findCallByContent()` helper that searches by message content

## Test Cases & AC
- [ ] `npx vitest run server/lib/codebase-scan.test.ts` — all tests pass (including "throws for non-existent path")
- [ ] `npx vitest run server/tools/dogfood-divergence.test.ts` — all tests pass
- [ ] `npx vitest run server/tools/three-tier-integration.test.ts` — all tests pass
- [ ] No `tail` or `head` commands remain in dogfood-divergence.test.ts
- [ ] `extractPlanJson` is importable from `server/lib/test-utils.ts`
- [ ] No `mock.calls[2]` or `mock.calls[3]` patterns in three-tier-integration.test.ts
- [ ] Full suite: `npx vitest run` — 280/280 pass

## Checkpoint
- [ ] Fix 1: codebase-scan path validation
- [ ] Fix 2: dogfood AC commands
- [ ] Fix 3: extract shared test utility
- [ ] Fix 4: resilient mock matching
- [ ] All 280 tests pass

Last updated: 2026-04-06
