---
title: "Promotion PR — README + Tools-table rewrite (cost-discipline angle)"
date: 2026-04-25
driver: forge-plan
upstream_brief: ../../../claude-code-mailbox/mailbox/archive/2026-04-21T0930-monday-to-forge-plan-promote-cost-discipline-as-a-feature-ready-copy.md
status: drafted (awaiting /coherent-plan)
---

## Context

monday-bot's lead agent (handle: `monday`) sent a fully-drafted promotion package on 2026-04-21 in mailbox thread `forge-harness-cost-discipline-promo-2026-04-21`. The user-facing observation that motivated it: forge-harness's current README buries the most distinctive architectural property — that **only one of eight primitives ever calls the LLM**. Most AI-agent frameworks LLM-route every decision (dispatch, grading, phase transitions); forge inverts that. The brief includes verified ground-truth numbers from a real 4-stories-shipped project: 16 non-status tool calls, 2 paid (both `forge_plan`), $0.80 total, $0.20/story amortised, $0 out-of-pocket on Max plan.

The README in `master` currently only documents 4 of the 8 shipped primitives (plan / evaluate / generate / coordinate). It misses `forge_reconcile`, `forge_lint_refresh`, `forge_status`, and `forge_declare_story` entirely; the Status section claims "all four primitives are implemented." That's both stale and undersells the surface. Even without the cost-discipline angle, the README is overdue for a rewrite. This PR does both jobs at once — bring the README to current reality AND foreground the cost-discipline architectural property.

**Why now.** v0.35.2 just shipped on master (HEAD `d2450f0`). monday's outreach has been pending since 2026-04-21 (4 days). The v0.36.0 living-docs pipeline (next headline) will modify `server/tools/*.ts` heavily — landing the README rewrite first avoids a trivial merge-window where docs and code shift simultaneously.

**Driver decision.** Per task #155's tag (`driver=forge-plan, tagline=B`), forge-plan drives the PR (monday's Option B). Tagline = B (architecture-forward), with one amendment: drop the "Sixteen primitive calls" count line from B because monday's own mail has it inconsistent with her narrative ("15 tool calls" vs. "Sixteen"); the table carries that information without needing a count in the tagline.

**Vetting findings (planner-side, before delegation):**
- monday's Tools table omits `forge_reconcile` — must be added; 8 tools total.
- monday's "Sonnet 4" model claim is approximately correct — actual model is `claude-sonnet-4-6` per `server/lib/anthropic.ts:6`. Use "Sonnet 4.6" for precision, or accept "Sonnet 4" as the family label. Picked "Sonnet 4.6" — it matches reality and signals freshness.
- monday's "No LLM" flag for `forge_evaluate` is true for the default `story` mode but the `coherence` sub-mode IS LLM-judged. Same situation for `forge_reconcile` (indirectly triggers `forge_plan`'s LLM pipeline via plan-update routing). Solution: footnote on the table noting that two of the deterministic tools have rarely-used LLM-bearing sub-modes; the cost claim ("$0 per call") still holds for the dominant happy paths.
- Tagline B count typo (16 vs 15): drop the count from the tagline; let the table speak.

## Goal (invariants when done)

- **G1.** README accurately documents all 8 currently-registered MCP primitives (matches `server.registerTool` calls in `server/index.ts`).
- **G2.** README's lede sentence is replaced with the architecture-forward tagline (variant B, sans the "Sixteen calls" count).
- **G3.** README contains a "Why forge-harness?" section between the badges block and Quick Start that names the deterministic-orchestration property and includes monday-bot's receipts as evidence.
- **G4.** No source code, schema, scripts, or workflow YAML files are modified. PR diff is README-only (plus optional CHANGELOG line if the executor chooses).
- **G5.** No factual claim in the README is contradicted by the live code at `master` HEAD at PR-open time. (Verified by spot-check ACs below.)
- **G6.** The privacy hard-rule from CLAUDE.md is honored — no employer-brand mentions in the diff.

## Binary AC (observable from outside the diff)

- [ ] **AC-1.** `git diff origin/master..HEAD --name-only` lists only `README.md`, optionally `CHANGELOG.md`, the CLAUDE.md-mandated acceptance wrapper at `scripts/<slug>-acceptance.sh` (executor picks the slug), this plan file at `.ai-workspace/plans/2026-04-25-promotion-pr-readme-rewrite.md`, and any ship-fix micro-plans at `.ai-workspace/plans/2026-04-25-ship-fix-N.md` (these document Stage 5 reviewer-driven amendments). Verify: `git diff origin/master..HEAD --name-only | grep -v -E '^(README\.md|CHANGELOG\.md|scripts/[a-z0-9-]+-acceptance\.sh|\.ai-workspace/plans/2026-04-25-(promotion-pr-readme-rewrite|ship-fix-[0-9]+)\.md)$' | wc -l` returns `0`. (Any path outside the allowlist counts as a failure; plan-file paths are named via a tight alternation so unrelated plan edits cannot leak into the diff. Widened twice mid-flight 2026-04-25: first to admit the parent plan, then to admit ship-fix micro-plans after Stage 5 reviewer caught a privacy literal that required a fix-iteration plan.)
- [ ] **AC-2.** README contains all 8 primitive names (case-sensitive, in code-fence form). Verify: `grep -c -E '^\| \`forge_(plan|evaluate|generate|coordinate|reconcile|lint_refresh|status|declare_story)\`' README.md` returns `8`.
- [ ] **AC-3.** README's H1 is followed (within 30 lines) by exactly one paragraph whose text matches the architecture-forward tagline shape. Verify: `head -30 README.md | grep -c -i "harness coordinates"` returns `1` AND `head -30 README.md | grep -c -i "agent implements"` returns `1`. (Two independent phrase anchors prevents the executor from satisfying via partial-match.)
- [ ] **AC-4.** README contains a section heading exactly `## Why forge-harness?` (matches the heading shape used in monday's brief; the trailing question mark stays because that's the literal copy we're shipping). Verify: `grep -c '^## Why forge-harness?$' README.md` returns `1`.
- [ ] **AC-5.** "Why forge-harness?" section appears BEFORE "Quick Start". Verify: `awk '/^## Why forge-harness\?/{w=NR} /^## Quick Start/{q=NR} END{exit !(w>0 && q>0 && w<q)}' README.md` exits 0.
- [ ] **AC-6.** "Why forge-harness?" section names monday-bot as a real-project receipt with the four anchor numbers ($0.80, $0.20/story, 2-of-16-paid or 1-of-8-LLM, $0 on Max). Verify: `awk '/^## Why forge-harness\?/{f=1;next} /^## /{f=0} f' README.md | grep -oE '\$0\.80|\$0\.20|Max plan' | wc -l` returns ≥ `3`. (Flag-based slice instead of awk's `/X/,/Y/` range — when X and Y can both match the same line, `/X/,/Y/` collapses to one line; the flag form skips the heading and walks the body until the next `## ` heading. Mid-flight planner amendment 2026-04-25 after executor flagged the awk range bug; original /coherent-plan pass missed it.)
- [ ] **AC-7.** Status section is updated to "eight primitives" (current text says "four"). Verify: `grep -i "eight primitives\|all 8 primitives\|all eight" README.md | wc -l` returns ≥ `1` AND `grep -i "all four primitives" README.md | wc -l` returns `0`.
- [ ] **AC-8.** Mermaid diagram (currently lists 4 of 8 primitives) is updated to show all 8, OR replaced with prose / a different visual that still surfaces the deterministic-vs-LLM split. Verify: if `grep -c '^\`\`\`mermaid$' README.md` ≥ `1`, then the mermaid block contains all 8 primitive names; else (no mermaid present), no further check. Concrete: `awk '/^\`\`\`mermaid$/,/^\`\`\`$/' README.md | grep -oE 'forge_(plan|evaluate|generate|coordinate|reconcile|lint_refresh|status|declare_story)' | sort -u | wc -l` returns `8` (when a mermaid block exists) or `0` (when none).
- [ ] **AC-9.** No employer-brand string appears anywhere in the **entire PR diff** (not just `README.md` — widened mid-flight 2026-04-25 after Stage 5 reviewer caught a privacy-token literal in the wrapper that the README-only scope missed). Verify: reviewer reads the literal regulated-token list from `~/.claude/agent-working-memory/tier-b/topics/privacy/no-employer-brand.md`, then for each token T runs `git diff origin/master..HEAD | grep -i -F -e '<T>'` (using fixed-string `-F`, NOT regex; NO path filter) and confirms zero matches. Reviewer must NOT inline the tokens in any artefact except this manual check — per the privacy hard-rule, only the privacy card file legitimately holds the literal tokens. Result: every token's grep returns empty.
- [ ] **AC-10.** Documentation links in README still resolve. Verify: every relative link target referenced from README.md exists. `node -e 'const fs=require("fs"); const md=fs.readFileSync("README.md","utf8"); const links=[...md.matchAll(/\]\(([^)]+\.md)\)/g)].map(m=>m[1]).filter(l=>!l.startsWith("http")); const missing=links.filter(l=>!fs.existsSync(l)); if(missing.length){console.error("missing:",missing);process.exit(1)} process.exit(0)'` exits 0.
- [ ] **AC-11.** `npm run build` and `npm test` still pass on the branch (sanity — no accidental code touch). Verify: both exit 0.

## Out of scope

- **GitHub repo metadata** (Description / Topics / Website fields). monday's mail offers ready-to-paste copy; the user picks and applies these manually via the GitHub UI. NOT in this PR's diff.
- **Release-notes copy for v0.35.x**. No release ships in this PR. Next release that ships (v0.36.0 at Phase D end) MAY include the "Why?" line from monday's mail; that's that PR's call.
- **Social / launch tweet template**. Stored in monday's mail for future reference; not a diff item.
- **`docs/receipts.md` page**. Mentioned in monday's mail as a future moat; out of scope for this PR. If we add it later, monday explicitly offered to bootstrap it from her data.
- **Any code, schema, scripts, server/, or test changes.** This is a docs-only PR.
- **Tagline candidates A / C / D.** Decision is locked on B-amended (architecture-forward, no count). Other variants stay in monday's mail as not-shipped alternatives.
- **Auto-fixing the `forge_evaluate` "(coherence mode is LLM)" / `forge_reconcile` "(triggers plan-update LLM)" edge cases in code.** They're documented via a footnote in the table — no code change needed.

## Ordering constraints

None. Single PR, single commit shape, no inter-AC dependencies.

## Verification procedure (reviewer's one-shot)

Run from the repo root on the executor's branch:

```bash
# Every AC in order. Stop at the first failure.
git diff origin/master..HEAD --name-only | grep -v -E '^(README\.md|CHANGELOG\.md|scripts/[a-z0-9-]+-acceptance\.sh|\.ai-workspace/plans/2026-04-25-(promotion-pr-readme-rewrite|ship-fix-[0-9]+)\.md)$' | wc -l   # AC-1: 0 paths outside allowlist
grep -c -E '^\| `forge_(plan|evaluate|generate|coordinate|reconcile|lint_refresh|status|declare_story)`' README.md  # AC-2: 8 tools
head -30 README.md | grep -c -i "harness coordinates"                                 # AC-3a
head -30 README.md | grep -c -i "agent implements"                                    # AC-3b
grep -c '^## Why forge-harness?$' README.md                                            # AC-4
awk '/^## Why forge-harness\?/{w=NR} /^## Quick Start/{q=NR} END{exit !(w>0 && q>0 && w<q)}' README.md  # AC-5
awk '/^## Why forge-harness\?/{f=1;next} /^## /{f=0} f' README.md | grep -oE '\$0\.80|\$0\.20|Max plan' | wc -l  # AC-6 (>= 3) — flag-based slice; range form collapses on same-line match
grep -i 'eight primitives\|all 8 primitives\|all eight' README.md                     # AC-7a
grep -i 'all four primitives' README.md                                                # AC-7b (must be empty)
awk '/^```mermaid$/,/^```$/' README.md | grep -oE 'forge_(plan|evaluate|generate|coordinate|reconcile|lint_refresh|status|declare_story)' | sort -u | wc -l   # AC-8 (8 if mermaid present, 0 if not)
# AC-9: reviewer reads ~/.claude/agent-working-memory/tier-b/topics/privacy/no-employer-brand.md, then runs `git diff origin/master..HEAD | grep -i -F -e '<T>'` per token (FULL diff, no path filter), every token returns empty
# AC-10: relative-link existence (the node -e one-liner from the AC list)
npm run build && npm test                                                              # AC-11
```

Reviewer is the stateless subagent spawned by `/ship` after PR creation. Reviewer runs each command, reports pass/fail, surfaces the failing AC names back to forge-plan if anything is red.

## Critical files

### Modified (executor edits)

- **`README.md`** — the only file whose diff matters. Executor decides the exact prose; the AC above are the contract.

### Optional (executor's call)

- **`CHANGELOG.md`** — executor MAY add a one-line "docs: README rewrite (cost-discipline framing)" entry under an `## [Unreleased]` heading. No release happens in this PR; the line propagates to the next release CHANGELOG. Skipping this is fine — `/ship` doesn't require it for docs PRs.

### Source-of-truth references (executor reads, never edits)

- **`server/index.ts`** — authoritative list of registered primitives (8 calls to `server.registerTool`).
- **`server/lib/anthropic.ts:6`** — authoritative model identifier (`DEFAULT_MODEL = "claude-sonnet-4-6"`).
- **monday's brief** at `~/claude-code-mailbox/mailbox/archive/2026-04-21T0930-monday-to-forge-plan-promote-cost-discipline-as-a-feature-ready-copy.md` — ready-to-paste copy. Executor adapts; planner-side amendments above are the diff against monday's literal text.

### NOT touched

- `server/**`, `schema/**`, `scripts/**`, `.github/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `dist/**`, `.forge/**`.

## Considered alternatives (why this shape, not another)

- **Tagline A (cost-forward) vs B (architecture-forward).** A leads with "$0", B leads with "the harness coordinates and the agent implements." A is punchier for social; B sets up the architectural argument that the rest of the README backs up with numbers. Picked B because the README is the architecture document, not a marketing landing page. A's punchiness lives in the tweet template (out of scope here).
- **Tagline B with vs. without the "Sixteen calls" count.** Without — monday's mail has internal count inconsistency (15 in narrative, 16 in tagline). Forcing a number into the tagline means committing to one count framing in the README's first sentence. The Tools table itself surfaces 8 tools and the "Why?" section uses 2-of-16 in body text where it can be qualified. Cleaner.
- **Include `forge_reconcile` in the Tools table or omit it.** Include. monday omitted it; her data shows `monday-bot` doesn't use it. But it's a registered MCP tool — omitting it would mean the README documents a 7-tool surface while the server exposes 8, repeating the precise drift this PR is fixing.
- **"Sonnet 4" vs "Sonnet 4.6" in the LLM column.** Picked 4.6 — it matches `DEFAULT_MODEL = "claude-sonnet-4-6"` exactly. README readers who care about model versioning will be checking against the code; matching reality avoids a future `s/Sonnet 4/Sonnet 4.6/` chore.
- **Single PR for README + GitHub repo metadata + release notes vs. README-only.** README-only. Repo metadata and release notes need user-side action (UI clicks, release-cut timing) and don't belong in a code PR's diff. Splitting them out is monday's Option C territory.
- **"Why forge-harness?" before vs. after Quick Start.** Before. The lede property (most-deterministic AI harness) is the *why-should-I-care* before the *how-do-I-install*. Most READMEs lead with install-first because they have nothing to say first; we have something to say.
- **Replace the mermaid diagram vs. expand it.** Expand it (or accept either). The current mermaid lists 4 of 8 — it would mislead a reader who reads the diagram before the table. Either fix is acceptable; the executor picks. AC-8 enforces the outcome ("if mermaid, must list 8") without prescribing whether to extend or replace.

## Checkpoint (living)

- [x] Vet monday's brief against live repo (8 vs 7 tools, model id, "No LLM" footnote-worthy edges, tagline B count typo).
- [x] Plan drafted at `.ai-workspace/plans/2026-04-25-promotion-pr-readme-rewrite.md`.
- [x] `/coherent-plan` critique pass on this plan (outcome plan — coherent-plan, not double-critique). Result: 3 major + 3 minor findings, all fixed in place. Threshold escalated; recommended-next = option 2 (fix-and-rerun, completed); double-critique declined per CLAUDE.md "What didn't work" doctrine on outcome plans.
- [ ] `/delegate --via subagent` to executor; brief includes monday's mail path + this plan path + the four planner-side amendments.
- [ ] Executor returns "branch ready, wrapper green."
- [ ] `/ship` opens PR + spawns stateless reviewer.
- [ ] PR merged to master.
- [ ] Reply to monday in thread `forge-harness-cost-discipline-promo-2026-04-21` with: PR URL, decision on her offered driver options (we chose her **Option B = forge-plan drives**, tagline = candidate **B (architecture-forward)** — the two Bs are independent labels, not the same B), scope narrowed to README only, explicit deferral of repo-metadata + release-notes + social tweet to her or to user (her choice on which she'd like to action).
- [ ] WM card written summarising what shipped + what was deferred.

Last updated: 2026-04-25 — plan drafted post-/compact resume, vetting complete, /coherent-plan pass applied (6 findings fixed in place: AC-1/6/9 grep semantics, AC-4 stale rationale, AC-8 wording, checkpoint disambiguation), ready for /delegate.
