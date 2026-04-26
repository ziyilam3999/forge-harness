/**
 * Master-branch story reconciliation helper for the dashboard renderer.
 *
 * Why this exists
 * ───────────────
 * The forge dashboard previously rendered story statuses verbatim from
 * `.forge/coordinate-brief.json`. That file is only rewritten by
 * `forge_coordinate`, so after a story's PR squash-merges to master the
 * brief stays frozen — the kanban shows that story in `Ready` for hours
 * or days until someone manually re-runs `forge_coordinate`.
 *
 * Comparing each RunRecord's `lastGitSha` against the master commit graph
 * (`git rev-list origin/master --contains <sha>`) does NOT work for the
 * standard `/ship` flow because squash-merges produce a NEW commit on
 * master whose SHA differs from the original branch HEAD. The squash SHA
 * is unrelated to `lastGitSha`, so `--contains` returns nothing and the
 * renderer never updates.
 *
 * The signal that survives squash-merging is the conventional-commit
 * subject — `/ship` produces messages like
 *   `feat(US-05): knowledge service facade (#72)`
 * with the story ID embedded. This helper reads recent `origin/master`
 * commit subjects and extracts the set of `US-NN` IDs that appear, so the
 * renderer can mark those stories `done` regardless of the brief.
 *
 * Design constraints (from the upstream plan):
 *   - Single git invocation per render (NOT per story). Plan AC-5.
 *   - Robust to missing git binary, missing master ref, detached HEAD,
 *     no remotes, child-process timeout. Plan AC-4.
 *   - Robust to default-branch variation: probe `origin/master`,
 *     `origin/main`, `master`, `main` in order. Plan AC-6.
 *   - Multi-story commit subjects (`chore: backfill US-01..US-04 (#67)`)
 *     surface every matched ID, not just the first. Plan AC-8.
 *   - Never throws — failures return an empty set + a warning string so
 *     the renderer falls back to the brief verbatim. Plan AC-4.
 *   - Story-ID regex is case-insensitive (`US-05` and `us-05` both match)
 *     but word-bounded (`US-05a` does not), and captured IDs are
 *     normalized to upper-case before set insertion so dashboard
 *     comparisons are case-stable.
 *
 * Caveat — stale `origin/master`
 * ──────────────────────────────
 * If the operator hasn't `git fetch`-ed since the merge, the local
 * `origin/master` ref is behind the remote and the helper sees nothing.
 * The dashboard never makes network calls; this is accepted. The
 * dashboard catches up after the next fetch (which happens automatically
 * during `/ship` Stage 7's `git pull`).
 */

import { execFile } from "node:child_process";

// ── Public types ──────────────────────────────────────────────────────────

export interface ReadShippedStoriesOpts {
  /** Number of master commits to scan. Default 50. */
  limit?: number;
  /**
   * Master ref to scan. When omitted, the helper probes
   * `origin/master`, `origin/main`, `master`, `main` in order and uses
   * the first one that resolves. Tests pass an explicit ref to bypass
   * the probe.
   */
  ref?: string;
  /** Soft timeout in ms for the git child process. Default 2000. */
  timeoutMs?: number;
}

export interface ReadShippedStoriesResult {
  /** Story IDs (upper-cased) that appear in at least one master subject. */
  shippedStoryIds: Set<string>;
  /**
   * Per-match audit trail — useful for debug rendering and tests.
   * Includes one entry per (storyId, sha) pair, so a single commit that
   * mentions two IDs produces two entries.
   */
  matches: ReadonlyArray<{ storyId: string; sha: string; subject: string }>;
  /**
   * Surfaces fallback reason when the helper had to swallow a git error.
   * `null` when the call succeeded normally (even if the result set is
   * empty because no matching subjects were found).
   */
  warning: string | null;
}

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Run a git command via `execFile`. Resolves with stdout on success;
 * rejects with `{ kind, message }` on failure so callers can distinguish
 * "git missing" from "ref missing" from "timed out" without re-parsing
 * stderr strings.
 */
type GitFailureKind =
  | "git-missing"
  | "ref-missing"
  | "no-remotes"
  | "detached-head"
  | "timeout"
  | "other";

interface GitFailure {
  kind: GitFailureKind;
  message: string;
}

function runGit(
  cwd: string,
  args: ReadonlyArray<string>,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      args as string[],
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(stdout);
          return;
        }
        const stderrStr: string = typeof stderr === "string" ? stderr : "";
        const errnoCode = (err as NodeJS.ErrnoException).code;
        // ENOENT on the spawn itself → git binary not on PATH.
        if (errnoCode === "ENOENT") {
          reject({ kind: "git-missing", message: "git binary not found on PATH" } satisfies GitFailure);
          return;
        }
        // execFile timeout: child receives SIGTERM and `signal` is set.
        const signal = (err as NodeJS.ErrnoException & { signal?: string }).signal;
        if (signal === "SIGTERM" || (err as Error & { killed?: boolean }).killed === true) {
          reject({ kind: "timeout", message: `git timed out after ${timeoutMs}ms` } satisfies GitFailure);
          return;
        }
        // Heuristic stderr patterns for the no-remotes / unknown-ref failure modes.
        const stderrLower = stderrStr.toLowerCase();
        if (
          stderrLower.includes("unknown revision") ||
          stderrLower.includes("bad revision") ||
          stderrLower.includes("ambiguous argument") ||
          stderrLower.includes("not a valid object name")
        ) {
          reject({ kind: "ref-missing", message: stderrStr.trim() || "ref not found" } satisfies GitFailure);
          return;
        }
        if (stderrLower.includes("not a git repository")) {
          reject({ kind: "other", message: "not a git repository" } satisfies GitFailure);
          return;
        }
        reject({
          kind: "other",
          message: stderrStr.trim() || (err instanceof Error ? err.message : String(err)),
        } satisfies GitFailure);
      },
    );
  });
}

/**
 * Probe candidate refs in order; return the first one that resolves via
 * `git rev-parse --verify <ref>`. Throws a `GitFailure` with kind
 * `ref-missing` when none of the candidates resolve, or `git-missing` /
 * `timeout` when the underlying invocation fails.
 *
 * The probe uses `rev-parse --verify` (not `show-ref`) because `--verify`
 * is silent on the resolved object and exits non-zero with a clear
 * "unknown revision" stderr when the ref is absent — easier to classify
 * than `show-ref`'s "no output" success-but-empty mode.
 */
const REF_CANDIDATES = ["origin/master", "origin/main", "master", "main"] as const;

async function discoverMasterRef(cwd: string, timeoutMs: number): Promise<string> {
  let lastFailure: GitFailure | null = null;
  for (const candidate of REF_CANDIDATES) {
    try {
      await runGit(cwd, ["rev-parse", "--verify", "--quiet", candidate], timeoutMs);
      return candidate;
    } catch (e) {
      lastFailure = e as GitFailure;
      // git-missing / timeout: bubble up immediately, no point probing further.
      if (lastFailure.kind === "git-missing" || lastFailure.kind === "timeout") {
        throw lastFailure;
      }
      // ref-missing / other: keep probing.
    }
  }
  throw {
    kind: "ref-missing" as const,
    message: `none of ${REF_CANDIDATES.join(", ")} resolved on this repo (${lastFailure?.message ?? "no further detail"})`,
  } satisfies GitFailure;
}

/**
 * Per-projectPath cache for ref discovery. Lives for the process lifetime;
 * per the plan, the renderer is invoked many times per second of operator
 * polling and re-probing every render is wasteful. The cache key is
 * `projectPath` so projects with different default branches stay isolated.
 *
 * Exported `__resetCacheForTests` lets the test suite clear it between
 * cases without exposing the Map directly.
 */
const refCache = new Map<string, string>();

export function __resetCacheForTests(): void {
  refCache.clear();
}

// Story-ID regex: `US-` followed by one-or-more digits, word-bounded so
// `US-05a` does not match. Case-insensitive: `us-05` matches and is
// upper-cased before insertion. The `g` flag is required because we call
// `.matchAll()` to extract every ID per subject (plan AC-8).
const STORY_ID_RE = /\b(US-\d+)\b/gi;

function extractStoryIds(subject: string): string[] {
  const out: string[] = [];
  for (const match of subject.matchAll(STORY_ID_RE)) {
    out.push(match[1].toUpperCase());
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Read shipped story IDs from recent `origin/master` commit subjects.
 *
 * Returns an empty set + a `warning` string on any git-side failure
 * (missing binary, missing ref, detached HEAD, no remotes, timeout). The
 * caller (renderer) falls back to brief-verbatim status; nothing throws.
 *
 * Performs ONE `git log` invocation regardless of how many stories are
 * in the brief (plan AC-5).
 */
export async function readShippedStoriesFromMaster(
  projectPath: string,
  opts: ReadShippedStoriesOpts = {},
): Promise<ReadShippedStoriesResult> {
  const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : 50;
  const timeoutMs =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 2000;

  // Resolve which ref to scan. Explicit `opts.ref` bypasses the probe;
  // otherwise consult the per-projectPath cache, otherwise probe.
  let ref: string;
  try {
    if (opts.ref) {
      ref = opts.ref;
    } else {
      const cached = refCache.get(projectPath);
      if (cached) {
        ref = cached;
      } else {
        ref = await discoverMasterRef(projectPath, timeoutMs);
        refCache.set(projectPath, ref);
      }
    }
  } catch (e) {
    const failure = e as GitFailure;
    return emptyResult(`master ref discovery failed: ${failure.kind} (${failure.message})`);
  }

  // One `git log` call. `--first-parent` keeps the result deterministic
  // when the master history contains octopus or unrelated merges; the
  // `%x00` field separator is a NUL byte so commit subjects with spaces,
  // colons, or parentheses parse without splitting heuristics.
  let stdout: string;
  try {
    stdout = await runGit(
      projectPath,
      [
        "log",
        ref,
        "--first-parent",
        `-${limit}`,
        "--no-decorate",
        // %H = full sha, %s = subject. NUL-separated so subjects with
        // arbitrary characters (including newlines via `\n`) are safe.
        // Lines themselves are LF-separated, which is what `split('\n')`
        // expects.
        "--format=%H%x00%s",
      ],
      timeoutMs,
    );
  } catch (e) {
    const failure = e as GitFailure;
    return emptyResult(`git log on ${ref} failed: ${failure.kind} (${failure.message})`);
  }

  const shippedStoryIds = new Set<string>();
  const matches: Array<{ storyId: string; sha: string; subject: string }> = [];

  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const sep = line.indexOf("\x00");
    if (sep === -1) continue;
    const sha = line.slice(0, sep);
    const subject = line.slice(sep + 1);
    if (!sha || !subject) continue;
    for (const storyId of extractStoryIds(subject)) {
      shippedStoryIds.add(storyId);
      matches.push({ storyId, sha, subject });
    }
  }

  return { shippedStoryIds, matches, warning: null };
}

function emptyResult(warning: string): ReadShippedStoriesResult {
  return {
    shippedStoryIds: new Set<string>(),
    matches: [],
    warning,
  };
}
