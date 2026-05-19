import { afterEach, describe, expect, it } from "vitest";
import { buildPatchValidationHarnessSpec } from "../../src/reference/patch-validation.js";
import { compileHarnessSpec } from "../../src/compiler/compile.js";
import { createPatchValidationFixture } from "../helpers/createPatchValidationFixture.js";
import { runCompiledWorkflow } from "../helpers/runCompiledWorkflow.js";
import type { ToolNode } from "../../src/spec/types.js";

describe("buildPatchValidationHarnessSpec failures", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("routes to not-reproduced when the baseline reproduce command passes on baseline", async () => {
    const fixture = createPatchValidationFixture({ baselineAlwaysPasses: true });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPatchValidationHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {});

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("not-reproduced");

    const baselineOutput = result.outputs["run-baseline"] as { reproduced: boolean };
    expect(baselineOutput.reproduced).toBe(false);
  });

  it("routes to apply-failed when the branch candidate does not exist", async () => {
    const fixture = createPatchValidationFixture({ applyFailure: true, candidateKind: "branch" });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPatchValidationHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {});

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("apply-failed");

    const applyOutput = result.outputs["apply-candidate"] as { applied: boolean; reason?: string };
    expect(applyOutput.applied).toBe(false);
    expect(applyOutput.reason).toMatch(/branch checkout failed/);
  });

  it("routes to apply-failed when the patch-file candidate is malformed", async () => {
    const fixture = createPatchValidationFixture({ applyFailure: true, candidateKind: "patchFile" });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPatchValidationHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {});

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("apply-failed");

    const applyOutput = result.outputs["apply-candidate"] as { applied: boolean; reason?: string };
    expect(applyOutput.applied).toBe(false);
    expect(applyOutput.reason).toMatch(/patch apply failed/);
  });

  it("routes to candidate-failed when the bug still reproduces after candidate is applied", async () => {
    const fixture = createPatchValidationFixture({ fixDoesNotFixBug: true });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPatchValidationHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {});

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("candidate-failed");

    const candidateOutput = result.outputs["run-candidate-reproduce"] as { reproduced: boolean };
    expect(candidateOutput.reproduced).toBe(true);
  });

  it("routes to candidate-failed when the candidate passes reproduction but fails broader verification", async () => {
    const fixture = createPatchValidationFixture({ verificationFailure: true });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPatchValidationHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {});

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("candidate-failed");

    const candidateOutput = result.outputs["run-candidate-reproduce"] as { reproduced: boolean };
    expect(candidateOutput.reproduced).toBe(false);

    const verificationOutput = result.outputs["run-verification"] as { passed: boolean };
    expect(verificationOutput.passed).toBe(false);
  });

  it("routes to rejected when the human reviewer rejects the candidate", async () => {
    const fixture = createPatchValidationFixture({ approvalRequired: true });
    cleanups.push(fixture.cleanup);

    const compiled = compileHarnessSpec(buildPatchValidationHarnessSpec(fixture.bundle));
    const result = await runCompiledWorkflow(compiled, fixture.bundle, {
      llmResult: { summary: "Candidate looks good but requires human sign-off." },
      humanResponse: { approved: false },
    });

    expect(result.status).toBe("completed");
    expect(result.terminalNodeId).toBe("rejected");
  });

  it("exhausts retries and throws when run-verification emits a transient error", async () => {
    const fixture = createPatchValidationFixture();
    cleanups.push(fixture.cleanup);

    const spec = buildPatchValidationHarnessSpec(fixture.bundle);

    // Patch run-verification to throw a transient error instead of returning JSON.
    const verifyIdx = spec.graph.nodes.findIndex(n => n.id === "run-verification");
    const originalNode = spec.graph.nodes[verifyIdx] as ToolNode;
    spec.graph.nodes[verifyIdx] = {
      ...originalNode,
      args: ["-lc", `echo 'transient-verify-fail' >&2 && exit 1`],
      retryPolicy: {
        maxAttempts: 2,
        backoff: "constant",
        initialDelay: 0,
        retryOn: ["transient"],
      },
      executionPolicy: {
        failureClassification: [
          { pattern: "transient-verify-fail", category: "transient", retry: true },
        ],
      },
    } as ToolNode;

    const compiled = compileHarnessSpec(spec);

    await expect(
      runCompiledWorkflow(compiled, fixture.bundle, {}),
    ).rejects.toThrow(/transient-verify-fail/i);
  });
});
