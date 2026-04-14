# S2 Execution — forge_coordinate Master Plan + Phase Plans + Coherence Eval

**Upstream brief:** `.ai-workspace/plans/2026-04-09-forge-coordinate-s2-prompt.md` (forge-plan, complete)
**Reference contract:** `docs/forge-coordinate-prd.md` v1.1 (16 REQ / 10 NFR / 8 SC)
**Reference impl plan:** `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` v1.1 (resynced 2026-04-09T18:45)
**Schema template:** `.ai-workspace/plans/forge-generate-{master-plan,phase-PH-*}.json` (existing three-tier shape — do not invent)

## Exit Criteria (binary)

- [ ] `forge-coordinate-master-plan.json` exists, `documentTier: "master"`, 4 phases (PH-01..PH-04), correct dependency DAG (PH-01→[], PH-02→[PH-01], PH-03→[PH-01,PH-02], PH-04→[PH-02,PH-03]), `estimatedStories` = [8,4,5,5], total 22
- [ ] `forge-coordinate-phase-PH-01.json` exists, `documentTier: "phase"`, `phaseId: "PH-01"`, 8 stories with IDs `PH01-US-00a, PH01-US-00b, PH01-US-01, PH01-US-02, PH01-US-03, PH01-US-04, PH01-US-05, PH01-US-06`
- [ ] `forge-coordinate-phase-PH-02.json` exists, 4 stories `PH02-US-01..04`
- [ ] `forge-coordinate-phase-PH-03.json` exists, 5 stories `PH03-US-01..05`
- [ ] `forge-coordinate-phase-PH-04.json` exists, 5 stories `PH04-US-01, PH04-US-01b, PH04-US-02, PH04-US-03, PH04-US-04` (note: `PH04-US-01b` per PRD §11 documented exception)
- [ ] Every story AC is binary (executable shell or vitest), no soft language ("reasonable", "good", etc.)
- [ ] Every PRD REQ-01..REQ-16 is covered by at least one story AC (per §11 traceability)
- [ ] Every PRD NFR-C01..NFR-C10 is covered by at least one story AC
- [ ] All 6 JSON files parse as valid JSON
- [ ] `forge_evaluate(mode: "coherence", ...)` returns 0 CRITICAL and 0 MAJOR findings (MINOR acceptable with documented rationale)
- [ ] Ship as PR via `/ship`, expected v0.16.4

## Checkpoint

- [ ] Read S2 prompt + impl plan v1.1 + PRD v1.1 + schema templates
- [ ] Author `forge-coordinate-master-plan.json`
- [ ] Author `forge-coordinate-phase-PH-01.json` (8 stories — largest)
- [ ] Author `forge-coordinate-phase-PH-02.json` (4 stories)
- [ ] Author `forge-coordinate-phase-PH-03.json` (5 stories)
- [ ] Author `forge-coordinate-phase-PH-04.json` (5 stories)
- [ ] Validate all 6 JSON files parse
- [ ] Run `forge_evaluate(mode: "coherence", ...)` as exit gate
- [ ] Iterate on any CRITICAL/MAJOR findings until clean
- [ ] Save coherence report as `forge-coordinate-coherence-report.json`
- [ ] `/ship` as v0.16.4
- [ ] Reply to forge-plan via `/mailbox send to forge-plan` with reply contract items 1-6

Last updated: 2026-04-09T13:30:00+08:00
