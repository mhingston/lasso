import { describe, expect, it } from "vitest";
import { parallelHarnesses } from "../../src/composition/parallel.js";
import type { HarnessSpec, TaskNode } from "../../src/spec/types.js";

function makeSpec(name: string, nodes: TaskNode[], edges: { from: string; to: string }[] = []): HarnessSpec {
  return {
    name,
    graph: {
      entryNodeId: nodes[0]?.id ?? "entry",
      nodes,
      edges,
    },
  };
}

describe("parallelHarnesses", () => {
  describe("basic parallel execution", () => {
    it("merges two harnesses in parallel", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("alpha", [
          { id: "a1", kind: "tool", tool: "echo", args: ["alpha"] },
        ]),
        makeSpec("beta", [
          { id: "b1", kind: "tool", tool: "echo", args: ["beta"] },
        ]),
      ];

      const result = parallelHarnesses(harnesses);

      expect(result.stageCount).toBe(2);
      expect(result.totalNodes).toBeGreaterThanOrEqual(3);
    });

    it("creates a merge node to synchronize parallel branches", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("alpha", [
          { id: "a1", kind: "tool", tool: "echo", args: ["a"] },
        ]),
        makeSpec("beta", [
          { id: "b1", kind: "tool", tool: "echo", args: ["b"] },
        ]),
      ];

      const result = parallelHarnesses(harnesses);

      const mergeNode = result.combinedSpec.graph.nodes.find((n) => n.kind === "merge");
      expect(mergeNode).toBeDefined();
      expect(mergeNode!.kind).toBe("merge");
    });

    it("merge node waits for all branch terminal nodes", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("alpha", [
          { id: "a1", kind: "tool", tool: "echo", args: ["a"] },
        ]),
        makeSpec("beta", [
          { id: "b1", kind: "tool", tool: "echo", args: ["b"] },
        ]),
      ];

      const result = parallelHarnesses(harnesses);

      const mergeNode = result.combinedSpec.graph.nodes.find(
        (n) => n.kind === "merge",
      ) as any;
      expect(mergeNode).toBeDefined();
      expect(mergeNode.waitFor).toContain("alpha:a1");
      expect(mergeNode.waitFor).toContain("beta:b1");
    });
  });

  describe("node ID prefixing", () => {
    it("prefixes node IDs with harness name to avoid collisions", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("h1", [
          { id: "step", kind: "tool", tool: "a", args: [] },
        ]),
        makeSpec("h2", [
          { id: "step", kind: "tool", tool: "b", args: [] },
        ]),
      ];

      const result = parallelHarnesses(harnesses);

      const nodeIds = result.combinedSpec.graph.nodes.map((n) => n.id);
      expect(nodeIds).toContain("h1:step");
      expect(nodeIds).toContain("h2:step");
    });

    it("produces all unique node IDs", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("h1", [
          { id: "x", kind: "tool", tool: "a", args: [] },
          { id: "y", kind: "tool", tool: "b", args: [] },
        ]),
        makeSpec("h2", [
          { id: "x", kind: "tool", tool: "c", args: [] },
          { id: "y", kind: "tool", tool: "d", args: [] },
        ]),
      ];

      const result = parallelHarnesses(harnesses);

      const nodeIds = result.combinedSpec.graph.nodes.map((n) => n.id);
      const uniqueIds = new Set(nodeIds);
      expect(uniqueIds.size).toBe(nodeIds.length);
    });
  });

  describe("edge rewiring", () => {
    it("rewires internal edges with prefixed IDs", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("h1", [
          { id: "first", kind: "tool", tool: "a", args: [] },
          { id: "second", kind: "tool", tool: "b", args: [] },
        ], [{ from: "first", to: "second" }]),
      ];

      const result = parallelHarnesses(harnesses);

      const edge = result.combinedSpec.graph.edges.find(
        (e) => e.from === "h1:first" && e.to === "h1:second",
      );
      expect(edge).toBeDefined();
    });

    it("connects each branch terminal node to merge node", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("h1", [
          { id: "a1", kind: "tool", tool: "a", args: [] },
        ]),
        makeSpec("h2", [
          { id: "b1", kind: "tool", tool: "b", args: [] },
        ]),
      ];

      const result = parallelHarnesses(harnesses);

      const mergeNode = result.combinedSpec.graph.nodes.find(
        (n) => n.kind === "merge",
      )!;
      const mergeNodeId = mergeNode.id;

      const edgesToMerge = result.combinedSpec.graph.edges.filter(
        (e) => e.to === mergeNodeId,
      );
      expect(edgesToMerge.length).toBe(2);
    });
  });

  describe("multi-harness parallel", () => {
    it("merges three harnesses in parallel", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("h1", [{ id: "a", kind: "tool", tool: "a", args: [] }]),
        makeSpec("h2", [{ id: "b", kind: "tool", tool: "b", args: [] }]),
        makeSpec("h3", [{ id: "c", kind: "tool", tool: "c", args: [] }]),
      ];

      const result = parallelHarnesses(harnesses);

      expect(result.stageCount).toBe(3);
      const mergeNode = result.combinedSpec.graph.nodes.find(
        (n) => n.kind === "merge",
      ) as any;
      expect(mergeNode.waitFor.length).toBe(3);
    });

    it("entry point connects to all harness entry nodes", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("h1", [{ id: "a", kind: "tool", tool: "a", args: [] }]),
        makeSpec("h2", [{ id: "b", kind: "tool", tool: "b", args: [] }]),
      ];

      const result = parallelHarnesses(harnesses);

      const entryId = result.combinedSpec.graph.entryNodeId;
      const entryNode = result.combinedSpec.graph.nodes.find((n) => n.id === entryId);
      expect(entryNode).toBeDefined();

      const edgesFromEntry = result.combinedSpec.graph.edges.filter(
        (e) => e.from === entryId,
      );
      expect(edgesFromEntry.length).toBe(2);
    });
  });

  describe("composition result", () => {
    it("calculates total nodes including merge and entry", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("h1", [{ id: "a", kind: "tool", tool: "a", args: [] }]),
        makeSpec("h2", [{ id: "b", kind: "tool", tool: "b", args: [] }]),
      ];

      const result = parallelHarnesses(harnesses);

      expect(result.totalNodes).toBe(4);
    });

    it("estimates duration", () => {
      const harnesses: HarnessSpec[] = [
        makeSpec("h1", [{ id: "a", kind: "tool", tool: "a", args: [] }]),
      ];

      const result = parallelHarnesses(harnesses);

      expect(result.estimatedDurationMs).toBeGreaterThan(0);
    });
  });

  describe("empty harnesses", () => {
    it("throws on empty array", () => {
      expect(() => parallelHarnesses([])).toThrow();
    });
  });
});
