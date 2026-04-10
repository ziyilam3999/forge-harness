import { describe, it, expect } from "vitest";
import { topoSort } from "./topo-sort.js";
import type { Story } from "../types/execution-plan.js";

function makeStory(id: string, deps?: string[]): Story {
  return {
    id,
    title: `Story ${id}`,
    dependencies: deps,
    acceptanceCriteria: [{ id: `${id}-AC01`, description: "check", command: "echo ok" }],
  };
}

describe("topoSort", () => {
  it("returns empty array for empty input", () => {
    expect(topoSort([])).toEqual([]);
  });

  it("returns single story unchanged", () => {
    const stories = [makeStory("US-01")];
    const result = topoSort(stories);
    expect(result.map((s) => s.id)).toEqual(["US-01"]);
  });

  it("sorts a chain of dependencies: US-01 → US-02 → US-03", () => {
    const stories = [
      makeStory("US-03", ["US-02"]),
      makeStory("US-02", ["US-01"]),
      makeStory("US-01"),
    ];
    const result = topoSort(stories);
    expect(result.map((s) => s.id)).toEqual(["US-01", "US-02", "US-03"]);
  });

  it("handles reverse input order for chained deps", () => {
    const stories = [
      makeStory("US-03", ["US-02"]),
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
    ];
    const result = topoSort(stories);
    expect(result.map((s) => s.id)).toEqual(["US-01", "US-02", "US-03"]);
  });

  it("applies lex tie-break: US-A before US-Z when both are zero-in-degree", () => {
    const stories = [
      makeStory("US-Z"),
      makeStory("US-A"),
    ];
    const result = topoSort(stories);
    expect(result.map((s) => s.id)).toEqual(["US-A", "US-Z"]);
  });

  it("lex tie-break with multiple independent stories", () => {
    const stories = [
      makeStory("US-C"),
      makeStory("US-A"),
      makeStory("US-B"),
    ];
    const result = topoSort(stories);
    expect(result.map((s) => s.id)).toEqual(["US-A", "US-B", "US-C"]);
  });

  it("throws on cycle", () => {
    const stories = [
      makeStory("US-01", ["US-02"]),
      makeStory("US-02", ["US-01"]),
    ];
    expect(() => topoSort(stories)).toThrow();
  });

  it("throws on self-referencing cycle via transitive path", () => {
    const stories = [
      makeStory("US-01", ["US-03"]),
      makeStory("US-02", ["US-01"]),
      makeStory("US-03", ["US-02"]),
    ];
    expect(() => topoSort(stories)).toThrow();
  });

  it("respects dependencies while applying lex tie-break", () => {
    // US-A depends on US-C, US-B is independent
    // Expected: US-B first (lex smallest independent), then US-C (unblocked), then US-A
    const stories = [
      makeStory("US-A", ["US-C"]),
      makeStory("US-B"),
      makeStory("US-C"),
    ];
    const result = topoSort(stories);
    expect(result.map((s) => s.id)).toEqual(["US-B", "US-C", "US-A"]);
  });

  it("ignores dependencies on stories not in the input set", () => {
    const stories = [
      makeStory("US-02", ["US-01"]), // US-01 not in input
      makeStory("US-03"),
    ];
    const result = topoSort(stories);
    // Both are effectively zero-in-degree, lex order
    expect(result.map((s) => s.id)).toEqual(["US-02", "US-03"]);
  });

  it("handles diamond dependency graph", () => {
    // US-01 → US-02, US-01 → US-03, US-02 → US-04, US-03 → US-04
    const stories = [
      makeStory("US-04", ["US-02", "US-03"]),
      makeStory("US-02", ["US-01"]),
      makeStory("US-03", ["US-01"]),
      makeStory("US-01"),
    ];
    const result = topoSort(stories);
    expect(result.map((s) => s.id)).toEqual(["US-01", "US-02", "US-03", "US-04"]);
  });
});
