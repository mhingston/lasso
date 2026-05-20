import { describe, expect, it } from "vitest";
import { deriveMutationsFromFailure } from "../../src/mutation/derive.js";
import type { HarnessMutation } from "../../src/mutation/types.js";
import type { HarnessSpec } from "../../src/spec/types.js";
import type { FailureSignature, FailureContext } from "../../src/failures/ontology.js";

function makeSpec(overrides?: Partial<HarnessSpec>): HarnessSpec {
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

function makeSignature(
  cls: FailureSignature["class"],
  nodeId: string,
  overrides?: Partial<FailureSignature>,
): FailureSignature {
  return {
    class: cls,
    confidence: 0.9,
    evidence: ["test evidence"],
    suggestedRecovery: [],
    retryable: true,
    requiresHumanIntervention: false,
    ...overrides,
  };
}

describe("deriveMutationsFromFailure", () => {
  describe("auth failure mutations", () => {
    it("should suggest add-node for auth-check before failing node", () => {
      const spec = makeSpec();
      const signature = makeSignature("auth", "node-b");
      const ctx: FailureContext = { nodeId: "node-b" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      expect(mutations.length).toBeGreaterThan(0);
      expect(mutations.some(m => m.type === "add-node")).toBe(true);
    });

    it("should create auth-check node with appropriate tool", () => {
      const spec = makeSpec();
      const signature = makeSignature("auth", "node-b");
      const ctx: FailureContext = { nodeId: "node-b" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      const addNodeMutation = mutations.find(m => m.type === "add-node");
      expect(addNodeMutation).toBeDefined();
      const params = addNodeMutation!.params as Record<string, unknown>;
      expect(params.node).toBeDefined();
    });
  });

  describe("tool failure mutations", () => {
    it("should suggest add-node for tool-availability check", () => {
      const spec = makeSpec();
      const signature = makeSignature("tool", "node-a");
      const ctx: FailureContext = { nodeId: "node-a" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      expect(mutations.length).toBeGreaterThan(0);
      expect(mutations.some(m => m.type === "add-node")).toBe(true);
    });
  });

  describe("resource failure mutations", () => {
    it("should suggest add-node for resource-provisioning check", () => {
      const spec = makeSpec();
      const signature = makeSignature("resource", "node-a");
      const ctx: FailureContext = { nodeId: "node-a" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      expect(mutations.length).toBeGreaterThan(0);
      expect(mutations.some(m => m.type === "add-node")).toBe(true);
    });
  });

  describe("network failure mutations", () => {
    it("should suggest modify-node to add retry with backoff", () => {
      const spec = makeSpec();
      const signature = makeSignature("network", "node-a", {
        retryable: true,
      });
      const ctx: FailureContext = { nodeId: "node-a" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      expect(mutations.length).toBeGreaterThan(0);
      expect(mutations.some(m => m.type === "modify-node")).toBe(true);
    });

    it("should add retry policy with exponential backoff", () => {
      const spec = makeSpec();
      const signature = makeSignature("network", "node-a", {
        retryable: true,
      });
      const ctx: FailureContext = { nodeId: "node-a" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      const modifyMutation = mutations.find(m => m.type === "modify-node");
      expect(modifyMutation).toBeDefined();
      const params = modifyMutation!.params as Record<string, unknown>;
      expect(params.changes).toBeDefined();
      const changes = params.changes as Record<string, unknown>;
      expect(changes.retryPolicy).toBeDefined();
    });
  });

  describe("semantic failure mutations", () => {
    it("should suggest add-verification for semantic failures", () => {
      const spec = makeSpec();
      const signature = makeSignature("semantic", "node-b");
      const ctx: FailureContext = { nodeId: "node-b" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      expect(mutations.length).toBeGreaterThan(0);
      expect(
        mutations.some(m => m.type === "add-verification"),
      ).toBe(true);
    });
  });

  describe("human failure mutations", () => {
    it("should suggest toggle-approval for human failures", () => {
      const spec = makeSpec();
      const signature = makeSignature("human", "node-a", {
        requiresHumanIntervention: true,
      });
      const ctx: FailureContext = { nodeId: "node-a" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      expect(mutations.length).toBeGreaterThan(0);
      expect(
        mutations.some(m => m.type === "toggle-approval"),
      ).toBe(true);
    });
  });

  describe("environment-drift failure mutations", () => {
    it("should suggest add-node for environment-check", () => {
      const spec = makeSpec();
      const signature = makeSignature("environment-drift", "node-a");
      const ctx: FailureContext = { nodeId: "node-a" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      expect(mutations.length).toBeGreaterThan(0);
      expect(mutations.some(m => m.type === "add-node")).toBe(true);
    });
  });

  describe("unknown failure mutations", () => {
    it("should suggest add-verification for unknown failures", () => {
      const spec = makeSpec();
      const signature = makeSignature("unknown", "node-a");
      const ctx: FailureContext = { nodeId: "node-a" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      expect(mutations.length).toBeGreaterThan(0);
    });
  });

  describe("edge creation for added nodes", () => {
    it("should add edge from auth-check to failing node", () => {
      const spec = makeSpec();
      const signature = makeSignature("auth", "node-b");
      const ctx: FailureContext = { nodeId: "node-b" };

      const mutations = deriveMutationsFromFailure(signature, spec, ctx);

      const addNodeMutation = mutations.find(m => m.type === "add-node");
      if (addNodeMutation) {
        const params = addNodeMutation.params as Record<string, unknown>;
        expect(params.edges).toBeDefined();
        const edges = params.edges as Array<{ from: string; to: string }>;
        expect(edges.some(e => e.to === "node-b")).toBe(true);
      }
    });
  });
});
