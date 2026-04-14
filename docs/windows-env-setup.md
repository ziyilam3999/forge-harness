# Windows env setup for forge-harness MCP

**Audience:** Windows developers running `forge-harness` MCP locally under Claude Code.
**Problem solved:** `mcp__forge__forge_evaluate`, `forge_plan`, `forge_generate`, `forge_coordinate`, `forge_reconcile` all return `401 "OAuth authentication is currently not supported"` even though your API key is set in `~/.bashrc`.
**Last validated:** 2026-04-14 against Claude Code on Windows 11 with `node dist/index.js` MCP child.

---

## ELI5 — what's broken

Your API key lives in `C:\Users\<you>\.bashrc` as `export ANTHROPIC_API_KEY=sk-ant-...`. Only **Git Bash** reads `.bashrc` when it starts up. Every other way of launching a program on Windows — Start menu shortcut, desktop icon, `cmd.exe`, PowerShell, Task Scheduler, double-clicking a `.bat` file — completely skips `.bashrc`.

So:

- ✅ **Launch Claude Code from Git Bash** → bash sources `.bashrc` → key is in env → Claude Code inherits it → MCP child (`node dist/index.js`) inherits it → Anthropic API calls work.
- ❌ **Launch Claude Code from Start menu / desktop shortcut / any non-bash context** → no `.bashrc` sourced → key never enters env → MCP child inherits empty key → falls back to OAuth → Anthropic API rejects OAuth on direct calls → **401 error chain**.

The 401 message says "OAuth authentication is currently not supported" because that's the documented behavior of the Anthropic SDK when it tries to use a Max plan OAuth token against the public `api.anthropic.com` endpoint without going through Claude Code's proxy layer. See `server/lib/anthropic.ts:47-79` in forge-harness and the source comment at line 65.

---

## The fix — 2 steps, one-time, ~60 seconds

### Step 1 — store the key as a Windows user-level env var

Open **any** terminal (does not need to be Git Bash — the whole point is to make it launcher-agnostic). Run **one** of these commands, substituting the value from your existing `.bashrc`:

**PowerShell:**
```powershell
[System.Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', 'sk-ant-...YOUR_FULL_KEY...', 'User')
```

**cmd.exe (equivalent):**
```cmd
setx ANTHROPIC_API_KEY "sk-ant-...YOUR_FULL_KEY..."
```

**Git Bash (pipes the already-loaded env var into setx without displaying it):**
```bash
setx ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"
```

All three write to the Windows user registry hive at `HKCU\Environment`. Effect: every program launched afterward, from any launcher and by any mechanism, inherits `ANTHROPIC_API_KEY` in its `process.env`.

Verify the write landed:
```bash
reg query 'HKCU\Environment' //v ANTHROPIC_API_KEY
```
(In Git Bash the double-slash `//v` is needed to prevent MSYS path translation. In cmd/PowerShell use a single `/v`.)

> **Gotcha:** the shell you run `setx`/`SetEnvironmentVariable` in does **not** update its own env. You must open a **new** terminal window to see the change take effect in a shell's `$env`. If you skip this, you'll think Step 1 didn't work when it actually did.

### Step 2 — leave `~/.bashrc` alone

Do **not** delete the `export ANTHROPIC_API_KEY=...` line from `~/.bashrc`. The duplication is intentional safety:

- Git Bash users still get the key from `.bashrc` without depending on the Windows env var
- If you ever rotate the key in one place but forget the other, Git Bash sessions keep working against the old value (single point of failure avoided)
- There's no functional downside — bash just reads its copy into its own env, which matches the Windows env var anyway

Add a comment above the `.bashrc` line as a rotation reminder:

```bash
# Also set as a Windows user env var via `setx ANTHROPIC_API_KEY`.
# When rotating, update BOTH places or they'll drift.
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

## Verification — 5 binary checks

Run these in order. Every step is pass/fail with no room for interpretation.

### AC-win-01 — cmd.exe sees the key
Open a **new** `cmd.exe` window (Start menu → `cmd` → Enter). Run:
```cmd
echo %ANTHROPIC_API_KEY%
```
✅ **Pass:** prints the full key, 108 characters, starting with `sk-ant-a`.
❌ **Fail:** prints `%ANTHROPIC_API_KEY%` literally, or blank. Re-run Step 1 and verify you opened a NEW cmd window (not the one you ran `setx` in).

### AC-win-02 — PowerShell sees the key
Open a **new** PowerShell window. Run:
```powershell
$env:ANTHROPIC_API_KEY.Length
```
✅ **Pass:** prints `108`.
❌ **Fail:** prints nothing or errors. Re-run Step 1 with the PowerShell syntax.

### AC-win-03 — Claude Code launches cleanly from a Windows shortcut
1. Fully exit Claude Code. Open Task Manager (`Ctrl+Shift+Esc`), end any `claude.exe` process, and any `node.exe` whose command line contains `dist/index.js`. Use the Details tab with the "Command line" column enabled to identify the MCP child.
2. Relaunch Claude Code from a **Start menu shortcut or desktop icon** — deliberately NOT from Git Bash. The point is to prove the fix works from non-bash launch contexts.
3. Claude Code should show a prompt: *"Detected a custom API key in your environment — do you want to use this API key?"*
4. Pick option **2** ("No (recommended)"). This is the correct choice: your Max plan uses OAuth for interactive operations, while the MCP child uses the env-var API key for structured primitive calls. Picking "No" is about Claude Code's **own** calls, not about what the MCP child inherits.

✅ **Pass:** the prompt appears, you pick "No", Claude Code boots normally.
❌ **Fail:** no prompt appears (Claude Code can't see the env var → Step 1 didn't take effect); OR the prompt appears but Claude Code errors out after selecting "No".

### AC-win-04 — MCP child authenticates with the key
In the Claude Code session from AC-win-03, ask Claude to run:
```
mcp__forge__forge_evaluate({
  evaluationMode: "critic",
  projectPath: "C:\\Users\\ziyil\\coding_projects\\forge-harness"
})
```

Expect 12 results (one per plan file under `.ai-workspace/plans/*.json`). Look at the `error` field of each result.

✅ **Pass:** every result has `"type":"invalid_request_error"` and a message starting with `"Your credit balance is too low..."`. HTTP status 400. Contains a real `request_id` field like `req_011Ca3Xk...`. This confirms the API calls reached Anthropic's servers with authenticated credentials and only failed on the credit paywall (which is the expected state if your key has no remaining balance).
❌ **Fail:** any result has `"type":"authentication_error"` or message `"OAuth authentication is currently not supported"`. This means the MCP child is still falling back to OAuth — Step 1 didn't propagate. Re-verify AC-win-01 and AC-win-02 first. If those pass but AC-win-04 still shows 401, open an issue in forge-harness with: the full error envelope, the output of `echo %ANTHROPIC_API_KEY% | findstr /c:sk-ant`, and the Claude Code launch method you used.

### AC-win-05 — Git Bash path still works (no regression)
Open a Git Bash window. Run:
```bash
echo ${#ANTHROPIC_API_KEY}
```
✅ **Pass:** prints `108`. Confirms `.bashrc` still loads the key into Git Bash's env, so Git-Bash-launched Claude Code sessions are unaffected by the Windows-env-var change.
❌ **Fail:** prints `0`. Your `.bashrc` export is missing or broken — unrelated to this fix, but worth fixing.

---

## If you top up the API key later

Once the key has credit again, AC-win-04 will change: successful critic-eval runs will return `findings: [...]` arrays with actual review output instead of credit-too-low errors. No further config change needed — the auth path is already correct.

## If you rotate the key

Update **both** places atomically:

1. Run `setx ANTHROPIC_API_KEY "sk-ant-new-value..."` (or PowerShell equivalent)
2. Edit `~/.bashrc` and replace the old value in the `export` line
3. Restart all open Claude Code sessions (the MCP child cached the old key at spawn time)

Run AC-win-01 and AC-win-05 after rotation to confirm both places took effect.

---

## Mac/Linux users

This problem doesn't manifest on Mac or Linux because `~/.bashrc` or `~/.zshrc` is universally sourced by interactive terminals and most IDE launchers on those platforms. If you're on Mac/Linux, the Git-Bash-vs-Start-menu distinction doesn't exist — launch Claude Code however you like, it'll inherit the key.

---

## Why this documentation exists

On 2026-04-14, a debugging session burned ~3 hours re-discovering this problem from scratch because no documentation captured the root cause. The diagnostic chain went: (1) assume critic-eval has a bug, (2) assume OAuth flake, (3) assume auth model issue, (4) finally measure the actual `anthropic.ts` source and compare Git-Bash-launched vs non-Git-Bash-launched sessions side-by-side. The fix is two commands. The diagnosis took two dozen mailbox exchanges across three Claude sessions. This doc exists so nobody repeats that path.

See also:
- `feedback_use_working_fallback_dont_fix_broken_primary` in project memory
- `feedback_mcp_determinism_is_output_schema` in project memory
- `feedback_cite_dont_recall_is_recursive` in project memory
