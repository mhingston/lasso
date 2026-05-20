import { describe, expect, it } from "vitest";
import { conditionalHarness } from "../../src/composition/conditional.js";
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

describe("conditionalHarness", () => {
  describe("basic conditional", () => {
    it("creates a condition node at entry", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "echo", args: ["true"] },
      ]);

      const result = conditionalHarness("hasData", trueHarness);

      const conditionNode = result.combinedSpec.graph.nodes.find(
        (n) => n.kind === "condition",
      );
      expect(conditionNode).toBeDefined();
      expect((conditionNode as any).condition).toBe("hasData");
    });

    it("connects condition true branch to true harness", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "echo", args: ["true"] },
      ]);

      const result = conditionalHarness("hasData", trueHarness);

      const conditionNode = result.combinedSpec.graph.nodes.find(
        (n) => n.kind === "condition",
      ) as any;
      expect(conditionNode.thenNodeId).toBe("true-path:t1");
    });

    it("connects condition false branch to true harness when no false harness provided", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "echo", args: ["true"] },
      ]);

      const result = conditionalHarness("hasData", trueHarness);

      const conditionNode = result.combinedSpec.graph.nodes.find(
        (n) => n.kind === "condition",
      ) as any;
      expect(conditionNode.elseNodeId).toBe("true-path:t1");
    });
  });

  describe("with false harness", () => {
    it("connects false branch to false harness", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "echo", args: ["true"] },
      ]);
      const falseHarness = makeSpec("false-path", [
        { id: "f1", kind: "tool", tool: "echo", args: ["false"] },
      ]);

      const result = conditionalHarness("hasData", trueHarness, falseHarness);

      const conditionNode = result.combinedSpec.graph.nodes.find(
        (n) => n.kind === "condition",
      ) as any;
      expect(conditionNode.thenNodeId).toBe("true-path:t1");
      expect(conditionNode.elseNodeId).toBe("false-path:f1");
    });

    it("includes nodes from both branches", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "echo", args: ["true"] },
      ]);
      const falseHarness = makeSpec("false-path", [
        { id: "f1", kind: "tool", tool: "echo", args: ["false"] },
      ]);

      const result = conditionalHarness("hasData", trueHarness, falseHarness);

      const nodeIds = result.combinedSpec.graph.nodes.map((n) => n.id);
      expect(nodeIds).toContain("true-path:t1");
      expect(nodeIds).toContain("false-path:f1");
    });
  });

  describe("node ID prefixing", () => {
    it("prefixes true harness node IDs", () => {
      const trueHarness = makeSpec("alpha", [
        { id: "step", kind: "tool", tool: "a", args: [] },
      ]);

      const result = conditionalHarness("cond", trueHarness);

      const nodeIds = result.combinedSpec.graph.nodes.map((n) => n.id);
      expect(nodeIds).toContain("alpha:step");
    });

    it("prefixes false harness node IDs", () => {
      const trueHarness = makeSpec("alpha", [
        { id: "step", kind: "tool", tool: "a", args: [] },
      ]);
      const falseHarness = makeSpec("beta", [
        { id: "step", kind: "tool", tool: "b", args: [] },
      ]);

      const result = conditionalHarness("cond", trueHarness, falseHarness);

      const nodeIds = result.combinedSpec.graph.nodes.map((n) => n.id);
      expect(nodeIds).toContain("alpha:step");
      expect(nodeIds).toContain("beta:step");
    });
  });

  describe("edge rewiring", () => {
    it("rewires internal edges in true harness", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "a", args: [] },
        { id: "t2", kind: "tool", tool: "b", args: [] },
      ], [{ from: "t1", to: "t2" }]);

      const result = conditionalHarness("cond", trueHarness);

      const edge = result.combinedSpec.graph.edges.find(
        (e) => e.from === "true-path:t1" && e.to === "true-path:t2",
      );
      expect(edge).toBeDefined();
    });

    it("rewires internal edges in false harness", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "a", args: [] },
      ]);
      const falseHarness = makeSpec("false-path", [
        { id: "f1", kind: "tool", tool: "b", args: [] },
        { id: "f2", kind: "tool", tool: "c", args: [] },
      ], [{ from: "f1", to: "f2" }]);

      const result = conditionalHarness("cond", trueHarness, falseHarness);

      const edge = result.combinedSpec.graph.edges.find(
        (e) => e.from === "false-path:f1" && e.to === "false-path:f2",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("merge after conditional", () => {
    it("creates merge node after both branches", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "a", args: [] },
      ]);
      const falseHarness = makeSpec("false-path", [
        { id: "f1", kind: "tool", tool: "b", args: [] },
      ]);

      const result = conditionalHarness("cond", trueHarness, falseHarness);

      const mergeNode = result.combinedSpec.graph.nodes.find(
        (n) => n.kind === "merge",
      );
      expect(mergeNode).toBeDefined();
    });

    it("merge node waits for both branch terminals", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "a", args: [] },
      ]);
      const falseHarness = makeSpec("false-path", [
        { id: "f1", kind: "tool", tool: "b", args: [] },
      ]);

      const result = conditionalHarness("cond", trueHarness, falseHarness);

      const mergeNode = result.combinedSpec.graph.nodes.find(
        (n) => n.kind === "merge",
      ) as any;
      expect(mergeNode).toBeDefined();
      expect(mergeNode.waitFor).toContain("true-path:t1");
      expect(mergeNode.waitFor).toContain("false-path:f1");
    });
  });

  describe("composition result", () => {
    it("counts stages as 2 (true + false)", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "a", args: [] },
      ]);
      const falseHarness = makeSpec("false-path", [
        { id: "f1", kind: "tool", tool: "b", args: [] },
      ]);

      const result = conditionalHarness("cond", trueHarness, falseHarness);

      expect(result.stageCount).toBe(2);
    });

    it("counts stage as 1 when no false harness", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "a", args: [] },
      ]);

      const result = conditionalHarness("cond", trueHarness);

      expect(result.stageCount).toBe(1);
    });

    it("estimates duration", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "a", args: [] },
      ]);

      const result = conditionalHarness("cond", trueHarness);

      expect(result.estimatedDurationMs).toBeGreaterThan(0);
    });
  });

  describe("multi-node harnesses", () => {
    it("handles true harness with multiple nodes", () => {
      const trueHarness = makeSpec("true-path", [
        { id: "t1", kind: "tool", tool: "a", args: [] },
        { id: "t2", kind: "llm", provider: "openai", model: "gpt-4", prompt: "p" },
        { id: "t3", kind: "tool", tool: "b", args: [] },
      ], [
        { from: "t1", to: "t2" },
        { from: "t2", to: "t3" },
      ]);

      const result = conditionalHarness("cond", trueHarness);

      expect(result.combinedSpec.graph.nodes.filter((n) => n.id.startsWith("true-path:")).length).toBe(3);
    });
  });
});
