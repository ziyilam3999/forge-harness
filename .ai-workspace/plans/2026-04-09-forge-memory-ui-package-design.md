# Plan: Forge Memory Architecture + UI Prototype + Public Packaging Design

> **Status: NEXT PLAN — queued behind forge_coordinate v1**
>
> This plan starts execution AFTER `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` Session 7 (divergence measurement) completes. Do not start any work here while coordinate sessions S1-S7 are active. All decisions in this document were made 2026-04-09 and are locked pending the post-coordinate design session where the 6 open questions at the bottom get answered.

## Context

This is a **design discussion document**, not an implementation plan. It captures architectural decisions for three scope questions that emerged while finalizing the forge_coordinate plan:

1. **Project-local history persistence**: are `.forge/runs/` + `.forge/audit/` actually durable, and how do we build improvement plans from them later?
2. **Forge memory architecture**: SQL-backed KB + librarian agent + stateless working agents + compounding context loop
3. **Public packaging**: how to ship forge-harness + `/prd` skill + `/prototype` skill as one coherent package on public GitHub

**Critical verified fact:** `.forge/` is **gitignored** at `forge-harness/.gitignore:3`. This changes the persistence picture materially and drives the memory architecture decisions below.

**Load-bearing constraint:** None of these decisions impact forge_coordinate v1 (22 stories, 4-field config schema, 4 phases). They are all additive post-coordinate work. forge_coordinate ships first; this plan is the queue behind it.

## ELI5

We built a foreman (forge_coordinate) who watches one project and writes "do this next" briefs. Now we're asking three bigger questions:

1. **Does the foreman's paper trail survive?** Today the foreman writes notes to a `.forge/` folder, but that folder is on the gitignore list. So the notes survive on YOUR computer, but if you clone the project on a new machine they're gone. That's OK for day-to-day but bad if you want to look back at "how did I build this project" six months later.

2. **Can we give the foreman a library?** The user wants a librarian (a separate agent) that knows every project the foreman has ever worked on, remembers which patterns worked, and can hand the foreman a ready-made research packet on demand. The foreman (and all his worker friends) never have to go find anything themselves — the librarian does all the searching.

3. **How do we share all this stuff?** forge_coordinate + the `/prd` skill + the coming `/prototype` skill are meant to be used together. We want to put them in one GitHub repo so anyone can install the whole kit with one command.

The answer we land on is: files stay where they are (canonical source), a new SQLite database sits next to them as an index the librarian can query fast, and everything ships as one monorepo with a `setup.sh` script. And no forge primitive gets any smarter — composition happens at the session level, same as today.

---

## Part A: Project-Local History Persistence — verified gaps

### What IS persisted today

| Artifact | Path | Format | Written by | Durability |
|----------|------|--------|-----------|------------|
| Primary run records | `.forge/runs/{tool}-{ts}-{hex}.json` | Individual JSON per invocation | forge_evaluate (coherence/divergence/story after US-00a), forge_plan, forge_coordinate (its own) | **Gitignored** → local disk only |
| Generator JSONL | `.forge/runs/data.jsonl` | Append-only JSONL | forge_generate | **Gitignored** → local disk only |
| Audit logs | `.forge/audit/{tool}-{ts}.jsonl` | Append-only JSONL | All primitives via `AuditLog.log()` | **Gitignored** → local disk only |
| Lessons | `.ai-workspace/lessons/*.md` | Markdown | Claude Code sessions (via correction loop) | Git-tracked |
| Plans | `.ai-workspace/plans/*.md` | Markdown | Claude Code sessions | Git-tracked |
| Graduated patterns | `hive-mind-persist/01-proven-patterns.md` (P1..P56) | Markdown | Cross-session ratification | Git-tracked (separate repo) |

**The gap:** `.forge/runs/` and `.forge/audit/` — the richest structured signal in the whole stack — are **locally persistent but not durable**. A fresh clone loses them. Multiple machines working on the same project produce divergent local histories. Cross-project analysis requires walking a filesystem that may not exist.

### What this means for improvement plans

Today, to build an improvement plan from forge history, you'd need to:
1. Be on the same machine that ran the original sessions (or have preserved a backup)
2. Manually grep `.forge/runs/*.json` across multiple project directories
3. Hand-aggregate cost/velocity/failure patterns in a notebook or spreadsheet
4. Hope you named the patterns consistently enough to grep them

This doesn't scale past ~3 projects. By the time you have 10, you can't answer "which escalation reason is most common across all my forge runs?" without writing a one-off script.

### Design implication

Persistence needs a **three-tier durability model** where each tier has a clear role and rebuildability rule:

| Tier | Location | Role | Durability | Rebuildable from? |
|------|----------|------|-----------|-------------------|
| **T1 — Ephemeral per-project** | `.forge/runs/*.json`, `.forge/audit/*.jsonl` | Raw invocation records, written live by primitives | Local disk only (gitignored) | Primary source — NOT rebuildable (lost = lost) |
| **T2 — Indexed per-user** | `~/.forge-memory/index.db` (SQLite) | Cross-project query index for the librarian | User-home, rebuildable | T1 across all projects on this machine |
| **T3 — Durable cross-user** | `hive-mind-persist/01-proven-patterns.md` (git-tracked) | Graduated, ratified patterns | Versioned in git, shared | Graduated from T2 via human/agent review |

**Key properties of this model:**

1. **`.forge/` stays gitignored.** Raw per-invocation records are too noisy and too machine-specific to version. (This is the current design, just made explicit.)
2. **T2 is derived, not canonical.** Corruption or loss of the SQLite DB is a non-event — run the indexer and it's back.
3. **T3 is the only tier meant for human reading and cross-user sharing.** It grows slowly (P1..P56 over many months) because ratification is deliberate.
4. **Graduation is a promotion pipeline.** Patterns move up: T1 detects repeats → T2 aggregates and confirms across projects → T3 ratifies as a "proven pattern" with WHAT/WHY/EVIDENCE/DESIGN IMPLICATION.

This model makes Part B (the memory architecture) natural.

---

## Part B: Forge Memory Architecture

### Requirements (from user clarification)

The user's definition of memory covers five things:

1. **Persist memory + KB + SQL database** — a queryable, indexed store that survives across sessions, machines, and projects
2. **Agent-based search** — a librarian agent that does the hard work of query expansion, relevance ranking, and synthesis
3. **Stateless working agent** — working agents (forge primitives, Claude Code sessions) never do research themselves; they receive a brief and execute
4. **Compounding context over time** — patterns reveal themselves as the history grows, then graduate to "proven substance" via P56 (Research-First Delegation) + forge_coordinate's `graduateFindings`
5. **Single source of truth with easy agent search** — one canonical place to read, no duplication, easy for agents to query

### Architecture

```
                                 ┌─────────────────────────┐
                                 │  Claude Code Session    │
                                 │  (working agent)        │
                                 │                         │
                                 │  1. receives task       │
                                 │  2. calls /recall       │
                                 │  3. gets context brief  │
                                 │  4. calls forge_*       │
                                 │  5. implements          │
                                 └────────────┬────────────┘
                                              │
                              query with task intent, filters
                                              │
                                              ▼
                                 ┌─────────────────────────┐
                                 │  /recall skill          │
                                 │  (librarian agent)      │
                                 │  LLM-powered            │
                                 │                         │
                                 │  • query expansion      │
                                 │  • SQL retrieval        │
                                 │  • relevance ranking    │
                                 │  • synthesis            │
                                 │  • returns brief        │
                                 └────┬──────────────┬─────┘
                                      │              │
                              read    │              │   read
                                      ▼              ▼
                 ┌────────────────────────┐   ┌──────────────────────┐
                 │  T2: SQLite index      │   │  T3: hive-mind-      │
                 │  ~/.forge-memory/      │   │  persist/ (git)      │
                 │  index.db              │   │                      │
                 │                        │   │  • ratified patterns │
                 │  • run_records         │   │    (P1..P56)         │
                 │  • audit_entries       │   │  • anti-patterns     │
                 │  • detected_patterns   │   │  • measurements      │
                 │  • measurements        │   │  • constitution      │
                 └────────────┬───────────┘   └──────────────────────┘
                              ▲                         ▲
                    derived via indexer       graduated via promotion
                              │                         │
                              │                   ┌─────┴─────┐
                              │                   │ Graduator │
                              │                   │ (skill    │
                              │                   │  or hook) │
                              │                   └─────▲─────┘
                              │                         │
                              │                    queries T2
                              │                         │
                              │                         │
                 ┌────────────┴──────────────────────────┘
                 │  Indexer (CLI tool, hook, or skill)
                 │
                 │  • globs .forge/runs/*.json across projects
                 │  • parses .forge/audit/*.jsonl
                 │  • upserts rows into T2 (idempotent via UUID)
                 │  • runs on-demand or as post-forge hook
                 └───────────────────────────────────────┐
                              ▲                          │
                              │                          │
                              │  reads (never writes)    │
                              │                          │
                 ┌────────────┴─────────────┐           ┌─┴───────────────┐
                 │  T1: .forge/runs/*.json  │           │ forge_*         │
                 │  .forge/audit/*.jsonl    │◄──────────┤ primitives      │
                 │  (gitignored per-project)│   write   │ (unchanged)     │
                 └──────────────────────────┘           └─────────────────┘
```

### Component details

#### T1 — Files (unchanged from today)

- forge primitives continue to write JSON and JSONL as they do today
- **No changes to forge_plan, forge_generate, forge_evaluate, or forge_coordinate**
- The primitives are completely unaware that an index exists
- This preserves NFR-C01 (advisory mode = $0) and all the existing test coverage

#### Indexer — new CLI tool in `indexer/`

- **Language:** TypeScript (matches the rest of the repo)
- **Storage:** `better-sqlite3` (mature, zero-deps, synchronous API perfect for a CLI)
- **Invocation modes:**
  1. **On-demand**: `npx forge-indexer rebuild` — drops and rebuilds the whole index from all projects the user has configured
  2. **Incremental**: `npx forge-indexer update` — reads files modified since last run, upserts new rows
  3. **Hook-driven**: a post-tool-use Claude Code hook that calls `forge-indexer update --project {cwd}` after every forge_* invocation (optional, off by default)
- **Idempotency:** primary key is `sha256(file path + byte offset)` for JSONL lines, or `sha256(file contents)` for whole-file JSON. Re-running doesn't duplicate.
- **Configuration:** `~/.forge-memory/config.json` lists project roots to scan. Default: scans `~/coding_projects/*/` (or whatever is detected).
- **Schema:** stored in `indexer/schema.sql` with versioning:

```sql
-- indexer/schema.sql (v1)
CREATE TABLE IF NOT EXISTS run_records (
  id TEXT PRIMARY KEY,           -- sha256(file path)
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,    -- basename(project_path)
  tool TEXT NOT NULL,            -- forge_plan | forge_generate | forge_evaluate | forge_coordinate
  timestamp TEXT NOT NULL,       -- ISO-8601
  story_id TEXT,                 -- nullable; populated after US-00a
  eval_verdict TEXT,             -- PASS | FAIL | INCONCLUSIVE | NULL
  estimated_cost_usd REAL,       -- nullable; populated after US-00a+b
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  source_file TEXT NOT NULL,     -- original file path
  raw_json TEXT NOT NULL         -- full RunRecord as JSON (for future fields)
);
CREATE INDEX idx_run_records_project ON run_records(project_path);
CREATE INDEX idx_run_records_tool ON run_records(tool);
CREATE INDEX idx_run_records_story ON run_records(story_id);
CREATE INDEX idx_run_records_verdict ON run_records(eval_verdict);
CREATE INDEX idx_run_records_timestamp ON run_records(timestamp);

CREATE TABLE IF NOT EXISTS audit_entries (
  id TEXT PRIMARY KEY,           -- sha256(file path + byte offset)
  project_path TEXT NOT NULL,
  tool TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  stage TEXT,
  agent_role TEXT,
  decision TEXT,
  reasoning TEXT,
  source_file TEXT NOT NULL
);
CREATE INDEX idx_audit_project ON audit_entries(project_path);
CREATE INDEX idx_audit_tool ON audit_entries(tool);
CREATE INDEX idx_audit_stage ON audit_entries(stage);
-- Full-text search over reasoning
CREATE VIRTUAL TABLE IF NOT EXISTS audit_entries_fts USING fts5(reasoning, content='audit_entries', content_rowid='rowid');

CREATE TABLE IF NOT EXISTS detected_patterns (
  id TEXT PRIMARY KEY,           -- sha256(category + signature)
  category TEXT NOT NULL,        -- plateau | no-op | max-iterations | inconclusive | baseline-failed | custom
  signature TEXT NOT NULL,       -- human-readable description of the pattern
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  source_projects TEXT NOT NULL, -- JSON array of project paths where seen
  ratified_as TEXT,              -- P-number from hive-mind-persist, NULL if not yet ratified
  proposed_pattern_md TEXT       -- markdown draft for hive-mind-persist, NULL until proposed
);
CREATE INDEX idx_patterns_category ON detected_patterns(category);
CREATE INDEX idx_patterns_count ON detected_patterns(occurrence_count);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

- **Migration strategy:** schema version stored in `schema_version` table. New schema versions ship with forward-only migrations in `indexer/migrations/`. Old DB files are auto-upgraded on next `forge-indexer rebuild` or `--update`.

#### T2 — SQLite index at `~/.forge-memory/index.db`

- **Derived, not canonical.** Zero tolerance for "SQL got out of sync with files" debates — files always win, DB is regenerable.
- **Location rationale:** `~/.forge-memory/` is user-home, cross-project, outside any single git repo. This matches how `~/.claude/` hosts shared skills.
- **Size budget:** SQLite handles GB-scale easily. A year of daily forge usage probably fits in ~100 MB. Not a concern.
- **Portability:** users who change machines can either (a) rebuild from scratch on the new machine if T1 history comes with them, or (b) accept a fresh start. We explicitly do NOT try to sync T2 across machines — that way lies sync-bugs. T3 (hive-mind-persist) is where cross-machine durability lives.

#### `/recall` skill — the librarian

- **Delivery:** a skill (not a primitive), created via `/skill-creator`
- **Invocation:** `/recall {topic or query}` from any Claude Code session
- **Behavior:**
  1. Parse the query
  2. Decide whether to search T2 (SQL index), T3 (hive-mind-persist files), or both based on the query type
  3. For T2: run SQL queries, optionally with FTS5 full-text search over audit reasoning
  4. For T3: grep ratified patterns by topic
  5. Rank hits by relevance (LLM-assisted for semantic matches; lexical for exact matches)
  6. Synthesize a structured brief: top-K relevant hits + a one-paragraph synthesis + pointers to source files for the working agent to read if it wants more depth
- **Output shape** (printed to the session for the working agent to read):
  ```markdown
  ## Recall: {query}

  ### Top Hits (3)
  1. **P40 — Cross-Phase Context Injection** (hive-mind-persist) — relevant because...
  2. **Run record 2026-03-12 forge_evaluate story-eval FAIL** (project: monday-bot) — similar escalation pattern
  3. **Audit entry 2026-02-28 forge_plan "plateau at iteration 4"** (project: forge-harness) — same category

  ### Synthesis
  Two prior sessions hit the same plateau escalation you're looking at now. Both resolved by
  splitting the story into two smaller stories. P40 formalizes the cross-phase context
  pattern that matches your current setup.

  ### Sources
  - `hive-mind-persist/01-proven-patterns.md:440` (P40)
  - `~/coding_projects/monday-bot/.forge/runs/forge_evaluate-...`
  - `~/coding_projects/forge-harness/.forge/audit/forge_plan-...`
  ```
- **Never writes.** The librarian is read-only. Writes happen via the graduator (separate tool) or directly by humans editing `hive-mind-persist/` files.

#### Graduator — promotion from T2 to T3

- **Delivery:** another skill, `/graduate-pattern`, or a sub-command of `/recall` (`/recall --graduate`)
- **Behavior:**
  1. Queries T2 for `detected_patterns` with `occurrence_count >= 3` and `source_projects` covering 2+ distinct projects
  2. For each candidate, drafts a proposed pattern entry in hive-mind-persist format (WHAT / WHY / EVIDENCE / DESIGN IMPLICATION)
  3. Writes draft to T2 (`proposed_pattern_md` column)
  4. Optionally opens an interactive review with the human: "Propose this as P57?" → yes/no
  5. On yes: appends to `hive-mind-persist/01-proven-patterns.md`, updates T2 row with the new `ratified_as: "P57"` value
- **Governance:** only human-ratified patterns go to T3. This is the check against pattern inflation — we don't want the librarian inventing 200 low-quality patterns a month.

#### How forge primitives participate (composition, not coupling)

- **forge primitives remain completely unchanged.** They keep writing T1 files. They don't know the librarian exists.
- **The Claude Code session is the composition point.** Before calling `forge_generate`, the session calls `/recall` to get relevant context, then passes that context in a new optional field (e.g., `relevantPatterns: string[]`) on the primitive input schema. The primitive treats it as another input alongside PRD/master/phase docs.
- **NFR-C01 is preserved.** forge primitives never call LLMs in advisory mode. The librarian does the LLM work BEFORE the primitive is called. The primitive sees a pre-assembled brief.
- **Back-compat is automatic.** Old callers that don't use `/recall` keep working — the new `relevantPatterns` input is optional with a default of empty list.

#### Stateless working agent (P56 formalized)

Per the user's framing: "The working agent stay stateless. The sql database agent do the searching and all the hard work."

This maps 1:1 to P56 (Research-First Delegation) applied to memory:
- **Research agent** = `/recall` skill = the librarian
- **Working agent** = Claude Code session doing the actual implementation
- **Handoff contract** = the structured brief the librarian returns
- **No exploration from the working agent** = the working agent never runs SQL, never greps hive-mind-persist, never walks `.forge/runs/` itself
- **Clean context** = working agent's context window holds only the task, the brief from `/recall`, and the forge primitive inputs/outputs

This is the same pattern P40 (Cross-Phase Context Injection) already proves works. Memory is the natural next application.

### Graduation pipeline — how compounding context becomes proven substance

```
forge runs happen
      │
      ▼
T1: .forge/runs/*.json accumulates locally
      │
      │ indexer ingests
      ▼
T2: run_records table grows; detected_patterns
    table accumulates repeated escalations
      │
      │ graduator queries "3+ occurrences across 2+ projects"
      ▼
T2: detected_patterns.proposed_pattern_md drafted
      │
      │ human review (or autonomous /skill-evolve style ratification)
      ▼
T3: new P-number appended to hive-mind-persist/01-proven-patterns.md
      │
      │ future /recall queries surface the ratified pattern
      ▼
Working agents get "proven substance" injected into their briefs
      │
      ▼
Patterns shape future implementations, closing the loop
```

This is exactly the self-improvement loop the user described, with each stage having a clear artifact and a clear gate.

### Open design questions (for discussion, not this plan)

1. **Should the indexer also ingest `.ai-workspace/lessons/` and `.ai-workspace/plans/` files?** Lessons in particular are direct human-authored feedback — they're already higher-quality than run records for improvement planning. Leaning yes.
2. **Should T2 store embeddings for semantic search?** `sqlite-vec` and `sqlite-vss` make this cheap. Starting lexical+FTS5, adding embeddings as a v2 if retrieval quality demands it.
3. **Who runs the indexer — the user manually, a post-tool-use hook, or a scheduled background task?** Starting with manual + optional hook, since it's lowest-surprise. `cron`-style scheduling is out-of-scope.
4. **How do we share T3 across users?** For now, `hive-mind-persist/` is a private git repo in the user's ai-brain workspace. For the public package, we'd either ship a starter `hive-mind-persist/` with the repo (curated) OR keep it user-local and have each user grow their own. Leaning: ship a **minimal curated seed** (5-10 foundational patterns) and let users grow theirs from there.
5. **Does the librarian need to know about forge_coordinate's `graduateFindings`?** Yes — `graduateFindings` emits structured findings that are PERFECT inputs to the graduator. The composition: forge_coordinate returns graduated findings → caller calls graduator with them → graduator writes to T2.detected_patterns → human ratifies → T3 grows. Clean pipeline.

---

## Part C: UI Prototype + PRD + Forge-Harness — Public Packaging Design

### Goal

Ship **one public GitHub repo** that contains everything needed to use the forge ecosystem:
- forge-harness MCP server (4 primitives)
- `/prd` skill (interactive vision doc generator)
- `/prototype` skill (interactive UI prototype generator)
- `/recall` skill (librarian, from Part B)
- indexer CLI tool (from Part B)
- Documentation and starter examples
- One-command install

Users should be able to go from `git clone` to working forge ecosystem in under 5 minutes.

### Proposed repo structure

```
forge-harness/                   # public GitHub repo (renamed if desired)
├── README.md                    # landing page: what it is, install, quick start
├── LICENSE                      # MIT or Apache 2.0
├── CHANGELOG.md                 # monorepo version changelog
├── package.json                 # workspace root
├── tsconfig.json
├── pnpm-workspace.yaml          # monorepo tool (pnpm recommended for speed)
│
├── server/                      # (existing) MCP server — forge_plan/generate/evaluate/coordinate
│   ├── tools/
│   ├── lib/
│   ├── types/
│   ├── index.ts
│   └── package.json             # internal package
│
├── skills/                      # user-invocable skills
│   ├── prd/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   └── runs/                # (gitignored) run data for skill-evolve
│   ├── prototype/               # NEW — UI prototype workflow
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   ├── templates/           # HTML/CSS starting templates
│   │   └── runs/                # (gitignored)
│   └── recall/                  # NEW — librarian skill
│       ├── SKILL.md
│       ├── scripts/
│       └── runs/                # (gitignored)
│
├── indexer/                     # NEW — SQL index CLI
│   ├── index.ts
│   ├── schema.sql
│   ├── migrations/
│   ├── cli.ts
│   └── package.json
│
├── docs/                        # (existing + new)
│   ├── getting-started.md       # NEW — install + first forge run in 5 min
│   ├── architecture.md          # NEW — high-level overview of the ecosystem
│   ├── memory-architecture.md   # NEW — Part B content, cleaned up
│   ├── packaging.md             # NEW — Part C content
│   ├── primitive-backlog.md     # existing
│   ├── forge-harness-plan.md    # existing
│   └── scope-boundary-decisions.md # NEW — the "skill vs primitive" rule
│
├── examples/                    # NEW — end-to-end demo projects
│   ├── todo-app/                # simplest possible: PRD → plan → implement → ship
│   │   ├── docs/forge-todo-prd.md
│   │   ├── docs/forge-todo-master-plan.json
│   │   └── README.md
│   └── dashboard/               # more complex: uses /prototype
│       ├── docs/prototypes/...
│       └── README.md
│
├── setup.sh                     # ONE-COMMAND INSTALL
├── setup.ps1                    # Windows equivalent
│
└── .github/
    ├── workflows/
    │   ├── ci.yml               # build + test on push
    │   ├── release.yml          # tag → changelog → GitHub release
    │   └── indexer-check.yml    # smoke test indexer against example projects
    ├── ISSUE_TEMPLATE/
    └── PULL_REQUEST_TEMPLATE.md
```

### Install flow (the one-command promise)

```bash
git clone https://github.com/{user}/forge-harness.git ~/coding_projects/forge-harness
cd ~/coding_projects/forge-harness
./setup.sh
```

`setup.sh` does:

1. **Verify prerequisites**: Node 20+, Claude Code installed, `pnpm` (install if missing)
2. **Install dependencies**: `pnpm install` (workspace hoisting)
3. **Build the MCP server**: `pnpm --filter server build`
4. **Build the indexer**: `pnpm --filter indexer build`
5. **Symlink skills to `~/.claude/skills/`**:
   - `~/.claude/skills/prd` → `{repo}/skills/prd`
   - `~/.claude/skills/prototype` → `{repo}/skills/prototype`
   - `~/.claude/skills/recall` → `{repo}/skills/recall`
6. **Register MCP server with Claude Code**: adds an entry to `~/.claude.json` or `claude mcp add forge ~/coding_projects/forge-harness/server/dist/index.js`
7. **Initialize memory store**: creates `~/.forge-memory/` if missing; runs `forge-indexer init` to create empty schema
8. **Smoke test**: runs a dry call to each primitive, verifies skills are discovered, queries the empty index
9. **Print success summary**: "forge-harness installed. Try `/prd` in Claude Code to generate your first vision doc."

Windows users get `setup.ps1` with the same steps using PowerShell cmdlets.

### Versioning

- **Monorepo version** in `package.json` at root (e.g., `1.0.0`) — this is the public release version
- **Server version** in `server/package.json` (tracks MCP tool schema compatibility — SemVer)
- **Skill versions** in each `SKILL.md` frontmatter (independent evolution)
- **Indexer version** in `indexer/package.json` (SQL schema version independent)
- **Release artifact** is a GitHub release tied to a monorepo version tag, with a changelog aggregating all sub-package changes

`CHANGELOG.md` at repo root documents monorepo releases. Each sub-package has its own changelog for granular history.

### Naming (suggested — open to user preference)

- **Public repo name:** `forge-harness` (keep current name — it's already in use internally, the brand is established)
- **npm package name** (if published): `forge-harness` (un-scoped) or `@forge/harness` (scoped if we want a namespace for future sibling packages)
- **Binary names:** `forge-indexer` (CLI)
- **MCP server registration name:** `forge` (short, matches tool prefix)
- **Skill names:** `/prd`, `/prototype`, `/recall` — short, memorable, verb-like

### Cut from v1 of the package (documented for v2)

- **Windows one-click installer (MSI/EXE).** Ship `setup.ps1` instead. Installer is a packaging exercise that adds weeks.
- **Docker image.** Nice-to-have but not required — Claude Code runs natively.
- **`forge` meta-CLI** that wraps indexer + server + skill management. Too much surface for v1. Start with `./setup.sh` and individual tools.
- **VS Code extension.** Out of scope — forge is MCP-native, which already works in any MCP-capable editor.
- **Hosted T2 / team mode.** Single-user local SQLite only in v1. Team sync is a v2 scoped question.

### How UI prototype workflow fits in

- **Skill: `skills/prototype/SKILL.md`** — interactive workflow:
  1. Read a PRD (either fresh or existing)
  2. Invoke `/frontend-design` skill + Playwright to generate an initial HTML/CSS prototype
  3. Screenshot the prototype in 3+ states (default, interacted, error)
  4. Present screenshots + rationale to the human
  5. Accept feedback, iterate
  6. On approval, write `docs/prototypes/{slug}.prototype.json` + `docs/prototypes/{slug}/` with HTML/CSS assets
  7. Return the prototype path for downstream use
- **forge-side integration (post-coordinate):**
  - New type: `server/types/prototype-artifact.ts` with `PrototypeArtifact` interface
  - `forge_plan` gains optional `prototypeArtifactPath` input; master plan can reference prototype components in phase inputs
  - `forge_generate` three-tier doc assembly extends (optional) to include the prototype as a supplementary design reference
  - `forge_evaluate` gains optional `mode: "design-fidelity"` that Playwright-diffs implementation against approved prototype screenshots
- **Integration is additive and backwards-compatible.** Existing PRD-only flows keep working unchanged.

---

## Part D: Impact on forge_coordinate v1

Binary check against the current 22-story plan:

| Check | Memory (Part B) | UI prototype + packaging (Part C) |
|---|---|---|
| Depends on any PH-01..04 story? | No | No |
| Requires new types in coordinate-result.ts? | No | No |
| Changes any NFR (C01-C10)? | No | No |
| Changes any Risk row? | No | No |
| Changes any input/output schema? | No | No |
| Shifts the Intelligent Clipboard boundary? | No | No |
| Requires `.forge/` layout changes? | No | No |
| Requires `writeRunRecord` API changes? | No | No |
| Would a stateless reviewer on coordinate notice? | No | No |

**Zero impact on forge_coordinate v1 for both.** Ship coordinate first, then revisit these in a dedicated design session.

### What forge_coordinate v1 inadvertently enables for memory

Even though coordinate doesn't have to change, it is **producing the exact signals the memory architecture wants**:
- `handleStoryEval` after US-00a writes `storyId` + `evalVerdict` to `.forge/runs/*.json` — feeds T2's `run_records.story_id` and `eval_verdict` columns directly
- US-00b's cross-site `estimatedCostUsd` population feeds T2's `run_records.estimated_cost_usd` column for cost analysis
- `graduateFindings` (PH-03 US-04) detects repeat escalations → structured findings ready to feed the graduator → T2's `detected_patterns` table
- `aggregateStatus` (PH-03 US-03) already produces per-story velocity data → feeds measurement tracking in T2

**This is accidentally the ingestion contract.** Once coordinate ships, the indexer has perfect input to work from. No rework on coordinate side.

---

## Scope Boundary Decisions (the reusable rule)

Captured here as the proven rule that will answer future "primitive or external?" questions:

> **Rule:** If a feature needs multi-turn LLM work, human approval loops, indeterminate duration, or cross-project scope, it's a **skill or ecosystem infrastructure**. If it's mechanical signal aggregation on per-project state that returns a structured brief in a single shot, it's a **forge primitive**.

**Memory:**
- Cross-project scope → infrastructure (T2 + librarian)
- LLM-powered relevance → skill (`/recall`)
- File-based canonical state → unchanged primitives write T1, no primitive changes needed
- **Decision: external, composed at the session level**

**UI prototype:**
- Interactive approval loops → skill
- LLM-powered generation → skill
- Output artifact consumed by forge primitives → schema in forge-harness types, workflow in skill
- **Decision: external, with schema-level integration in forge types**

**Previously ratified examples following the same rule:**
- `/prd` — interactive, LLM-powered, one-shot upstream artifact → skill ✓
- forge_coordinate — single-shot, mechanical, per-project → primitive ✓
- `/project-index` — one-shot classifier over files → skill (borderline, but it's interactive in the sense that it runs on-demand against a project and produces a doc)

---

## Test Cases & AC

Binary criteria for "done" per component. Each is objectively verifiable.

### Part A: Persistence

- [ ] `.gitignore` verified to contain `.forge/` line (**already done**, found at line 3)
- [ ] `docs/memory-architecture.md` exists and documents the three-tier durability model
- [ ] Readers understand that T1 is ephemeral per-project, T2 is derived per-user, T3 is durable cross-user

### Part B: Memory

- [ ] `indexer/` directory exists with `index.ts`, `schema.sql`, `cli.ts`, `package.json`
- [ ] `npx forge-indexer init` creates `~/.forge-memory/index.db` with all tables from `schema.sql` applied
- [ ] `npx forge-indexer rebuild` on a project with `.forge/runs/` populates `run_records` table; row count matches file count
- [ ] `npx forge-indexer update` is idempotent (running twice produces zero new rows)
- [ ] `skills/recall/SKILL.md` exists, passes `/skill-evolve audit recall` healthcheck
- [ ] `/recall "forge_coordinate"` returns a structured brief with at least one hit from a populated T2
- [ ] Working agent never executes SQL directly (verified by reviewing the skill's scripts — only `/recall` touches the DB)
- [ ] `skills/graduate-pattern/SKILL.md` exists (or `/recall --graduate` sub-command)
- [ ] Graduation workflow end-to-end: seed 3 synthetic "plateau" run records across 2 projects → graduator proposes a pattern → human approves → `hive-mind-persist/01-proven-patterns.md` gains a new P-number
- [ ] forge primitives unchanged: `git diff server/` between before-memory and after-memory is empty for `lib/`, `tools/`, `types/`, `index.ts`
- [ ] NFR-C01 still passes for all forge primitives (no `callClaude` added anywhere in `server/lib/` or `server/tools/`)

### Part C: Packaging

- [ ] Repo structure matches the proposed layout (`skills/`, `indexer/`, `examples/`, `docs/`, etc.)
- [ ] `setup.sh` exits with code 0 on a fresh Ubuntu 22.04 + Node 20 + Claude Code install
- [ ] `setup.ps1` exits with code 0 on a fresh Windows 11 + Node 20 + Claude Code install
- [ ] After `setup.sh`, `/prd` is discoverable via `ls ~/.claude/skills/`
- [ ] After `setup.sh`, `claude mcp list` shows the `forge` MCP server entry
- [ ] After `setup.sh`, `forge_coordinate` is callable from a test session
- [ ] `examples/todo-app/` demo runs end-to-end: `/prd` → `forge_plan` → `forge_generate` → `forge_evaluate` → `forge_coordinate` → a working app
- [ ] `examples/dashboard/` demo additionally uses `/prototype` and produces a `docs/prototypes/dashboard.prototype.json` file
- [ ] `docs/getting-started.md` walks a new user from 0 to first forge run in under 5 minutes of reading + doing
- [ ] `README.md` at repo root links to all key docs, shows a 30-second demo GIF or ASCII-cinema
- [ ] Public GitHub release created with monorepo version tag
- [ ] CI workflow (`ci.yml`) passes: builds server, builds indexer, runs unit tests, runs indexer smoke test

### Scope Boundary Decision doc

- [ ] `docs/scope-boundary-decisions.md` exists
- [ ] Contains the reusable rule verbatim
- [ ] Lists memory, UI prototype, `/prd`, forge_coordinate, and `/project-index` as worked examples with rationale

---

## Checkpoint

- [ ] **Ship forge_coordinate v1 first** (current 22-story plan in `2026-04-09-forge-coordinate-implementation.md`) — blocking all of Part B and Part C work
- [ ] Append "Scope Boundary Decisions" section to `docs/primitive-backlog.md` with the skill-vs-primitive rule and the memory + UI prototype decisions
- [ ] Append "Memory Architecture Sketch" section to `docs/primitive-backlog.md` referencing this plan file for details
- [ ] After forge_coordinate ships: hold design session to finalize memory SQL schema (v1 fields, indexes, migration strategy)
- [ ] After memory design session: create `indexer/` package; implement schema + CLI
- [ ] After indexer works locally: create `/recall` skill via `/skill-creator`
- [ ] After `/recall` works: create `/prototype` skill via `/skill-creator`
- [ ] After all three skills work: restructure repo for packaging (add `pnpm-workspace.yaml`, move `server/` under workspace, create `setup.sh`)
- [ ] After repo restructure: write `examples/todo-app/` and `examples/dashboard/` demos
- [ ] After demos: write `docs/getting-started.md` and `docs/architecture.md`
- [ ] After docs: record demo video / GIF
- [ ] Public GitHub release v1.0.0

Open design questions flagged for discussion (carry forward into the post-coordinate session):

- [ ] Does indexer also ingest `.ai-workspace/lessons/` and `.ai-workspace/plans/` files? (leaning yes)
- [ ] Embedding-based semantic search in T2 v1 or v2? (leaning v2)
- [ ] Indexer execution mode: manual only, or with optional post-tool-use hook? (leaning manual + optional hook)
- [ ] Ship hive-mind-persist seed patterns in the public repo, or user-local only? (leaning minimal curated seed of 5-10 foundational patterns)
- [ ] Repo rename for public release (stay `forge-harness` or pick a new brand)?
- [ ] License: MIT or Apache 2.0?

Last updated: 2026-04-09T00:00:00+08:00
