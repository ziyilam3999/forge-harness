# Forge Harness

Composable AI primitives — plan, evaluate, generate, coordinate — as a local MCP server.

Successor to [Hive Mind v3](https://github.com/ziyilam3999/hive-mind). Each primitive works standalone and composes together.

## Quick Start

```bash
git clone https://github.com/ziyilam3999/forge-harness.git
cd forge-harness
./setup.sh
```

Then restart Claude Code. The forge tools will appear in your tool list.

## Tools

| Tool | What It Does | Phase |
|------|-------------|-------|
| `forge_plan` | Transform intent into a structured execution plan with binary acceptance criteria | 1 |
| `forge_evaluate` | Grade work against the contract — PASS/FAIL per criterion with evidence | 2 |
| `forge_generate` | Implement one story via GAN loop (implement, evaluate, fix) | 3 |
| `forge_coordinate` | Compose plan/generate/evaluate into dependency-ordered workflows | 4 |

## Status

**Phase 0** — MCP server scaffold with placeholder tools. All tools return "not yet implemented."

## Development

```bash
npm install       # Install dependencies + git hooks
npm run build     # Compile TypeScript
npm test          # Run Vitest suite
npm run lint      # Run ESLint
```

## Architecture

Forge is a **local MCP server** — runs on your machine as a subprocess. Claude Code (or any MCP client) connects via stdio. See `docs/forge-harness-plan.md` for the full design spec.

## License

MIT
