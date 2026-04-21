/**
 * Declaration store for forge_declare_story.
 *
 * An agent calls forge_declare_story({ storyId, phaseId }) to declare
 * "I am currently implementing this story/phase." The declaration is
 * stored in a module-level variable so forge_status can surface it in
 * the `activeRun` field even before a ProgressReporter has flushed its
 * first `.forge/activity.json` update (Scenario A — the 55ms init
 * window).
 *
 * Scope:
 *  - Process-scoped memory only. NOT persisted to disk.
 *  - Lost on MCP server restart (by design — matches monday-bot's
 *    out-of-scope: "no disk persistence").
 *  - Singular, not session-keyed or agent-keyed. A second
 *    forge_declare_story call overwrites the first.
 *
 * Lifecycle:
 *  - set(): called by forge_declare_story handler. Records storyId,
 *    phaseId, and declaration timestamp.
 *  - get(): called by forge_status handler. Returns current declaration
 *    or null.
 *  - clear(): available for tests (via vi.resetModules()) and for
 *    future explicit "I'm done" semantics. Not currently called by
 *    any tool.
 *
 * This module is intentionally NOT re-exported from any barrel — its
 * state is a singleton, and barrel imports can duplicate module state
 * under some bundler configurations. Import the file directly.
 */

export interface StoryDeclaration {
  storyId: string;
  phaseId: string | null;
  declaredAt: string; // ISO-8601
}

let currentDeclaration: StoryDeclaration | null = null;

/**
 * Record a new story declaration. Overwrites any prior declaration.
 * Callers are responsible for passing a non-empty storyId — the
 * handler's Zod schema enforces that at the MCP boundary.
 */
export function setDeclaration(storyId: string, phaseId: string | null): StoryDeclaration {
  currentDeclaration = {
    storyId,
    phaseId,
    declaredAt: new Date().toISOString(),
  };
  return currentDeclaration;
}

/**
 * Return the current declaration, or null if none has been made in
 * this process lifetime.
 */
export function getDeclaration(): StoryDeclaration | null {
  return currentDeclaration;
}

/**
 * Clear the current declaration. Exposed for test isolation and for
 * potential future "I'm done" semantics. Not currently called by any
 * tool handler.
 */
export function clearDeclaration(): void {
  currentDeclaration = null;
}
