import { describe, expect, it } from "vitest";
import type { HarnessState } from "../../src/state/types.js";
import { createHarnessState, addFailure, recordNodeResult, updateMetrics, captureSnapshot } from "../../src/state/snapshots.js";
import type { FailureRecord } from "../../src/failures/types.js";

describe("State snapshots", () => {
  describe("HarnessState type", () => {
    it("should represent complete harness execution state", () => {
      const state: HarnessState = {
        inputs: { prNumber: 42 },
        outputs: { patchApplied: true },
        nodeResults: {
          "fetch-pr": { data: "..." },
          "apply-patch": { success: true },
        },
        failures: [
          {
            domainType: "pr-review",
            rootCause: "tool_timeout",
            nodeId: "apply-patch",
            message: "Timeout on first attempt",
          },
        ],
        metrics: {
          retries: 1,
          durationMs: 5000,
        },
      };

      expect(state.inputs).toEqual({ prNumber: 42 });
      expect(state.outputs).toEqual({ patchApplied: true });
      expect(state.nodeResults["fetch-pr"]).toEqual({ data: "..." });
      expect(state.failures).toHaveLength(1);
      expect(state.metrics.retries).toBe(1);
      expect(state.metrics.durationMs).toBe(5000);
    });
  });

  describe("createHarnessState", () => {
    it("should initialize empty harness state", () => {
      const state = createHarnessState({ userId: 123 });

      expect(state.inputs).toEqual({ userId: 123 });
      expect(state.outputs).toEqual({});
      expect(state.nodeResults).toEqual({});
      expect(state.failures).toEqual([]);
      expect(state.metrics.retries).toBe(0);
      expect(state.metrics.durationMs).toBe(0);
    });

    it("should initialize with empty input", () => {
      const state = createHarnessState(undefined);

      expect(state.inputs).toEqual({});
      expect(state.outputs).toEqual({});
      expect(state.nodeResults).toEqual({});
      expect(state.failures).toEqual([]);
      expect(state.metrics.retries).toBe(0);
      expect(state.metrics.durationMs).toBe(0);
    });
  });

  describe("addFailure", () => {
    it("should append failure to state", () => {
      const state = createHarnessState({ test: true });
      const failure: FailureRecord = {
        domainType: "test",
        rootCause: "tool_timeout",
        nodeId: "node-1",
        message: "Timeout",
      };

      addFailure(state, failure);

      expect(state.failures).toHaveLength(1);
      expect(state.failures[0]).toEqual(failure);
    });

    it("should support multiple failures", () => {
      const state = createHarnessState({});
      const failure1: FailureRecord = {
        domainType: "test",
        rootCause: "tool_timeout",
        message: "First",
      };
      const failure2: FailureRecord = {
        domainType: "test",
        rootCause: "rate_limited",
        message: "Second",
      };

      addFailure(state, failure1);
      addFailure(state, failure2);

      expect(state.failures).toHaveLength(2);
      expect(state.failures[0]).toEqual(failure1);
      expect(state.failures[1]).toEqual(failure2);
    });
  });

  describe("recordNodeResult", () => {
    it("should record node execution result", () => {
      const state = createHarnessState({});
      const result = { status: "success", data: 42 };

      recordNodeResult(state, "compute-node", result);

      expect(state.nodeResults["compute-node"]).toEqual(result);
    });

    it("should overwrite previous result for same node", () => {
      const state = createHarnessState({});

      recordNodeResult(state, "retry-node", { attempt: 1, failed: true });
      recordNodeResult(state, "retry-node", { attempt: 2, succeeded: true });

      expect(state.nodeResults["retry-node"]).toEqual({ attempt: 2, succeeded: true });
    });
  });

  describe("updateMetrics", () => {
    it("should update retry count", () => {
      const state = createHarnessState({});

      updateMetrics(state, { retries: 3 });

      expect(state.metrics.retries).toBe(3);
      expect(state.metrics.durationMs).toBe(0);
    });

    it("should update duration", () => {
      const state = createHarnessState({});

      updateMetrics(state, { durationMs: 1234 });

      expect(state.metrics.retries).toBe(0);
      expect(state.metrics.durationMs).toBe(1234);
    });

    it("should update both metrics", () => {
      const state = createHarnessState({});

      updateMetrics(state, { retries: 2, durationMs: 5678 });

      expect(state.metrics.retries).toBe(2);
      expect(state.metrics.durationMs).toBe(5678);
    });

    it("should increment metrics when called multiple times", () => {
      const state = createHarnessState({});

      updateMetrics(state, { retries: 1 });
      updateMetrics(state, { retries: 2 });

      expect(state.metrics.retries).toBe(2);
    });
  });

  describe("captureSnapshot", () => {
    it("should return immutable snapshot of current state", () => {
      const state = createHarnessState({ input: "test" });
      recordNodeResult(state, "node-1", { value: 1 });
      addFailure(state, {
        domainType: "test",
        rootCause: "unknown",
        message: "Error",
      });
      updateMetrics(state, { retries: 1, durationMs: 100 });

      const snapshot = captureSnapshot(state);

      expect(snapshot.inputs).toEqual({ input: "test" });
      expect(snapshot.nodeResults).toEqual({ "node-1": { value: 1 } });
      expect(snapshot.failures).toHaveLength(1);
      expect(snapshot.metrics.retries).toBe(1);
      expect(snapshot.metrics.durationMs).toBe(100);
    });

    it("should be independent from original state", () => {
      const state = createHarnessState({ x: 1 });
      const snapshot = captureSnapshot(state);

      recordNodeResult(state, "node-2", { value: 2 });
      addFailure(state, {
        domainType: "test",
        rootCause: "unknown",
        message: "New failure",
      });

      expect(snapshot.nodeResults).toEqual({});
      expect(snapshot.failures).toHaveLength(0);
      expect(state.nodeResults["node-2"]).toEqual({ value: 2 });
      expect(state.failures).toHaveLength(1);
    });
  });
});
