# Standalone Reusable Projects

Ideas that emerged from hive-mind roadmap discussions but are not tied to the pipeline itself. Each can be a separate repo, Claude Code skill, or scheduled agent -- reusable across any project.

## Format
```
SP-NNN | Type | One-line description
```

## Projects

### SP-001: Remotion Skill
**Type:** Claude Code skill
**Description:** "Make a 30s demo of the product we just built. Show these features + CTAs." Generates video content using Remotion. Currently good at: text animation, data visualization, product demos, terminal recordings, feature announcements, data stories, social clips.
**Ref:** [remotion-dev/remotion](https://github.com/remotion-dev/remotion)

### SP-002: Changelog Monitor + Stitch Gallery
**Type:** Scheduled agent
**Description:** Monitor product changelog. On new feature drop: generate updated UI screenshots via Google Stitch, rebuild marketing site feature gallery automatically.
**Ref:** Google Stitch (AI-native design canvas, "vibe design" for intent+mood prompts)

### SP-003: Weekly Shipping Video
**Type:** Scheduled agent
**Description:** Weekly job: summarize features shipped that week, use Remotion for motion graphics, render in multiple aspect ratios, queue for upload. Produces attractive launch/recap video for customers.
**Ref:** Remotion + ElevenLabs for voiceover

### SP-004: Browser Automation Workflows
**Type:** Claude Code skill
**Description:** Record browser action sequences as reusable skills. Automate posting (X, LinkedIn, etc.), content generation, asset creation, data entry. Uses /browser-use (requires Claude in Chrome extension) and cowork pattern for cross-tool workflows.
**Ref:** /browser-use, Chrome extension bridge

### SP-005: NotebookLM Video Explainers
**Type:** Standalone tool
**Description:** Generate full cinematic video explainers from documents and sources. Turns research, PRDs, or design docs into polished visual presentations automatically.
**Ref:** NotebookLM March 2026 cinematic video feature

### SP-006: Anthropic Community Skills Audit
**Type:** Research task
**Description:** Evaluate and potentially adopt community skills for use across projects. Candidates:
- [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) -- production-grade UI components
- [algorithmic-art](https://github.com/anthropics/skills/tree/main/skills/algorithmic-art) -- generative art
- [canvas-design](https://github.com/anthropics/skills/tree/main/skills/canvas-design) -- canvas-based design
- [theme-factory](https://github.com/anthropics/skills/tree/main/skills/theme-factory) -- design system themes
- [web-artifacts-builder](https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder) -- web artifact generation
- [brand-guidelines](https://github.com/anthropics/skills/tree/main/skills/brand-guidelines) -- brand consistency
- [notebookLm-skill](https://github.com/PleasePrompto/notebookLm-skill) -- NotebookLM integration

### SP-007: Remotion for Hive-Mind Demo
**Type:** One-off project
**Description:** Create a demo video of current hive-mind capabilities using the Remotion skill (SP-001). Do this before R1 harness improvements to showcase the baseline product.
**Depends on:** SP-001

### SP-008: RAG MCP Server
**Type:** Standalone MCP server (separate repo)
**Description:** Reusable semantic search over markdown knowledge bases. Any Claude Code session can use it via `mcpServers` config. Ingests documents into sqlite-vec vector store, provides semantic search with collection/filter scoping. MVP: `rag_ingest` (add docs) + `rag_search` (query) tools, markdown-aware chunking, sqlite-vec storage (zero external deps).
**Timeline:** Build after R1 (needs MCP Phase 1 for integration path). Integrate into hive-mind pipeline in R3 by replacing static KB reads with `rag_search` calls.
**Architecture:**
```
@hive-mind/rag-server
  src/server.ts            -- MCP entry point
  src/tools/ingest.ts      -- rag_ingest tool
  src/tools/search.ts      -- rag_search tool
  src/pipeline/chunker.ts  -- markdown-aware splitting
  src/pipeline/embedder.ts -- embedding API calls
  src/store/sqlite-vec.ts  -- SQLite + sqlite-vec
```

---

## How to Use This List

1. Each project is independent -- pick any and start
2. Skills go in `~/.claude/skills/` (global) or `.claude/skills/` (per-project)
3. Scheduled agents use Claude Code's `/schedule` command
4. When a project is started, create its own repo or directory and track progress there
5. If a project turns out to be relevant to the hive-mind pipeline, move it to `roadmap-backlog.md`
