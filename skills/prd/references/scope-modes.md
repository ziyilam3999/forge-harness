# Scope Modes (Step 1D)

Ask the user which scope posture to take. If no preference, default to SELECTIVE EXPAND.

## Modes

| Mode | Posture | When to use |
|------|---------|-------------|
| **EXPAND** | Dream big. What's the 10-star product hiding in this request? Push scope UP. | Exploratory phase, greenfield, "think bigger" |
| **SELECTIVE EXPAND** | Hold scope as baseline, surface expansion opportunities one by one for user to cherry-pick. | Default for most PRDs |
| **HOLD** | Lock scope. Make it bulletproof -- catch every edge case, map every failure mode. | Scope already agreed, need rigor |
| **REDUCE** | Surgeon mode. Find minimum viable version. Cut everything else ruthlessly. | Time pressure, MVP, smallest thing that ships value |

## Mode-Specific Requirements Interview Behavior (Step 1E)

**EXPAND mode:**
- After each requirement, ask "what would make this 10x better for 2x the effort?"
- Surface delight opportunities
- Present each expansion as an individual decision for the user to accept or defer
- Accepted expansions become requirements; deferred ones go to Future Scope

**SELECTIVE EXPAND mode:**
- Collect requirements normally
- At the end, surface 3-5 expansion opportunities for the user to cherry-pick
- Neutral posture -- present opportunity, state effort, let user decide
- **Layer diversity check:** Classify each expansion by architectural layer (UI, data, infrastructure, integration). If all candidates target the same layer, replace at least one with an expansion from a different layer. This prevents anchoring the user on surface-level additions while missing deeper infrastructure or data opportunities.

**HOLD mode:**
- After each requirement, probe for edge cases and failure modes
- Challenge completeness: "What happens when X fails?" "What about empty input?"
- Do not add scope -- only strengthen existing scope

**REDUCE mode:**
- After each requirement, ask "is this truly essential for the minimum viable version?"
- Challenge anything that isn't core
- "What if we shipped without this? Would anyone notice?"
- Goal: find the smallest thing that delivers value this week
