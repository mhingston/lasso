import { describe, expect, it } from "vitest";
import { DefaultMetaHarness } from "../../src/metaharness/engine.js";
import type {
  ExecutionTrace,
  CompletedNode,
  FailedNode,
  MetaHarnessConfig,
} from "../../src/metaharness/types.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import type { EnvironmentModel } from "../../src/environment/types.js";

function makeMinimalSpec(overrides?: Partial<HarnessSpec>): HarnessSpec {
  return {
    name: "test-harness",
    graph: {
      entryNodeId: "node-a",
      nodes: [
        {
          id: "node-a",
          label: "Node A",
          kind: "tool",
          tool: "bash",
          args: ["echo hello"],
        },
        {
          id: "node-b",
          label: "Node B",
          kind: "tool",
          tool: "bash",
          args: ["echo world"],
        },
      ],
      edges: [{ from: "node-a", to: "node-b" }],
    },
    ...overrides,
  };
}

function makeMinimalEnv(overrides?: Partial<EnvironmentModel>): EnvironmentModel {
  return {
    tools: [
      { name: "bash", version: "5.0", available: true },
      { name: "git", version: "2.39", available: true },
    ],
    resources: [
      { name: "disk", type: "disk", available: true, limit: "500GB", usage: "45%" },
    ],
    constraints: [],
    authState: [],
    externalSystems: [],
    discoveredAt: Date.now(),
    ...overrides,
  };
}

function makeCompletedNode(overrides: Partial<CompletedNode>): CompletedNode {
  return {
    nodeId: "node-a",
    startedAt: Date.now() - 1000,
    completedAt: Date.now(),
    output: "ok",
    ...overrides,
  };
}

function makeFailedNode(overrides: Partial<FailedNode>): FailedNode {
  return {
    nodeId: "node-a",
    startedAt: Date.now() - 1000,
    failedAt: Date.now(),
    error: "command not found",
    retryCount: 0,
    ...overrides,
  };
}

function makeTrace(overrides?: Partial<ExecutionTrace>): ExecutionTrace {
  return {
    completedNodes: [],
    failedNodes: [],
    capturedAt: Date.now(),
    ...overrides,
  };
}

describe("synthesizeFromTrace", () => {
  const harness = new DefaultMetaHarness({});
  const env = makeMinimalEnv();
  const spec = makeMinimalSpec();

  describe("empty trace", () => {
    it("returns spec unchanged with no mutations when trace is empty", async () => {
      const trace = makeTrace();
      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.mutations).toHaveLength(0);
      expect(result.spec).toEqual(spec);
      expect(result.rationale).toHaveLength(0);
      expect(result.decision).toBe("continue");
    });
  });

  describe("completed nodes only", () => {
    it("returns continue decision when all nodes completed successfully", async () => {
      const trace = makeTrace({
        completedNodes: [
          makeCompletedNode({ nodeId: "node-a" }),
          makeCompletedNode({ nodeId: "node-b" }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.decision).toBe("continue");
      expect(result.mutations).toHaveLength(0);
      expect(result.rationale).toHaveLength(0);
    });
  });

  describe("failure analysis", () => {
    it("classifies failures and derives mutations for tool failures", async () => {
      const trace = makeTrace({
        failedNodes: [
          makeFailedNode({
            nodeId: "node-a",
            error: "bash: command not found: kubectl",
            retryCount: 0,
          }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.mutations.length).toBeGreaterThan(0);
      expect(result.rationale.length).toBeGreaterThan(0);
    });

    it("adds retry policy for transient network failures", async () => {
      const trace = makeTrace({
        failedNodes: [
          makeFailedNode({
            nodeId: "node-a",
            error: "ETIMEDOUT connection timeout",
            retryCount: 0,
          }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      const retryMutations = result.mutations.filter(m => m.type === "modify-node");
      expect(retryMutations.length).toBeGreaterThan(0);
    });

    it("detects repeated failures on same node", async () => {
      const trace = makeTrace({
        failedNodes: [
          makeFailedNode({
            nodeId: "node-a",
            error: "connection refused",
            retryCount: 2,
            failedAt: Date.now() - 2000,
          }),
          makeFailedNode({
            nodeId: "node-a",
            error: "connection refused",
            retryCount: 3,
            failedAt: Date.now(),
          }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.rationale.some(r => r.includes("repeated") || r.includes("node-a"))).toBe(true);
    });

    it("detects slow nodes", async () => {
      const now = Date.now();
      const trace = makeTrace({
        completedNodes: [
          makeCompletedNode({
            nodeId: "node-a",
            startedAt: now - 60000,
            completedAt: now,
          }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.rationale.some(r => r.includes("slow") || r.includes("duration"))).toBe(true);
    });

    it("detects cost spikes", async () => {
      const trace = makeTrace({
        completedNodes: [
          makeCompletedNode({ nodeId: "node-a", costUsd: 5.0 }),
          makeCompletedNode({ nodeId: "node-b", costUsd: 3.0 }),
        ],
        totalCostUsd: 8.0,
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.rationale.some(r => r.includes("cost") || r.includes("budget"))).toBe(true);
    });
  });

  describe("decision logic", () => {
    it("returns stop when all nodes failed", async () => {
      const trace = makeTrace({
        failedNodes: [
          makeFailedNode({ nodeId: "node-a", error: "auth required" }),
          makeFailedNode({ nodeId: "node-b", error: "auth required" }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.decision).toBe("stop");
    });

    it("returns needs_operator_input for human-required failures", async () => {
      const trace = makeTrace({
        failedNodes: [
          makeFailedNode({
            nodeId: "node-a",
            error: "approval required by operator",
            retryCount: 0,
          }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.decision).toBe("needs_operator_input");
    });

    it("returns continue when failures are recoverable", async () => {
      const trace = makeTrace({
        completedNodes: [
          makeCompletedNode({ nodeId: "node-a" }),
        ],
        failedNodes: [
          makeFailedNode({
            nodeId: "node-b",
            error: "ETIMEDOUT",
            retryCount: 0,
          }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.decision).toBe("continue");
    });
  });

  describe("mutation application", () => {
    it("applies mutations to spec and returns updated spec", async () => {
      const trace = makeTrace({
        failedNodes: [
          makeFailedNode({
            nodeId: "node-a",
            error: "connection timeout",
            retryCount: 0,
          }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.spec).not.toEqual(spec);
      expect(result.spec.graph.nodes.length).toBeGreaterThanOrEqual(spec.graph.nodes.length);
    });

    it("does not mutate original spec", async () => {
      const originalSpec = makeMinimalSpec();
      const trace = makeTrace({
        failedNodes: [
          makeFailedNode({ nodeId: "node-a", error: "timeout" }),
        ],
      });

      await harness.synthesizeFromTrace(trace, originalSpec, env);

      expect(originalSpec.graph.nodes.length).toBe(2);
    });
  });

  describe("mutation policy enforcement", () => {
    it("respects mutation policy when provided", async () => {
      const config: MetaHarnessConfig = {
        mutationPolicy: {
          allowedMutations: ["modify-node"],
          maxMutations: 1,
        },
      };
      const harnessWithPolicy = new DefaultMetaHarness(config);
      const trace = makeTrace({
        failedNodes: [
          makeFailedNode({
            nodeId: "node-a",
            error: "ETIMEDOUT connection timeout",
            retryCount: 0,
          }),
          makeFailedNode({
            nodeId: "node-b",
            error: "ETIMEDOUT connection timeout",
            retryCount: 0,
          }),
        ],
      });

      const result = await harnessWithPolicy.synthesizeFromTrace(trace, spec, env);

      expect(result.mutations.length).toBeLessThanOrEqual(1);
    });
  });

  describe("multiple failure patterns", () => {
    it("handles mixed completed and failed nodes", async () => {
      const trace = makeTrace({
        completedNodes: [
          makeCompletedNode({ nodeId: "node-a", costUsd: 0.5 }),
        ],
        failedNodes: [
          makeFailedNode({
            nodeId: "node-b",
            error: "permission denied",
            retryCount: 2,
          }),
        ],
        totalCostUsd: 0.5,
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.mutations.length).toBeGreaterThan(0);
      expect(result.rationale.length).toBeGreaterThan(0);
      expect(["continue", "needs_operator_input", "stop"]).toContain(result.decision);
    });

    it("derives trace-based mutations when entries are populated via adapter", async () => {
      const trace = makeTrace({
        failedNodes: [
          makeFailedNode({
            nodeId: "node-a",
            error: "connection refused",
            retryCount: 3,
          }),
          makeFailedNode({
            nodeId: "node-a",
            error: "connection refused",
            retryCount: 4,
          }),
          makeFailedNode({
            nodeId: "node-a",
            error: "connection refused",
            retryCount: 5,
          }),
        ],
      });

      const result = await harness.synthesizeFromTrace(trace, spec, env);

      expect(result.rationale.some(r => r.includes("trace"))).toBe(true);
      expect(result.mutations.length).toBeGreaterThan(0);
    });
  });
});
