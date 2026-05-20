import { describe, it, expect } from "vitest";
import { createInitialVersion, createNextVersion, createLineageEntry } from "../../src/versioning/history.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import type { CompiledHarnessResult } from "../../src/compiler/compile.js";

describe("versioning/history", () => {
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

  describe("createInitialVersion", () => {
    it("should create version 1 with no parent", () => {
      const version = createInitialVersion(mockSpec);

      expect(version.version).toBe(1);
      expect(version.parentVersion).toBeUndefined();
      expect(version.reason).toBe("initial");
      expect(version.spec).toEqual(mockSpec);
      expect(version.generatedAt).toBeGreaterThan(0);
    });

    it("should deep clone the spec", () => {
      const version = createInitialVersion(mockSpec);

      expect(version.spec).not.toBe(mockSpec);
      expect(version.spec).toEqual(mockSpec);
    });
  });

  describe("createNextVersion", () => {
    it("should increment version and set parent", () => {
      const initial = createInitialVersion(mockSpec);
      const next = createNextVersion(initial, mockSpec, "escalation");

      expect(next.version).toBe(2);
      expect(next.parentVersion).toBe(1);
      expect(next.reason).toBe("escalation");
      expect(next.spec).toEqual(mockSpec);
      expect(next.generatedAt).toBeGreaterThanOrEqual(initial.generatedAt);
    });

    it("should chain multiple versions", () => {
      const v1 = createInitialVersion(mockSpec);
      const v2 = createNextVersion(v1, mockSpec, "escalation");
      const v3 = createNextVersion(v2, mockSpec, "retry");

      expect(v3.version).toBe(3);
      expect(v3.parentVersion).toBe(2);
      expect(v3.reason).toBe("retry");
    });
  });

  describe("createLineageEntry", () => {
    it("should capture completed result data", () => {
      const mockResult: CompiledHarnessResult = {
        status: "completed",
        terminalNodeId: "success",
        result: { output: "test" },
        outputs: { start: { stdout: "test" } },
        trace: {
          entries: [
            {
              nodeId: "start",
              source: { kind: "user-task", nodeId: "start" },
              phase: "enter",
            },
          ],
          totalDurationMs: 100,
          nodeCount: 1,
          failureCount: 0,
          startTimeMs: Date.now() - 100,
          endTimeMs: Date.now(),
        },
        harnessState: {
          inputs: {},
          outputs: { start: { stdout: "test" } },
          nodeResults: { start: { stdout: "test" } },
          failures: [],
          metrics: {
            retries: 0,
            durationMs: 100,
          },
        },
      };

      const version = createInitialVersion(mockSpec);
      const lineage = createLineageEntry(version, mockResult);

      expect(lineage.version).toBe(1);
      expect(lineage.terminalNodeId).toBe("success");
      expect(lineage.outputs).toEqual({ start: { stdout: "test" } });
      expect(lineage.nodeResults).toEqual({ start: { stdout: "test" } });
      expect(lineage.failures).toEqual([]);
      expect(lineage.metrics).toEqual({ retries: 0, durationMs: 100 });
      expect(lineage.trace.entries).toHaveLength(1);
      expect(lineage.completedAt).toBeGreaterThan(0);
    });

    it("should deep clone result data", () => {
      const now = Date.now();
      const mockResult: CompiledHarnessResult = {
        status: "completed",
        terminalNodeId: "success",
        result: { output: "test" },
        outputs: { start: { stdout: "test" } },
        trace: {
          entries: [],
          totalDurationMs: 100,
          nodeCount: 0,
          failureCount: 0,
          startTimeMs: now - 100,
          endTimeMs: now,
        },
        harnessState: {
          inputs: {},
          outputs: { start: { stdout: "test" } },
          nodeResults: { start: { stdout: "test" } },
          failures: [],
          metrics: { retries: 0, durationMs: 100 },
        },
      };

      const version = createInitialVersion(mockSpec);
      const lineage = createLineageEntry(version, mockResult);

      expect(lineage.outputs).not.toBe(mockResult.outputs);
      expect(lineage.nodeResults).not.toBe(mockResult.harnessState.nodeResults);
    });
  });
});
