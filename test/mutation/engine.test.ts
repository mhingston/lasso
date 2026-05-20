import { describe, it, expect } from "vitest";
import { mutateHarness } from "../../src/mutation/engine.js";
import { diffSpecs } from "../../src/mutation/diff.js";
import { deriveMutationsFromTrace } from "../../src/mutation/derive.js";
import type {
  HarnessMutation,
  MutationPolicy,
  SpecDiff,
} from "../../src/mutation/types.js";
import type { HarnessSpec, TaskNode, TaskEdge } from "../../src/spec/types.js";
import type { HarnessExecutionTrace } from "../../src/versioning/types.js";
import type { ExecutionTraceEntry } from "../../src/compiler/runtime-helpers.js";

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
        {
          id: "node-c",
          label: "Node C",
          kind: "llm",
          provider: "openai",
          model: "gpt-4",
          prompt: "Summarize results",
        },
      ],
      edges: [
        { from: "node-a", to: "node-b" },
        { from: "node-b", to: "node-c" },
      ],
    },
    humanPolicy: {
      defaultTimeout: 300,
      allowAsync: false,
    },
    ...overrides,
  };
}

function makeTrace(
  entries: ExecutionTraceEntry[],
  overrides?: Partial<HarnessExecutionTrace>,
): HarnessExecutionTrace {
  return {
    entries,
    totalDurationMs: 1000,
    nodeCount: entries.length,
    failureCount: entries.filter((e) => e.phase === "failure").length,
    startTimeMs: Date.now() - 1000,
    endTimeMs: Date.now(),
    ...overrides,
  };
}

describe("mutation/engine", () => {
  describe("mutateHarness", () => {
    describe("add-node", () => {
      it("should insert a new node and its edges", () => {
        const spec = makeSpec();
        const newNode: TaskNode = {
          id: "node-d",
          label: "Node D",
          kind: "tool",
          tool: "bash",
          args: ["echo added"],
        };
        const mutations: HarnessMutation[] = [
          {
            type: "add-node",
            params: {
              node: newNode,
              edges: [
                { from: "node-b", to: "node-d" },
                { from: "node-d", to: "node-c" },
              ],
            },
          },
        ];

        const result = mutateHarness(spec, mutations);

        expect(result.spec.graph.nodes).toHaveLength(4);
        expect(result.spec.graph.nodes.find((n) => n.id === "node-d")).toEqual(newNode);
        expect(result.spec.graph.edges).toHaveLength(4);
        expect(result.spec.graph.edges).toContainEqual({ from: "node-b", to: "node-d" });
        expect(result.spec.graph.edges).toContainEqual({ from: "node-d", to: "node-c" });
        expect(result.diff.addedNodes).toContain("node-d");
        expect(result.diff.addedEdges).toContainEqual({ from: "node-b", to: "node-d" });
        expect(result.diff.addedEdges).toContainEqual({ from: "node-d", to: "node-c" });
      });

      it("should add node without edges", () => {
        const spec = makeSpec();
        const newNode: TaskNode = {
          id: "isolated",
          kind: "tool",
          tool: "bash",
          args: ["echo isolated"],
        };
        const mutations: HarnessMutation[] = [
          { type: "add-node", params: { node: newNode } },
        ];

        const result = mutateHarness(spec, mutations);

        expect(result.spec.graph.nodes).toHaveLength(4);
        expect(result.spec.graph.edges).toHaveLength(2);
        expect(result.diff.addedNodes).toContain("isolated");
      });

      it("should throw if node ID already exists", () => {
        const spec = makeSpec();
        const duplicate: TaskNode = {
          id: "node-a",
          kind: "tool",
          tool: "bash",
          args: ["echo dup"],
        };
        const mutations: HarnessMutation[] = [
          { type: "add-node", params: { node: duplicate } },
        ];

        expect(() => mutateHarness(spec, mutations)).toThrow("already exists");
      });
    });

    describe("remove-node", () => {
      it("should remove a node and its edges", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          { type: "remove-node", params: { nodeId: "node-b" } },
        ];

        const result = mutateHarness(spec, mutations);

        expect(result.spec.graph.nodes).toHaveLength(2);
        expect(result.spec.graph.nodes.find((n) => n.id === "node-b")).toBeUndefined();
        expect(result.spec.graph.edges).toHaveLength(1);
        expect(result.spec.graph.edges).toContainEqual({ from: "node-a", to: "node-c" });
        expect(result.diff.removedNodes).toContain("node-b");
        expect(result.diff.removedEdges).toContainEqual({ from: "node-a", to: "node-b" });
        expect(result.diff.removedEdges).toContainEqual({ from: "node-b", to: "node-c" });
        expect(result.diff.addedEdges).toContainEqual({ from: "node-a", to: "node-c" });
      });

      it("should update entryNodeId if removing the entry node", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          { type: "remove-node", params: { nodeId: "node-a" } },
        ];

        const result = mutateHarness(spec, mutations);

        expect(result.spec.graph.entryNodeId).toBe("node-b");
        expect(result.spec.graph.nodes).toHaveLength(2);
      });

      it("should throw if node does not exist", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          { type: "remove-node", params: { nodeId: "nonexistent" } },
        ];

        expect(() => mutateHarness(spec, mutations)).toThrow("not found");
      });

      it("should remove outgoing edges only when node has no incoming", () => {
        const spec = makeSpec({
          graph: {
            entryNodeId: "a",
            nodes: [
              { id: "a", kind: "tool", tool: "bash", args: ["a"] },
              { id: "b", kind: "tool", tool: "bash", args: ["b"] },
              { id: "c", kind: "tool", tool: "bash", args: ["c"] },
            ],
            edges: [
              { from: "a", to: "b" },
              { from: "b", to: "c" },
            ],
          },
        });
        const mutations: HarnessMutation[] = [
          { type: "remove-node", params: { nodeId: "a" } },
        ];

        const result = mutateHarness(spec, mutations);

        expect(result.spec.graph.nodes).toHaveLength(2);
        expect(result.spec.graph.edges).toHaveLength(1);
        expect(result.spec.graph.edges).toContainEqual({ from: "b", to: "c" });
      });
    });

    describe("modify-node", () => {
      it("should change node properties", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          {
            type: "modify-node",
            params: {
              nodeId: "node-c",
              changes: {
                prompt: "Updated prompt",
                model: "gpt-4o",
              },
            },
          },
        ];

        const result = mutateHarness(spec, mutations);

        const modified = result.spec.graph.nodes.find(
          (n) => n.id === "node-c",
        ) as Extract<TaskNode, { kind: "llm" }>;
        expect(modified.prompt).toBe("Updated prompt");
        expect(modified.model).toBe("gpt-4o");
        expect(result.diff.modifiedNodes).toContain("node-c");
      });

      it("should throw if target node not found", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          {
            type: "modify-node",
            params: { nodeId: "nonexistent", changes: { label: "x" } },
          },
        ];

        expect(() => mutateHarness(spec, mutations)).toThrow("not found");
      });

      it("should not allow changing node id or kind", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          {
            type: "modify-node",
            params: {
              nodeId: "node-a",
              changes: { id: "new-id", kind: "llm" },
            },
          },
        ];

        const result = mutateHarness(spec, mutations);
        const node = result.spec.graph.nodes.find((n) => n.id === "node-a");
        expect(node?.kind).toBe("tool");
      });
    });

    describe("add-edge", () => {
      it("should add a transition between two nodes", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          {
            type: "add-edge",
            params: { edge: { from: "node-a", to: "node-c" } },
          },
        ];

        const result = mutateHarness(spec, mutations);

        expect(result.spec.graph.edges).toHaveLength(3);
        expect(result.spec.graph.edges).toContainEqual({ from: "node-a", to: "node-c" });
        expect(result.diff.addedEdges).toContainEqual({ from: "node-a", to: "node-c" });
      });

      it("should throw if edge already exists", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          {
            type: "add-edge",
            params: { edge: { from: "node-a", to: "node-b" } },
          },
        ];

        expect(() => mutateHarness(spec, mutations)).toThrow("already exists");
      });

      it("should throw if source node does not exist", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          {
            type: "add-edge",
            params: { edge: { from: "nonexistent", to: "node-b" } },
          },
        ];

        expect(() => mutateHarness(spec, mutations)).toThrow("not found");
      });

      it("should throw if target node does not exist", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          {
            type: "add-edge",
            params: { edge: { from: "node-a", to: "nonexistent" } },
          },
        ];

        expect(() => mutateHarness(spec, mutations)).toThrow("not found");
      });
    });

    describe("toggle-approval", () => {
      it("should flip approvalRequired on the spec", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          { type: "toggle-approval", params: {} },
        ];

        const result = mutateHarness(spec, mutations);

        expect(result.spec.humanPolicy).toBeDefined();
      });

      it("should set explicit approval value", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          { type: "toggle-approval", params: { approvalRequired: true } },
        ];

        const result = mutateHarness(spec, mutations);

        expect(result.spec.humanPolicy).toBeDefined();
      });

      it("should create humanPolicy if missing", () => {
        const spec = makeSpec({ humanPolicy: undefined });
        const mutations: HarnessMutation[] = [
          { type: "toggle-approval", params: { approvalRequired: true } },
        ];

        const result = mutateHarness(spec, mutations);

        expect(result.spec.humanPolicy).toBeDefined();
      });
    });

    describe("add-verification", () => {
      it("should add verification policy to a node", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          {
            type: "add-verification",
            params: {
              nodeId: "node-b",
              verificationPolicy: {
                rules: [
                  {
                    kind: "tool",
                    checkNodeId: "verify-check",
                    onFail: "block",
                  },
                ],
              },
            },
          },
        ];

        const result = mutateHarness(spec, mutations);

        const node = result.spec.graph.nodes.find((n) => n.id === "node-b");
        expect(node?.verificationPolicy).toBeDefined();
        expect(node?.verificationPolicy?.rules).toHaveLength(1);
        expect(node?.verificationPolicy?.rules[0].kind).toBe("tool");
        expect(result.diff.modifiedNodes).toContain("node-b");
      });

      it("should throw if target node not found", () => {
        const spec = makeSpec();
        const mutations: HarnessMutation[] = [
          {
            type: "add-verification",
            params: {
              nodeId: "nonexistent",
              verificationPolicy: { rules: [] },
            },
          },
        ];

        expect(() => mutateHarness(spec, mutations)).toThrow("not found");
      });
    });

    describe("policy enforcement", () => {
      it("should reject mutations not in allowedMutations", () => {
        const spec = makeSpec();
        const policy: MutationPolicy = {
          allowedMutations: ["modify-node"],
          maxMutations: 10,
        };
        const mutations: HarnessMutation[] = [
          { type: "add-node", params: { node: { id: "x", kind: "tool", tool: "bash", args: [] } } },
        ];

        expect(() => mutateHarness(spec, mutations, policy)).toThrow("not allowed");
      });

      it("should reject when exceeding maxMutations", () => {
        const spec = makeSpec();
        const policy: MutationPolicy = {
          allowedMutations: ["add-node", "modify-node", "add-edge", "remove-node", "toggle-approval", "add-verification"],
          maxMutations: 1,
        };
        const mutations: HarnessMutation[] = [
          { type: "modify-node", params: { nodeId: "node-a", changes: { label: "X" } } },
          { type: "modify-node", params: { nodeId: "node-b", changes: { label: "Y" } } },
        ];

        expect(() => mutateHarness(spec, mutations, policy)).toThrow("exceeds maximum");
      });

      it("should allow mutations within policy limits", () => {
        const spec = makeSpec();
        const policy: MutationPolicy = {
          allowedMutations: ["modify-node"],
          maxMutations: 2,
        };
        const mutations: HarnessMutation[] = [
          { type: "modify-node", params: { nodeId: "node-a", changes: { label: "X" } } },
        ];

        const result = mutateHarness(spec, mutations, policy);
        expect(result.mutations).toHaveLength(1);
      });
    });
  });

  describe("diffSpecs", () => {
    it("should detect added nodes", () => {
      const before = makeSpec();
      const after = makeSpec({
        graph: {
          ...makeSpec().graph,
          nodes: [
            ...makeSpec().graph.nodes,
            { id: "node-d", kind: "tool", tool: "bash", args: ["echo d"] },
          ],
        },
      });

      const diff = diffSpecs(before, after);

      expect(diff.addedNodes).toContain("node-d");
      expect(diff.removedNodes).toHaveLength(0);
    });

    it("should detect removed nodes", () => {
      const before = makeSpec();
      const after = makeSpec({
        graph: {
          ...makeSpec().graph,
          nodes: makeSpec().graph.nodes.filter((n) => n.id !== "node-c"),
          edges: makeSpec().graph.edges.filter((e) => e.to !== "node-c" && e.from !== "node-c"),
        },
      });

      const diff = diffSpecs(before, after);

      expect(diff.removedNodes).toContain("node-c");
    });

    it("should detect modified nodes", () => {
      const before = makeSpec();
      const modifiedNodes = [...makeSpec().graph.nodes];
      modifiedNodes[2] = { ...modifiedNodes[2], label: "Changed" };
      const after = makeSpec({
        graph: { ...makeSpec().graph, nodes: modifiedNodes },
      });

      const diff = diffSpecs(before, after);

      expect(diff.modifiedNodes).toContain("node-c");
    });

    it("should detect added edges", () => {
      const before = makeSpec();
      const after = makeSpec({
        graph: {
          ...makeSpec().graph,
          edges: [...makeSpec().graph.edges, { from: "node-a", to: "node-c" }],
        },
      });

      const diff = diffSpecs(before, after);

      expect(diff.addedEdges).toContainEqual({ from: "node-a", to: "node-c" });
    });

    it("should detect removed edges", () => {
      const before = makeSpec();
      const after = makeSpec({
        graph: {
          ...makeSpec().graph,
          edges: makeSpec().graph.edges.filter(
            (e) => !(e.from === "node-a" && e.to === "node-b"),
          ),
        },
      });

      const diff = diffSpecs(before, after);

      expect(diff.removedEdges).toContainEqual({ from: "node-a", to: "node-b" });
    });

    it("should return empty diff for identical specs", () => {
      const spec = makeSpec();
      const diff = diffSpecs(spec, spec);

      expect(diff.addedNodes).toHaveLength(0);
      expect(diff.removedNodes).toHaveLength(0);
      expect(diff.modifiedNodes).toHaveLength(0);
      expect(diff.addedEdges).toHaveLength(0);
      expect(diff.removedEdges).toHaveLength(0);
    });
  });

  describe("deriveMutationsFromTrace", () => {
    it("should suggest add-verification after repeated failures on same node", () => {
      const spec = makeSpec();
      const entries: ExecutionTraceEntry[] = [
        { nodeId: "node-b", source: "task", phase: "enter" },
        { nodeId: "node-b", source: "task", phase: "failure", details: { message: "fail 1" } },
        { nodeId: "node-b", source: "task", phase: "enter" },
        { nodeId: "node-b", source: "task", phase: "failure", details: { message: "fail 2" } },
        { nodeId: "node-b", source: "task", phase: "enter" },
        { nodeId: "node-b", source: "task", phase: "failure", details: { message: "fail 3" } },
      ];
      const trace = makeTrace(entries);

      const mutations = deriveMutationsFromTrace(trace, spec);

      expect(mutations.length).toBeGreaterThanOrEqual(1);
      expect(mutations.some((m) => m.type === "add-verification")).toBe(true);
    });

    it("should suggest add-node for retry when failures are transient", () => {
      const spec = makeSpec();
      const entries: ExecutionTraceEntry[] = [
        { nodeId: "node-a", source: "task", phase: "enter" },
        {
          nodeId: "node-a",
          source: "task",
          phase: "failure",
          details: { category: "transient", message: "timeout" },
        },
        { nodeId: "node-a", source: "task", phase: "enter" },
        {
          nodeId: "node-a",
          source: "task",
          phase: "failure",
          details: { category: "transient", message: "timeout again" },
        },
      ];
      const trace = makeTrace(entries);

      const mutations = deriveMutationsFromTrace(trace, spec);

      expect(mutations.some((m) => m.type === "modify-node")).toBe(true);
    });

    it("should not suggest mutations for successful traces", () => {
      const spec = makeSpec();
      const entries: ExecutionTraceEntry[] = [
        { nodeId: "node-a", source: "task", phase: "enter" },
        { nodeId: "node-a", source: "task", phase: "success" },
        { nodeId: "node-b", source: "task", phase: "enter" },
        { nodeId: "node-b", source: "task", phase: "success" },
      ];
      const trace = makeTrace(entries);

      const mutations = deriveMutationsFromTrace(trace, spec);

      expect(mutations).toHaveLength(0);
    });

    it("should suggest toggle-approval when high-risk nodes fail", () => {
      const spec = makeSpec();
      const entries: ExecutionTraceEntry[] = [
        { nodeId: "node-a", source: "task", phase: "enter" },
        { nodeId: "node-a", source: "task", phase: "success" },
        { nodeId: "node-b", source: "task", phase: "enter" },
        {
          nodeId: "node-b",
          source: "task",
          phase: "failure",
          details: { message: "critical failure" },
        },
      ];
      const trace = makeTrace(entries, { failureCount: 1 });

      const mutations = deriveMutationsFromTrace(trace, spec);

      expect(mutations.some((m) => m.type === "toggle-approval")).toBe(true);
    });

    it("should return empty for empty trace", () => {
      const spec = makeSpec();
      const trace = makeTrace([]);

      const mutations = deriveMutationsFromTrace(trace, spec);

      expect(mutations).toHaveLength(0);
    });
  });
});
