import { describe, it, expect } from "vitest";
import {
  prepareInitialAdaptiveInput,
  unwrapAdaptiveInput,
  prepareRuntimeReplan,
  MAX_ADAPTIVE_VERSIONS,
} from "../../src/replanner/runtime.js";
import type { ReferenceWorkflowRequest } from "../../src/reference/catalog.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import type { CompiledHarnessResult } from "../../src/compiler/compile.js";
import { createInitialVersion } from "../../src/versioning/history.js";

describe("replanner/runtime", () => {
  const mockSpec: HarnessSpec = {
    name: "test-workflow",
    graph: {
      nodes: [
        {
          id: "start",
          label: "Start",
          task: {
            kind: "shell",
            tool: "bash",
            args: ["echo test"],
          },
        },
      ],
      edges: [],
    },
  };

  const mockRequest: ReferenceWorkflowRequest = {
    workflow: "patch-validation",
    input: {
      repoPath: "/test/repo",
      baselineRef: "main",
      candidateSource: { kind: "patchFile", value: "/test/patch.diff" },
      reproduceCommands: ["npm test -- broken.spec.ts"],
      verificationCommands: ["npm test"],
      reviewInstructions: "Review carefully",
      approvalRequired: false,
    },
  };

  describe("prepareInitialAdaptiveInput", () => {
    it("should wrap request with adaptive envelope", () => {
      const runtimeInput = { key: "value" };
      const wrapped = prepareInitialAdaptiveInput(mockRequest, mockSpec, runtimeInput);

      expect(wrapped.input).toEqual(runtimeInput);
      expect(wrapped.__lassoAdaptiveRuntime).toBeDefined();
      expect(wrapped.__lassoAdaptiveRuntime.currentRequest).toEqual(mockRequest);
      expect(wrapped.__lassoAdaptiveRuntime.currentVersion.version).toBe(1);
      expect(wrapped.__lassoAdaptiveRuntime.currentVersion.reason).toBe("initial");
      expect(wrapped.__lassoAdaptiveRuntime.currentVersion.spec).toEqual(mockSpec);
      expect(wrapped.__lassoAdaptiveRuntime.lineage).toEqual([]);
    });

    it("should preserve original runtime input", () => {
      const runtimeInput = { nested: { value: 42 } };
      const wrapped = prepareInitialAdaptiveInput(mockRequest, mockSpec, runtimeInput);

      expect(wrapped.input).toEqual(runtimeInput);
      expect(wrapped.input).not.toBe(runtimeInput);
    });
  });

  describe("unwrapAdaptiveInput", () => {
    it("should extract adaptive metadata when present", () => {
      const wrapped = prepareInitialAdaptiveInput(mockRequest, mockSpec, {});
      const unwrapped = unwrapAdaptiveInput(wrapped);

      expect(unwrapped.hasAdaptive).toBe(true);
      expect(unwrapped.input).toEqual({});
      expect(unwrapped.metadata?.currentRequest).toEqual(mockRequest);
      expect(unwrapped.metadata?.currentVersion.version).toBe(1);
    });

    it("should return null metadata for non-adaptive input", () => {
      const regularInput = { repoPath: "/test" };
      const unwrapped = unwrapAdaptiveInput(regularInput);

      expect(unwrapped.hasAdaptive).toBe(false);
      expect(unwrapped.input).toEqual(regularInput);
      expect(unwrapped.metadata).toBeNull();
    });
  });

  describe("prepareRuntimeReplan", () => {
    const mockResult: CompiledHarnessResult = {
      status: "completed",
      terminalNodeId: "validated-fix",
      result: { output: "test" },
      outputs: { start: { stdout: "test" } },
      trace: [],
      harnessState: {
        inputs: {},
        outputs: { start: { stdout: "test" } },
        nodeResults: { start: { stdout: "test" } },
        failures: [],
        metrics: { retries: 0, durationMs: 100 },
      },
    };

    it("should return continue_as_new when replanner returns draft_request", () => {
      const runtimeInput = { repoPath: "/test/repo", dryRun: true };
      const wrapped = prepareInitialAdaptiveInput(mockRequest, mockSpec, runtimeInput);
      const adaptive = unwrapAdaptiveInput(wrapped).metadata!;

      const decision = prepareRuntimeReplan(adaptive, runtimeInput, mockResult);

      expect(decision.decision).toBe("continue_as_new");
      if (decision.decision === "continue_as_new") {
        expect(decision.nextRequest.workflow).toBe("patch-validation");
        expect(decision.nextVersion.version).toBe(2);
        expect(decision.nextVersion.parentVersion).toBe(1);
        expect(decision.nextVersion.reason).toMatch(/escalation|risk/);
        expect(decision.nextInput.input).toEqual(runtimeInput);
        expect(decision.nextInput.__lassoAdaptiveRuntime).toBeDefined();
        expect(decision.nextInput.__lassoAdaptiveRuntime.currentVersion.version).toBe(2);
        expect(decision.nextInput.__lassoAdaptiveRuntime.currentRequest).toEqual(decision.nextRequest);
        expect(decision.nextInput.__lassoAdaptiveRuntime.lineage).toHaveLength(1);
        expect(decision.lineageEntry.version).toBe(1);
        expect(decision.lineageEntry.terminalNodeId).toBe("validated-fix");
      }
    });

    it("should return needs_operator_input when replanner requires input", () => {
      const abortedResult: CompiledHarnessResult = {
        ...mockResult,
        terminalNodeId: "apply-failed",
      };

      const wrapped = prepareInitialAdaptiveInput(mockRequest, mockSpec, {});
      const adaptive = unwrapAdaptiveInput(wrapped).metadata!;

      const decision = prepareRuntimeReplan(adaptive, {}, abortedResult);

      expect(decision.decision).toBe("needs_operator_input");
      if (decision.decision === "needs_operator_input") {
        expect(decision.lineageEntry.terminalNodeId).toBe("apply-failed");
        expect(decision.replanResult.status).toBe("needs_operator_input");
      }
    });

    it("should return stop when replanner says stop", () => {
      const rejectedResult: CompiledHarnessResult = {
        ...mockResult,
        terminalNodeId: "rejected",
      };

      const wrapped = prepareInitialAdaptiveInput(mockRequest, mockSpec, {});
      const adaptive = unwrapAdaptiveInput(wrapped).metadata!;

      const decision = prepareRuntimeReplan(adaptive, {}, rejectedResult);

      expect(decision.decision).toBe("stop");
      if (decision.decision === "stop") {
        expect(decision.lineageEntry.terminalNodeId).toBe("rejected");
        expect(decision.replanResult.status).toBe("stop");
      }
    });

    it("should enforce version cap", () => {
      let adaptive = unwrapAdaptiveInput(
        prepareInitialAdaptiveInput(mockRequest, mockSpec, {}),
      ).metadata!;

      // Force the current version to the cap so we directly exercise the
      // MAX_ADAPTIVE_VERSIONS stop branch instead of relying on repeated
      // replans which may stop earlier under the current runtime contract.
      adaptive.currentVersion.version = MAX_ADAPTIVE_VERSIONS;

      const finalDecision = prepareRuntimeReplan(adaptive, {}, mockResult);
      expect(finalDecision.decision).toBe("stop");
      if (finalDecision.decision === "stop") {
        expect(finalDecision.replanResult.status).toBe("stop");
        expect(finalDecision.replanResult.reasons).toContain("Max adaptive version limit reached");
      }
    });

    it("should carry lineage forward", () => {
      const wrapped = prepareInitialAdaptiveInput(mockRequest, mockSpec, {});
      let adaptive = unwrapAdaptiveInput(wrapped).metadata!;

      const decision1 = prepareRuntimeReplan(adaptive, {}, mockResult);
      expect(decision1.decision).toBe("continue_as_new");

      if (decision1.decision === "continue_as_new") {
        adaptive = unwrapAdaptiveInput(decision1.nextInput).metadata!;
        expect(adaptive.lineage).toHaveLength(1);
        expect(adaptive.lineage[0].version).toBe(1);
        expect(adaptive.currentRequest.input.approvalRequired).toBe(true);

        const decision2 = prepareRuntimeReplan(adaptive, {
          input: {},
          __lassoAdaptiveRuntime: adaptive,
        }.input, {
          ...mockResult,
          terminalNodeId: "validated-fix",
        });

        expect(decision2.decision).toBe("stop");
      }
    });
  });
});
