import type { Story } from "../types/execution-plan.js";
import { detectCycles } from "../validation/execution-plan.js";

/**
 * Topologically sort stories using Kahn's algorithm with stable
 * lexicographic tie-breaking on story.id (ascending).
 *
 * @param stories - Stories to sort. Each may have `dependencies` referencing other story IDs.
 * @returns A new array of stories in dependency-respecting order.
 * @throws If the dependency graph contains a cycle.
 */
export function topoSort(stories: Story[]): Story[] {
  if (stories.length === 0) return [];

  // Check for cycles first
  const cycleError = detectCycles(stories);
  if (cycleError) {
    throw new Error(cycleError);
  }

  const storyMap = new Map<string, Story>();
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // parent → children that depend on it

  for (const story of stories) {
    storyMap.set(story.id, story);
    inDegree.set(story.id, 0);
    dependents.set(story.id, []);
  }

  for (const story of stories) {
    const deps = story.dependencies ?? [];
    for (const dep of deps) {
      if (storyMap.has(dep)) {
        inDegree.set(story.id, (inDegree.get(story.id) ?? 0) + 1);
        dependents.get(dep)!.push(story.id);
      }
    }
  }

  // Seed the ready queue with zero-in-degree stories, sorted lex by id
  const ready: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) ready.push(id);
  }
  ready.sort();

  const result: Story[] = [];

  while (ready.length > 0) {
    // Pop the lex-smallest
    const current = ready.shift()!;
    result.push(storyMap.get(current)!);

    for (const child of dependents.get(current)!) {
      const newDeg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) {
        ready.push(child);
        ready.sort(); // Re-sort to maintain lex order
      }
    }
  }

  return result;
}
