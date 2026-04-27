/**
 * AC-2 integration test for the US-08 ADR-extractor regression (W1).
 *
 * Reproduces the bug end-to-end: when a story PASSes and a real ADR stub
 * with multi-line YAML block scalars is staged, the post-PASS ADR-extractor
 * must canonicalise it AND `RunRecord.generatedDocs.adrPaths` must carry the
 * resulting path.
 *
 * Unlike `evaluate.test.ts`, this file deliberately does NOT mock
 * `../lib/adr-extractor.js` — the real parser + processStory pipeline runs
 * against a temp project on disk. Spec-generator IS mocked so the test
 * doesn't depend on real LLM calls or `docs/generated/` writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallClaudeResult } from "../lib/anthropic.js";

// Mock the evaluator: returns PASS for any storyId.
vi.mock("../lib/evaluator.js", () => ({
  evaluateStory: vi.fn(async (_plan: unknown, storyId: string) => ({
    storyId,
    verdict: "PASS" as const,
    criteria: [{ id: "AC-01", status: "PASS" as const, evidence: "ok" }],
  })),
}));

// Mock anthropic
vi.mock("../lib/anthropic.js", () => ({
  callClaude: vi.fn(),
  extractJson: vi.fn((text: string) => JSON.parse(text)),
}));

// Mock codebase-scan
vi.mock("../lib/codebase-scan.js", () => ({
  scanCodebase: vi.fn(async () => "## Directory Structure\n```\nserver/\n```"),
}));

// Mock run-record: capture writes, keep helpers real.
vi.mock("../lib/run-record.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/run-record.js")>(
    "../lib/run-record.js",
  );
  return {
    writeRunRecord: vi.fn(async () => {}),
    canonicalizeEvalReport: actual.canonicalizeEvalReport,
    computeSpecGenCostUsd: actual.computeSpecGenCostUsd,
  };
});

// Mock spec-generator (real adr-extractor stays unmocked).
vi.mock("../lib/spec-generator.js", () => ({
  generateSpecForStory: vi.fn(
    async (input: { projectPath: string; storyId: string }) => ({
      specPath: `${input.projectPath}/docs/generated/TECHNICAL-SPEC.md`,
      genTimestamp: "2026-04-27T00:00:00.000Z",
      genTokens: { inputTokens: 0, outputTokens: 0 },
      contracts: [],
      bodyChanged: true,
      warnings: [],
    }),
  ),
}));

// Mock run-context.
vi.mock("../lib/run-context.js", async () => {
  const { callClaude: mockedClaude } = await import("../lib/anthropic.js");

  class MockRunContext {
    _inputTokens = 0;
    _outputTokens = 0;
    cost = {
      summarize: () => ({
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0.001,
        breakdown: [],
        isOAuthAuth: false,
      }),
      recordUsage: vi.fn(),
    };
    progress = {
      begin: vi.fn(),
      complete: vi.fn(),
      skip: vi.fn(),
      fail: vi.fn(),
      getResults: () => [],
    };
    audit = { log: vi.fn(async () => {}) };
    toolName = "forge_evaluate";
  }

  return {
    RunContext: MockRunContext,
    trackedCallClaude: vi.fn(
      async (
        _ctx: unknown,
        _stage: string,
        _role: string,
        options: unknown,
      ): Promise<CallClaudeResult> => {
        return await mockedClaude(
          options as Parameters<typeof mockedClaude>[0],
        );
      },
    ),
  };
});

import { writeRunRecord } from "../lib/run-record.js";
import { handleEvaluate } from "./evaluate.js";

const mockedWriteRunRecord = vi.mocked(writeRunRecord);

function makePlanJson(): string {
  return JSON.stringify({
    schemaVersion: "3.0.0",
    stories: [
      {
        id: "US-08",
        title: "Slack adapter",
        acceptanceCriteria: [
          { id: "AC-01", description: "Bot connects", command: "echo ok" },
        ],
      },
    ],
  });
}

describe("evaluate — post-PASS ADR-extractor integration (AC-2)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-evaluate-adr-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("populates RunRecord.generatedDocs.adrPaths when a story has a real multi-line stub staged", async () => {
    // Arrange: stage a real ADR stub mirroring monday-bot's US-08 format
    // (YAML `|` literal block scalars for multi-line fields).
    const stagingDir = join(tmp, ".forge", "staging", "adr", "US-08");
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(
      join(stagingDir, "add-slack-bolt-socket-mode.md"),
      [
        "---",
        "title: Adopt @slack/bolt with Socket Mode for the Slack adapter",
        "story: US-08",
        "context: |",
        "  US-08 introduces the Slack-facing surface of monday-bot.",
        "  We need a Slack SDK that supports Socket Mode.",
        "decision: |",
        "  Add `@slack/bolt` (v4.x) as a runtime dependency.",
        "consequences: |",
        "  + Bundle gains `@slack/bolt` and transitive deps.",
        "alternatives: |",
        "  - HTTP Receiver: rejected — requires public ingress.",
        "---",
        "",
        "body",
        "",
      ].join("\n"),
      "utf-8",
    );

    // Act: run forge_evaluate against the temp project.
    const result = await handleEvaluate({
      storyId: "US-08",
      planJson: makePlanJson(),
      projectPath: tmp,
    });

    // Assert: the eval succeeded.
    expect(result.isError).toBeUndefined();

    // Assert: RunRecord was written with adrPaths populated.
    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [recordedPath, record] = mockedWriteRunRecord.mock.calls[0];
    expect(recordedPath).toBe(tmp);
    expect(record.tool).toBe("forge_evaluate");
    expect(record.evalVerdict).toBe("PASS");

    // The bug: pre-W1 fix this would be `[]` because the parser threw on
    // indented continuation lines and the catch at evaluate.ts:442-446
    // silently swallowed it. Post-W1 fix: exactly one canonicalised ADR path.
    expect(record.generatedDocs).toBeDefined();
    expect(record.generatedDocs!.adrPaths).toHaveLength(1);
    expect(record.generatedDocs!.adrPaths[0]).toMatch(
      /ADR-0001-adopt-slack-bolt-with-socket-mode-for-the-slack-adapter-US-08\.md$/,
    );

    // Filesystem cross-check: the canonical ADR file exists, INDEX.md was
    // written, and staging was cleaned up.
    const decisionsDir = join(tmp, "docs", "decisions");
    expect(existsSync(decisionsDir)).toBe(true);
    const adrFiles = readdirSync(decisionsDir).filter((n) => /^ADR-\d{4}-/.test(n));
    expect(adrFiles).toHaveLength(1);
    expect(existsSync(join(decisionsDir, "INDEX.md"))).toBe(true);
    expect(existsSync(stagingDir)).toBe(false);
  });
});
