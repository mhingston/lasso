import { describe, it, expect, afterEach } from "vitest";
import { compileHarnessSpec } from "../../src/compiler/compile.js";
import { buildReferenceHarnessSpec } from "../../src/reference/catalog.js";
import { prepareInitialAdaptiveInput, unwrapAdaptiveInput } from "../../src/replanner/runtime.js";
import { runCompiledWorkflow } from "../helpers/runCompiledWorkflow.js";
import { createPatchValidationFixture, type PatchValidationFixture } from "../helpers/createPatchValidationFixture.js";
import type { ReferenceWorkflowRequest } from "../../src/reference/catalog.js";

describe("adaptive runtime integration", () => {
  const fixtures: PatchValidationFixture[] = [];

  afterEach(() => {
    for (const fixture of fixtures) {
      fixture.cleanup();
    }
    fixtures.length = 0;
  });

  it("should trigger continueAsNew for high-risk validated-fix and escalate to approvalRequired", async () => {
    const fixture = createPatchValidationFixture({ candidateKind: "patchFile" });
    fixtures.push(fixture);

    const request: ReferenceWorkflowRequest = {
      workflow: "patch-validation",
      input: fixture.bundle,
    };

    const initialSpec = buildReferenceHarnessSpec(request);
    const compiled = compileHarnessSpec(initialSpec);
    const adaptiveInput = prepareInitialAdaptiveInput(request, initialSpec, {});

    const result = await runCompiledWorkflow(
      compiled,
      adaptiveInput as any,
      {
        llmResult: { approved: true },
        humanResponse: { approved: true },
        maxContinuations: 2,
      },
    );

    expect(result.adaptiveMetadata).toBeDefined();
    expect(result.adaptiveMetadata?.currentVersion.version).toBe(2);
    expect(result.adaptiveMetadata?.currentVersion.parentVersion).toBe(1);
    expect(result.adaptiveMetadata?.currentVersion.reason).toMatch(/escalation|risk/);
    expect(result.adaptiveMetadata?.currentRequest.workflow).toBe("patch-validation");
    expect(result.adaptiveMetadata?.currentRequest.input.approvalRequired).toBe(true);
    expect(result.lineage).toHaveLength(1);
    expect(result.lineage?.[0].version).toBe(1);
    expect(result.lineage?.[0].terminalNodeId).toBe("validated-fix");

    const adaptiveMetadata = result.adaptiveMetadata!;
    const v2Spec = adaptiveMetadata.currentVersion.spec;

    const v2GraphNode = v2Spec.graph.nodes.find(n => n.kind === "human");
    expect(v2GraphNode).toBeDefined();
    expect(v2GraphNode?.kind).toBe("human");
  });

  it("should stop after validated-fix with low risk and no escalation", async () => {
    const fixture = createPatchValidationFixture({ candidateKind: "branch" });
    fixtures.push(fixture);

    const request: ReferenceWorkflowRequest = {
      workflow: "patch-validation",
      input: fixture.bundle,
    };

    const initialSpec = buildReferenceHarnessSpec(request);
    const compiled = compileHarnessSpec(initialSpec);
    const adaptiveInput = prepareInitialAdaptiveInput(request, initialSpec, {});

    const result = await runCompiledWorkflow(
      compiled,
      adaptiveInput as any,
      {
        llmResult: { approved: true },
        humanResponse: { approved: true },
        maxContinuations: 0,
      },
    );

    expect(result.adaptiveMetadata).toBeDefined();
    expect(result.adaptiveMetadata?.currentVersion.version).toBe(1);
    expect(result.lineage).toHaveLength(0);
  });

  it("should carry lineage metadata through result", async () => {
    const fixture = createPatchValidationFixture({ candidateKind: "patchFile" });
    fixtures.push(fixture);

    const request: ReferenceWorkflowRequest = {
      workflow: "patch-validation",
      input: fixture.bundle,
    };

    const initialSpec = buildReferenceHarnessSpec(request);
    const compiled = compileHarnessSpec(initialSpec);
    const adaptiveInput = prepareInitialAdaptiveInput(request, initialSpec, {});

    const result = await runCompiledWorkflow(
      compiled,
      adaptiveInput as any,
      {
        llmResult: { approved: true },
        humanResponse: { approved: true },
        maxContinuations: 1,
      },
    );

    expect(result.lineage).toBeDefined();
    expect(result.lineage).toHaveLength(1);

    const lineageEntry = result.lineage![0];
    expect(lineageEntry.version).toBe(1);
    expect(lineageEntry.terminalNodeId).toBe("validated-fix");
    expect(lineageEntry.outputs).toBeDefined();
    expect(lineageEntry.nodeResults).toBeDefined();
    expect(lineageEntry.metrics).toBeDefined();
    expect(lineageEntry.trace).toBeDefined();
    expect(lineageEntry.completedAt).toBeGreaterThan(0);
  });

  it("should work without adaptive envelope for custom specs", async () => {
    const fixture = createPatchValidationFixture();
    fixtures.push(fixture);

    const customSpec = {
      name: "simple-test",
      graph: {
        entryNodeId: "start",
        nodes: [
          {
            kind: "tool" as const,
            id: "start",
            label: "Start",
            tool: "bash",
            args: ["-c", "echo test"],
          },
        ],
        edges: [],
      },
    };

    const compiled = compileHarnessSpec(customSpec);

    const result = await runCompiledWorkflow(
      compiled,
      { repoPath: fixture.bundle.repoPath },
      {},
    );

    expect(result.status).toBe("completed");
    expect(result.adaptiveMetadata).toBeUndefined();
    expect(result.lineage).toBeUndefined();
  });
});
