import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const SCRIPT_PATH = "scripts/q0-l4-fill-anchor.sh";

// The script depends on `jq` and `bash`. Skip the whole suite on
// environments that lack either (e.g., bare Windows dev machines).
// CI runs on ubuntu-latest where both are present.
function hasBinary(name: string): boolean {
  try {
    execSync(`bash -c "command -v ${name}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CAN_RUN = hasBinary("bash") && hasBinary("jq");
const describeIf = CAN_RUN ? describe : describe.skip;

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function runScript(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execSync(`bash ${SCRIPT_PATH} ${args.map((a) => `"${a}"`).join(" ")}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
      status: err.status ?? 1,
    };
  }
}

describeIf("q0-l4-fill-anchor.sh", () => {
  let tmpDir: string;
  let anchorPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "q0-l4-fill-"));
    anchorPath = join(tmpDir, "anchor.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("happy path: fills PENDING fields when fill mode is workflow-fill", () => {
    writeFileSync(
      anchorPath,
      JSON.stringify(
        {
          q0MergeSha: "PENDING",
          q0MergedAt: "PENDING",
          q0PrNumber: 200,
          q0FillMode: "workflow-fill",
          q0AnchorCreatedAt: "2026-05-01T00:00:00Z",
          q0L4ProvenBy: null,
        },
        null,
        2,
      ),
    );
    const result = runScript([anchorPath, "abc123def456", "2026-05-10T12:34:56+00:00"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("filled:");
    const updated = JSON.parse(readFileSync(anchorPath, "utf8"));
    expect(updated.q0MergeSha).toBe("abc123def456");
    expect(updated.q0MergedAt).toBe("2026-05-10T12:34:56+00:00");
    expect(updated.q0FillMode).toBe("workflow-fill");
  });

  it("bootstrap no-op: leaves anchor unchanged", () => {
    const original = JSON.stringify(
      {
        q0MergeSha: "a89d7795b37777010edc2d65e8686147ef2bb2cf",
        q0MergedAt: "2026-04-13T01:22:51+08:00",
        q0PrNumber: 159,
        q0FillMode: "bootstrap",
        q0AnchorCreatedAt: "2026-04-13T12:45:00+08:00",
        q0L4ProvenBy: null,
      },
      null,
      2,
    );
    writeFileSync(anchorPath, original);
    const before = sha256(readFileSync(anchorPath));
    const result = runScript([anchorPath, "newsha", "2026-05-01T00:00:00Z"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("bootstrap");
    const after = sha256(readFileSync(anchorPath));
    expect(after).toBe(before);
  });

  it("already-filled no-op: leaves anchor unchanged", () => {
    const original = JSON.stringify(
      {
        q0MergeSha: "realsha",
        q0MergedAt: "2026-05-01T00:00:00Z",
        q0PrNumber: 200,
        q0FillMode: "workflow-fill",
        q0AnchorCreatedAt: "2026-05-01T00:00:00Z",
        q0L4ProvenBy: null,
      },
      null,
      2,
    );
    writeFileSync(anchorPath, original);
    const before = sha256(readFileSync(anchorPath));
    const result = runScript([anchorPath, "newsha", "2026-05-10T00:00:00Z"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("already");
    const after = sha256(readFileSync(anchorPath));
    expect(after).toBe(before);
  });

  it("missing file: exits non-zero with 'not found'", () => {
    const missing = join(tmpDir, "nope.json");
    expect(existsSync(missing)).toBe(false);
    const result = runScript([missing, "somesha", "2026-05-10T00:00:00Z"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not found");
  });
});
