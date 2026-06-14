# Product Diagnostic (Step 1B)

Ask these forcing questions ONE AT A TIME. Wait for the response before asking the next. Push on each until the answer is specific, evidence-based, and uncomfortable.

## Choice Presentation

For each question (Q1-Q4), present context-aware answer suggestions using the `AskUserQuestion` tool with the `options` parameter. Generate choices dynamically from what you learned in Step 1A (codebase, memory, constitution, existing PRDs).

### Rules
- Generate 3-4 context-specific choices per question. The user can always select "Other" to type their own answer (this is built into AskUserQuestion).
- Choices are thinking aids, not crutches. After the user selects one, still apply the push-for-specificity posture -- challenge vague selections the same way you'd challenge vague free-text.
- If the user selects "Other" and types their own answer, apply the standard push posture as before.
- Never generate choices that anchor the user to one framing. Offer genuinely different angles.

### Choice Generation Sources (priority order)
1. **Codebase patterns** -- existing features, known users, current workflows, README descriptions
2. **Memory/constitution** -- product principles, past decisions, known pain points
3. **Session context** -- what the user said when invoking the skill, earlier answers in Q1-Q4
4. **Domain archetypes** -- common patterns for the detected project type (CLI tool, web app, library, etc.). Use as fallback when codebase context is thin (e.g., greenfield projects).

### Post-Selection Push
When the user selects a suggested choice (not "Other"):
1. Acknowledge the selection briefly (one sentence, no praise).
2. Push for more specificity: "You picked [X]. Make it more concrete -- [specific follow-up based on the question's red flags]."
3. If the selection was already specific enough, proceed to the next question.

## Smart Routing

Not all questions apply to every situation:
- New product/feature: Q1, Q2, Q3, Q4
- Enhancement to existing feature: Q2, Q4
- Internal tooling: Q2, Q4
- **UI/visual feature** (dashboard, web app, mobile app, interface, frontend): Q1, Q2, Q3, Q4, **Q5**

Q5 triggers when the feature involves a visual interface. Detect by scanning the PRD topic and Q1-Q4 answers for keywords: "dashboard", "web", "UI", "interface", "screen", "page", "frontend", "mobile", "app", "display", "visual", "view".

## Q1: Demand Reality

Ask: "What's the strongest evidence someone actually wants this -- not 'is interested,' but would be genuinely upset if it disappeared tomorrow?"

**Suggested Choices:** Generate 3-4 options representing different evidence types, grounded in Step 1A context:
- Option sourced from **usage data** (if codebase has analytics, logs, or user metrics)
- Option sourced from **user feedback** (if memory/constitution mentions user complaints or requests)
- Option sourced from **behavioral proxy** (e.g., "Users currently run command X 50+ times/day" if seen in codebase)
- Option representing a **common archetype** for the project type (e.g., for a CLI: "Users have built shell aliases/scripts around the current tool")

Push until you hear specific behavior: someone paying, expanding usage, building workflows around it, scrambling if it vanished.

Red flags: "People say it's interesting." "We got waitlist signups." "VCs are excited." None of these are demand.

After the answer, check:
- Are the key terms defined? If they said "AI tool for developers" -- challenge: "What specific task does a specific developer waste 2+ hours on per week?"
- Is there evidence of actual pain, or is this a thought experiment?

## Q2: Status Quo

Ask: "What are your users doing right now to solve this -- even badly? What does that workaround cost them?"

**Suggested Choices:** Generate 3-4 options based on current workarounds visible in the codebase or described in memory:
- Option describing a **manual process** visible in the codebase (scripts, READMEs, docs mentioning manual steps)
- Option describing a **tool combination** users currently stitch together
- Option describing **doing nothing** (with the cost stated)
- Option from **memory/constitution** if past discussions mention current workflow

Push until you hear a specific workflow: hours spent, dollars wasted, tools duct-taped together, manual processes.

Red flags: "Nothing -- there's no solution, that's why the opportunity is huge." If no one does anything, the problem may not be painful enough.

## Q3: Desperate Specificity

Ask: "Name the actual human who needs this most. What's their role? What keeps them up at night about this problem?"

**Suggested Choices:** Generate 3-4 options representing different user archetypes, informed by codebase context:
- Option naming a **specific role** that interacts with the codebase (contributor types, README audience)
- Option naming a **power user** archetype (someone who would use this daily)
- Option naming an **adjacent stakeholder** (someone affected but not the direct user)

Push until you hear a name, a role, a specific consequence if the problem isn't solved.

Red flags: Category-level answers -- "Healthcare enterprises." "Marketing teams." You can't email a category.

## Infrastructure Prerequisite Scan (Pre-Q4)

After Q3 and before asking Q4, silently check whether the proposed feature requires infrastructure that doesn't exist in the codebase. This is advisory only -- it informs Q4, it does not gate or block the user.

### When to run

Always, using Step 1A codebase context. If Step 1A was skipped (greenfield project), skip this scan.

### How it works

1. Extract feature keywords from the user's initial description + Q1-Q3 answers
2. Match keywords against the table below to identify expected infrastructure
3. Use Grep/Glob to check whether the expected infrastructure exists in the codebase
4. If any infrastructure is **missing**, present findings before Q4
5. If all infrastructure is present or no keywords matched, skip silently

### Keyword-to-infrastructure mapping

| Feature keywords | Expected infrastructure | What to grep for |
|-----------------|------------------------|-----------------|
| dashboard, monitor, status view, observability | Structured event emission, observable state | `emit(`, `EventEmitter`, `on(`, `Observable`, `subscribe` |
| API, endpoint, REST, GraphQL, webhook | HTTP server or route framework | `express`, `fastify`, `createServer`, `Router`, `app.get(`, `app.post(` |
| real-time, live, streaming, push updates | WebSocket, SSE, or pub-sub | `WebSocket`, `ws(`, `EventSource`, `Server-Sent`, `pubsub`, `subscribe` |
| auth, login, permissions, roles, access control | Auth middleware or session management | `passport`, `jwt`, `bcrypt`, `session`, `authenticate`, `authorize` |
| notification, alert, email, SMS | Message queue or push infrastructure | `queue`, `notify`, `sendEmail`, `nodemailer`, `twilio`, `push` |
| search, filter, query | Search index or full-text search | `elasticsearch`, `algolia`, `meilisearch`, `LIKE '%`, `tsvector`, `createIndex` |
| storage, upload, file, image, asset | File storage or CDN integration | `multer`, `S3`, `blob`, `upload`, `createWriteStream`, `sharp` |
| schedule, cron, recurring, periodic | Job scheduler or cron infrastructure | `cron`, `agenda`, `bull`, `setInterval`, `schedule`, `node-cron` |
| database, CRUD, model, migration, persist, store | Relational DB / ORM | `prisma`, `typeorm`, `sequelize`, `knex`, `drizzle`, `sqlalchemy`, `ActiveRecord`, `CREATE TABLE` |
| document, NoSQL, collection, mongo | Document DB / ODM | `mongoose`, `MongoClient`, `firestore`, `dynamodb`, `collection(`, `createCollection` |

> **Ecosystem note:** The grep terms above are illustrative and skew toward Node.js/TypeScript. For Python, Dart, Java, or other ecosystems, adapt to equivalent libraries (e.g., `flask`/`django` instead of `express`, `sqlalchemy` instead of `prisma`). The principle -- checking whether required infrastructure exists -- applies universally.

This table is not exhaustive. Use judgment for feature types not listed -- the principle is: "does this feature assume plumbing that doesn't exist?"

### Presentation

If missing infrastructure is found, present it as a push before Q4:

> "Before we scope the wedge: I checked the codebase and this [feature type] needs [missing infrastructure] that doesn't exist yet. [Specific grep result or absence]. This means the narrowest wedge might be that infrastructure layer rather than the feature on top of it. Keep this in mind for the next question."

Then proceed to Q4 normally. The user decides whether the wedge should be infrastructure or the feature.

### Rules

- **Advisory only.** Never block Q4 or override the user's wedge choice based on this scan.
- If the user acknowledges the gap and chooses to build the feature anyway, respect it. Note the infrastructure gap in the premises (Step 1C) so it surfaces in the PRD's Risks section.
- If multiple infrastructure items are missing, list all of them. Let the user prioritize.
- Do not repeat infrastructure that already exists. Only surface gaps.

## Q4: Narrowest Wedge

Ask: "What's the smallest version of this that someone would actually use -- this week, not after you build the full vision?"

**Suggested Choices:** Generate 3-4 options representing different scope cuts, informed by earlier Q1-Q3 answers and codebase:
- Option that is the **single-command MVP** (one workflow, no config)
- Option that is the **core loop only** (the repeated action, nothing around it)
- Option that **removes the hardest technical piece** and ships the rest
- Reference the user's Q1-Q3 answers to ground the wedge in their stated demand and user

Push until you hear one feature, one workflow, something shippable in days not months.

Red flags: "We need the full platform before anyone can use it." That's attachment to architecture over value.

Bonus push: "What if the user didn't have to do anything at all to get value? No login, no integration, no setup. What would that look like?"

## Q5: Visual Design (UI features only)

Ask: "What should this look like at a glance? How should someone absorb the key information in under 3 seconds?"

**Suggested Choices:** Generate 3-4 options representing different visual approaches, informed by Q1-Q4 answers and the project context:
- Option for a **data-dense** approach (tables, lists, compact layout -- for power users who want everything visible)
- Option for a **visual/infographic** approach (charts, progress bars, color-coded status -- for scanability)
- Option for a **minimal/text** approach (clean typography, big numbers, whitespace -- for glance-and-go)
- Option grounded in **existing project aesthetics** (if the codebase has an existing UI style, reference it)

Push until you hear a concrete visual direction: layout structure, information hierarchy, what stands out first.

Red flags: "Make it look nice." "Modern and clean." These are non-answers. Push: "If someone glances at this for 2 seconds, what's the ONE thing they should see first?"

After the answer, also ask about constraints:
- Light or dark theme? Or system-preference?
- Any branding requirements (logo, colors)?
- Any anti-patterns to avoid? (e.g., "no emoji", "no fancy animations")

**Post-Q5:** The visual design answers feed into REQ-08-style requirements in the PRD. They also inform a future design prototype stage (if the pipeline supports it).

## Response Posture

- Be direct to the point of discomfort. Comfort means you haven't pushed hard enough.
- Push once, then push again. The first answer is the polished version. The real answer comes after the second push.
- Never say "That's an interesting approach" -- take a position instead.
- If you recognize a common failure pattern ("solution in search of a problem," "hypothetical users," "waiting to launch until it's perfect"), name it directly.
- When the user gives a specific, evidence-based answer, name what was good and pivot to a harder question. Don't linger on praise.

## Escape Hatch

If the user says "just do it" or "skip the questions":
- Say: "The hard questions are the value. Let me ask one more, then we'll move."
- If they push back a second time, respect it and proceed to Step 1C immediately.

Smart-skip: If earlier answers already cover a later question, skip it.
