import { describe, it, expect } from "vitest";
import { extractPatternsFromTrace } from "../../src/memory/extractor.js";
import type { HarnessExecutionTrace } from "../../src/versioning/types.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import type { ExecutionTraceEntry } from "../../src/compiler/runtime-helpers.js";

function makeSpec(overrides?: Partial<HarnessSpec>): HarnessSpec {
  return {
    name: "test-harness",
    graph: {
      entryNodeId: "auth-check",
      nodes: [
        { id: "auth-check", kind: "tool" as const, tool: "bash", args: ["echo", "auth"] },
        { id: "deploy", kind: "tool" as const, tool: "bash", args: ["echo", "deploy"] },
        { id: "verify", kind: "tool" as const, tool: "bash", args: ["echo", "verify"] },
      ],
      edges: [
        { from: "auth-check", to: "deploy" },
        { from: "deploy", to: "verify" },
      ],
    },
    ...overrides,
  };
}

function makeTraceEntry(
  nodeId: string,
  phase: ExecutionTraceEntry["phase"],
  overrides?: Partial<ExecutionTraceEntry>,
): ExecutionTraceEntry {
  return {
    nodeId,
    source: { specNodeId: nodeId, specNodeKind: "tool", specPath: `graph.nodes[0]` },
    phase,
    ...overrides,
  };
}

function makeTrace(entries: ExecutionTraceEntry[], overrides?: Partial<HarnessExecutionTrace>): HarnessExecutionTrace {
  const failureCount = entries.filter(e => e.phase === "failure").length;
  return {
    entries,
    totalDurationMs: entries.length * 100,
    nodeCount: new Set(entries.map(e => e.nodeId)).size,
    failureCount,
    startTimeMs: 1000,
    endTimeMs: 1000 + entries.length * 100,
    ...overrides,
  };
}

describe("memory/extractPatternsFromTrace", () => {
  describe("successful pattern detection", () => {
    it("should identify nodes that always succeed", () => {
      const trace = makeTrace([
        makeTraceEntry("auth-check", "enter"),
        makeTraceEntry("auth-check", "success"),
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "success"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful.some(p => p.includes("auth-check"))).toBe(true);
      expect(successful.some(p => p.includes("deploy"))).toBe(true);
    });

    it("should identify ordering patterns (A before B succeeds)", () => {
      const trace = makeTrace([
        makeTraceEntry("auth-check", "enter"),
        makeTraceEntry("auth-check", "success"),
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "success"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful.some(p => p.includes("auth-check") && p.includes("deploy"))).toBe(true);
    });

    it("should identify verification-after-deploy pattern", () => {
      const trace = makeTrace([
        makeTraceEntry("auth-check", "enter"),
        makeTraceEntry("auth-check", "success"),
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "success"),
        makeTraceEntry("verify", "enter"),
        makeTraceEntry("verify", "success"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful.some(p => p.includes("deploy") && p.includes("verify"))).toBe(true);
    });
  });

  describe("failed pattern detection", () => {
    it("should identify nodes that fail", () => {
      const trace = makeTrace([
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "failure", { details: { message: "auth required" } }),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(failed.some(p => p.includes("deploy"))).toBe(true);
    });

    it("should identify A-before-B-fails pattern", () => {
      const trace = makeTrace([
        makeTraceEntry("auth-check", "enter"),
        makeTraceEntry("auth-check", "success"),
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "failure", { details: { message: "connection refused" } }),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(failed.some(p => p.includes("auth-check") && p.includes("deploy") && p.includes("fails"))).toBe(true);
    });

    it("should identify auth-check-prevents-failure when auth-check succeeds before deploy", () => {
      const trace = makeTrace([
        makeTraceEntry("auth-check", "enter"),
        makeTraceEntry("auth-check", "success"),
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "success"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful.some(p => p.includes("auth-check") && p.includes("before"))).toBe(true);
    });

    it("should identify retry patterns", () => {
      const trace = makeTrace([
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "failure"),
        makeTraceEntry("deploy", "retry"),
        makeTraceEntry("deploy", "success"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful.some(p => p.includes("retry"))).toBe(true);
    });

    it("should identify verification-fail patterns", () => {
      const trace = makeTrace([
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "success"),
        makeTraceEntry("verify", "enter"),
        makeTraceEntry("verify", "verification-fail"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(failed.some(p => p.includes("verify"))).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should return empty arrays for empty trace", () => {
      const trace = makeTrace([]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful).toEqual([]);
      expect(failed).toEqual([]);
    });

    it("should handle trace with only enter phases", () => {
      const trace = makeTrace([
        makeTraceEntry("auth-check", "enter"),
        makeTraceEntry("deploy", "enter"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful).toEqual([]);
      expect(failed).toEqual([]);
    });

    it("should handle multiple failures of same node", () => {
      const trace = makeTrace([
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "failure"),
        makeTraceEntry("deploy", "retry"),
        makeTraceEntry("deploy", "failure"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(failed.some(p => p.includes("deploy"))).toBe(true);
    });

    it("should handle condition branching patterns", () => {
      const trace = makeTrace([
        makeTraceEntry("check", "enter"),
        makeTraceEntry("check", "success"),
        makeTraceEntry("check", "condition-true"),
        makeTraceEntry("branch-a", "enter"),
        makeTraceEntry("branch-a", "success"),
      ]);
      const spec = makeSpec({
        name: "conditional-harness",
        graph: {
          entryNodeId: "check",
          nodes: [
            { id: "check", kind: "condition" as const, condition: "true", thenNodeId: "branch-a", elseNodeId: "branch-b" },
            { id: "branch-a", kind: "tool" as const, tool: "bash", args: ["echo", "a"] },
            { id: "branch-b", kind: "tool" as const, tool: "bash", args: ["echo", "b"] },
          ],
          edges: [],
        },
      });

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful.some(p => p.includes("check") && p.includes("branch-a"))).toBe(true);
    });

    it("should handle merge patterns", () => {
      const trace = makeTrace([
        makeTraceEntry("branch-a", "enter"),
        makeTraceEntry("branch-a", "success"),
        makeTraceEntry("branch-b", "enter"),
        makeTraceEntry("branch-b", "success"),
        makeTraceEntry("merge", "enter"),
        makeTraceEntry("merge", "merge"),
        makeTraceEntry("merge", "success"),
      ]);
      const spec = makeSpec({
        name: "merge-harness",
        graph: {
          entryNodeId: "branch-a",
          nodes: [
            { id: "branch-a", kind: "tool" as const, tool: "bash", args: ["echo", "a"] },
            { id: "branch-b", kind: "tool" as const, tool: "bash", args: ["echo", "b"] },
            { id: "merge", kind: "merge" as const, waitFor: ["branch-a", "branch-b"] },
          ],
          edges: [
            { from: "branch-a", to: "merge" },
            { from: "branch-b", to: "merge" },
          ],
        },
      });

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful.some(p => p.includes("merge"))).toBe(true);
    });
  });

  describe("pattern naming conventions", () => {
    it("should use kebab-case for pattern names", () => {
      const trace = makeTrace([
        makeTraceEntry("auth-check", "enter"),
        makeTraceEntry("auth-check", "success"),
        makeTraceEntry("deploy", "enter"),
        makeTraceEntry("deploy", "success"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      for (const pattern of successful) {
        expect(pattern).toMatch(/^[a-z0-9-]+$/);
      }
    });

    it("should include node IDs in pattern names", () => {
      const trace = makeTrace([
        makeTraceEntry("auth-check", "enter"),
        makeTraceEntry("auth-check", "success"),
      ]);
      const spec = makeSpec();

      const { successful, failed } = extractPatternsFromTrace(trace, spec);

      expect(successful.some(p => p.includes("auth-check"))).toBe(true);
    });
  });
});
