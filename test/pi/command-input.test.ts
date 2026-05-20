import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCommandTarget } from "../../src/pi/command-input.js";

const tempDirs: string[] = [];

const patchRequest = {
  workflow: "patch-validation" as const,
  input: {
    repoPath: "/tmp/repo",
    baselineRef: "main",
    candidateSource: { kind: "patchFile" as const, value: "/tmp/fix.patch" },
    reproduceCommands: ["npm test -- --grep broken"],
    verificationCommands: ["npm test"],
    reviewInstructions: "Approve if the patch applies cleanly and verification passes.",
    approvalRequired: false,
  },
};

const customSpec = {
  name: "custom-echo",
  graph: {
    entryNodeId: "echo",
    nodes: [
      {
        id: "echo",
        kind: "tool" as const,
        tool: "bash",
        args: ["-lc", "echo hello"],
      },
    ],
    edges: [],
  },
};

describe("parseCommandTarget", () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("parses a bundled workflow request as a reference target", async () => {
    const target = await parseCommandTarget(JSON.stringify(patchRequest), "compile");

    expect(target).toEqual({
      kind: "reference",
      request: patchRequest,
      runtimeInput: {},
    });
  });

  it("parses raw HarnessSpec JSON as a custom target with empty runtime input", async () => {
    const target = await parseCommandTarget(JSON.stringify(customSpec), "compile");

    expect(target).toEqual({
      kind: "custom",
      spec: customSpec,
      runtimeInput: {},
    });
  });

  it("parses a generic envelope with embedded spec and explicit runtime input", async () => {
    const runtimeInput = { ticket: 42, dryRun: true };
    const target = await parseCommandTarget(JSON.stringify({ spec: customSpec, input: runtimeInput }), "run");

    expect(target).toEqual({
      kind: "custom",
      spec: customSpec,
      runtimeInput,
    });
  });

  it("loads a custom spec from specPath with explicit runtime input", async () => {
    const specPath = await createSpecFile(JSON.stringify(customSpec, null, 2));
    const runtimeInput = { branch: "feature/test" };

    const target = await parseCommandTarget(JSON.stringify({ specPath, input: runtimeInput }), "run");

    expect(target).toEqual({
      kind: "custom",
      spec: customSpec,
      runtimeInput,
    });
  });

  it("loads a direct absolute-path shorthand with empty runtime input", async () => {
    const specPath = await createSpecFile(JSON.stringify(customSpec, null, 2));

    const target = await parseCommandTarget(specPath, "run");

    expect(target).toEqual({
      kind: "custom",
      spec: customSpec,
      runtimeInput: {},
    });
  });

  it("treats Windows-style absolute paths as file paths before JSON parsing", async () => {
    await expect(parseCommandTarget("path:C:\\temp\\spec.json", "compile")).rejects.toThrow(
      "Spec file not found: C:\\temp\\spec.json",
    );

    await expect(parseCommandTarget("C:\\temp\\spec.json", "compile")).rejects.toThrow(
      "Spec file not found: C:\\temp\\spec.json",
    );
  });

  it("rejects relative spec paths clearly", async () => {
    await expect(parseCommandTarget("path:spec.json", "compile")).rejects.toThrow(
      "Spec path must be an absolute path",
    );

    await expect(parseCommandTarget("spec.json", "compile")).rejects.toThrow(
      "Spec path must be an absolute path",
    );
  });

  it("rejects generic envelopes that contain both spec and specPath", async () => {
    const specPath = await createSpecFile(JSON.stringify(customSpec, null, 2));

    await expect(parseCommandTarget(JSON.stringify({ spec: customSpec, specPath }), "compile")).rejects.toThrow(
      "Generic harness request must include exactly one of `spec` or `specPath`",
    );
  });

  it("rejects string spec values and points operators to specPath", async () => {
    await expect(parseCommandTarget(JSON.stringify({ spec: "/tmp/spec.json" }), "run")).rejects.toThrow(
      "Generic harness request uses `specPath` for file paths, not `spec`",
    );
  });

  it("rejects invalid JSON in a spec file with a file-specific error", async () => {
    const specPath = await createSpecFile("{not-json");

    await expect(parseCommandTarget(specPath, "compile")).rejects.toThrow(
      `Spec file must contain valid JSON: ${specPath}`,
    );
  });
});

async function createSpecFile(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lasso-spec-"));
  tempDirs.push(dir);
  const specPath = join(dir, "custom-spec.json");
  await writeFile(specPath, contents, "utf8");
  return specPath;
}
