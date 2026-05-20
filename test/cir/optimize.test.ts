import { describe, expect, it } from "vitest";
import { optimizeCirWorkflow } from "../../src/cir/optimize.js";
import type { CirToolNode, CirWorkflow } from "../../src/cir/types.js";

function createLinearWorkflow(): CirWorkflow {
  return {
    name: "linear",
    entryNodeId: "a",
    nodes: [
      { id: "a", kind: "tool", source: { specNodeId: "a", specNodeKind: "tool", specPath: "graph.nodes[0]" }, action: { tool: "bash", args: ["step-a"] } },
      { id: "b", kind: "tool", source: { specNodeId: "b", specNodeKind: "tool", specPath: "graph.nodes[1]" }, action: { tool: "git", args: ["status"] } },
      { id: "c", kind: "tool", source: { specNodeId: "c", specNodeKind: "tool", specPath: "graph.nodes[2]" }, action: { tool: "npm", args: ["test"] }, terminal: true },
    ],
    transitions: [
      { from: "a", to: "b", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[0]" } },
      { from: "b", to: "c", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[1]" } },
    ],
  };
}

describe("optimizeCirWorkflow", () => {
  describe("dead-node elimination", () => {
    it("removes unreachable nodes", () => {
      const workflow = createLinearWorkflow();
      workflow.nodes.push({
        id: "orphan",
        kind: "tool",
        source: { specNodeId: "orphan", specNodeKind: "tool", specPath: "graph.nodes[3]" },
        action: { tool: "echo", args: ["orphan"] },
        terminal: true,
      });

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.nodes.map(n => n.id)).toEqual(["a", "b", "c"]);
    });

    it("removes transitions involving dead nodes", () => {
      const workflow = createLinearWorkflow();
      workflow.nodes.push({
        id: "orphan",
        kind: "tool",
        source: { specNodeId: "orphan", specNodeKind: "tool", specPath: "graph.nodes[3]" },
        action: { tool: "echo", args: ["orphan"] },
        terminal: true,
      });
      workflow.transitions.push({
        from: "orphan",
        to: "c",
        when: "success",
        source: { kind: "graph-edge", specPath: "graph.edges[2]" },
      });

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.transitions.every(t => t.from !== "orphan" && t.to !== "orphan")).toBe(true);
    });

    it("preserves all reachable nodes", () => {
      const workflow = createLinearWorkflow();

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.nodes.map(n => n.id)).toEqual(["a", "b", "c"]);
    });

    it("handles empty graph", () => {
      const workflow: CirWorkflow = {
        name: "empty",
        entryNodeId: "start",
        nodes: [
          { id: "start", kind: "tool", source: { specNodeId: "start", specNodeKind: "tool", specPath: "graph.nodes[0]" }, action: { tool: "echo", args: [] }, terminal: true },
        ],
        transitions: [],
      };

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.nodes).toHaveLength(1);
      expect(optimized.nodes[0].id).toBe("start");
    });
  });

  describe("single-branch merge elision", () => {
    it("elides merge with single waitFor entry", () => {
      const workflow: CirWorkflow = {
        name: "single-merge",
        entryNodeId: "a",
        nodes: [
          { id: "a", kind: "tool", source: { specNodeId: "a", specNodeKind: "tool", specPath: "graph.nodes[0]" }, action: { tool: "bash", args: ["step-a"] } },
          { id: "m", kind: "merge", source: { specNodeId: "m", specNodeKind: "merge", specPath: "graph.nodes[1]" }, action: { join: { waitFor: ["a"], strategy: "all" } } },
          { id: "b", kind: "tool", source: { specNodeId: "b", specNodeKind: "tool", specPath: "graph.nodes[2]" }, action: { tool: "git", args: ["status"] }, terminal: true },
        ],
        transitions: [
          { from: "a", to: "m", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[0]" } },
          { from: "m", to: "b", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[1]" } },
        ],
      };

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.nodes.map(n => n.id)).toEqual(["a", "b"]);
      expect(optimized.transitions).toHaveLength(1);
      expect(optimized.transitions[0]).toEqual(expect.objectContaining({ from: "a", to: "b", when: "success" }));
    });

    it("preserves merge with multiple waitFor entries", () => {
      const workflow: CirWorkflow = {
        name: "multi-merge",
        entryNodeId: "start",
        nodes: [
          { id: "start", kind: "condition", source: { specNodeId: "start", specNodeKind: "condition", specPath: "graph.nodes[0]" }, action: { conditionExpr: "true" } },
          { id: "left", kind: "tool", source: { specNodeId: "left", specNodeKind: "tool", specPath: "graph.nodes[1]" }, action: { tool: "echo", args: ["left"] } },
          { id: "right", kind: "tool", source: { specNodeId: "right", specNodeKind: "tool", specPath: "graph.nodes[2]" }, action: { tool: "echo", args: ["right"] } },
          { id: "m", kind: "merge", source: { specNodeId: "m", specNodeKind: "merge", specPath: "graph.nodes[3]" }, action: { join: { waitFor: ["left", "right"], strategy: "all" } } },
          { id: "end", kind: "tool", source: { specNodeId: "end", specNodeKind: "tool", specPath: "graph.nodes[4]" }, action: { tool: "echo", args: ["end"] }, terminal: true },
        ],
        transitions: [
          { from: "start", to: "left", when: "condition-true", source: { kind: "condition-then", specNodeId: "start", specPath: "graph.nodes[0].thenNodeId" } },
          { from: "start", to: "right", when: "condition-false", source: { kind: "condition-else", specNodeId: "start", specPath: "graph.nodes[0].elseNodeId" } },
          { from: "left", to: "m", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[0]" } },
          { from: "right", to: "m", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[1]" } },
          { from: "m", to: "end", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[2]" } },
        ],
      };

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.nodes.some(n => n.id === "m")).toBe(true);
    });
  });

  describe("adjacent tool-node fusion", () => {
    it("fuses adjacent tool nodes with same tool and env", () => {
      const workflow: CirWorkflow = {
        name: "fuse",
        entryNodeId: "a",
        nodes: [
          { id: "a", kind: "tool", source: { specNodeId: "a", specNodeKind: "tool", specPath: "graph.nodes[0]" }, action: { tool: "bash", args: ["npm install"] } },
          { id: "b", kind: "tool", source: { specNodeId: "b", specNodeKind: "tool", specPath: "graph.nodes[1]" }, action: { tool: "bash", args: ["npm test"] }, terminal: true },
        ],
        transitions: [
          { from: "a", to: "b", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[0]" } },
        ],
      };

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.nodes).toHaveLength(1);
      const fused = optimized.nodes[0] as CirToolNode;
      expect(fused.id).toBe("a");
      expect(fused.action.args).toEqual(["npm install && npm test"]);
      expect(fused.terminal).toBe(true);
    });

    it("does not fuse nodes with different tools", () => {
      const workflow: CirWorkflow = {
        name: "no-fuse-diff-tool",
        entryNodeId: "a",
        nodes: [
          { id: "a", kind: "tool", source: { specNodeId: "a", specNodeKind: "tool", specPath: "graph.nodes[0]" }, action: { tool: "bash", args: ["npm install"] } },
          { id: "b", kind: "tool", source: { specNodeId: "b", specNodeKind: "tool", specPath: "graph.nodes[1]" }, action: { tool: "git", args: ["push"] }, terminal: true },
        ],
        transitions: [
          { from: "a", to: "b", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[0]" } },
        ],
      };

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.nodes).toHaveLength(2);
    });

    it("does not fuse nodes when first has retryPolicy", () => {
      const workflow: CirWorkflow = {
        name: "no-fuse-retry",
        entryNodeId: "a",
        nodes: [
          { id: "a", kind: "tool", source: { specNodeId: "a", specNodeKind: "tool", specPath: "graph.nodes[0]" }, action: { tool: "bash", args: ["npm install"] }, retry: { maxAttempts: 3, backoff: "exponential" } },
          { id: "b", kind: "tool", source: { specNodeId: "b", specNodeKind: "tool", specPath: "graph.nodes[1]" }, action: { tool: "bash", args: ["npm test"] }, terminal: true },
        ],
        transitions: [
          { from: "a", to: "b", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[0]" } },
        ],
      };

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.nodes).toHaveLength(2);
    });

    it("does not fuse nodes when second has verificationPolicy", () => {
      const workflow: CirWorkflow = {
        name: "no-fuse-verification",
        entryNodeId: "a",
        nodes: [
          { id: "a", kind: "tool", source: { specNodeId: "a", specNodeKind: "tool", specPath: "graph.nodes[0]" }, action: { tool: "bash", args: ["npm install"] } },
          { id: "b", kind: "tool", source: { specNodeId: "b", specNodeKind: "tool", specPath: "graph.nodes[1]" }, action: { tool: "bash", args: ["npm test"] }, verification: [{ kind: "tool", checkNodeId: "v", onFail: "block" }], terminal: true },
          { id: "v", kind: "tool", source: { specNodeId: "v", specNodeKind: "tool", specPath: "graph.nodes[2]" }, action: { tool: "echo", args: ["ok"] }, terminal: true },
        ],
        transitions: [
          { from: "a", to: "b", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[0]" } },
        ],
      };

      const { optimized } = optimizeCirWorkflow(workflow);

      expect(optimized.nodes).toHaveLength(3);
    });
  });

  describe("pass tracking", () => {
    it("reports which passes ran", () => {
      const workflow = createLinearWorkflow();
      workflow.nodes.push({
        id: "orphan",
        kind: "tool",
        source: { specNodeId: "orphan", specNodeKind: "tool", specPath: "graph.nodes[3]" },
        action: { tool: "echo", args: ["orphan"] },
        terminal: true,
      });

      const { passes } = optimizeCirWorkflow(workflow);

      expect(passes).toContain("dead-node-elimination");
    });

    it("reports merge elision pass", () => {
      const workflow: CirWorkflow = {
        name: "single-merge",
        entryNodeId: "a",
        nodes: [
          { id: "a", kind: "tool", source: { specNodeId: "a", specNodeKind: "tool", specPath: "graph.nodes[0]" }, action: { tool: "echo", args: ["a"] } },
          { id: "m", kind: "merge", source: { specNodeId: "m", specNodeKind: "merge", specPath: "graph.nodes[1]" }, action: { join: { waitFor: ["a"], strategy: "all" } } },
          { id: "b", kind: "tool", source: { specNodeId: "b", specNodeKind: "tool", specPath: "graph.nodes[2]" }, action: { tool: "echo", args: ["b"] }, terminal: true },
        ],
        transitions: [
          { from: "a", to: "m", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[0]" } },
          { from: "m", to: "b", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[1]" } },
        ],
      };

      const { passes } = optimizeCirWorkflow(workflow);

      expect(passes).toContain("single-branch-merge-elision");
    });

    it("reports fusion pass", () => {
      const workflow: CirWorkflow = {
        name: "fuse",
        entryNodeId: "a",
        nodes: [
          { id: "a", kind: "tool", source: { specNodeId: "a", specNodeKind: "tool", specPath: "graph.nodes[0]" }, action: { tool: "bash", args: ["npm install"] } },
          { id: "b", kind: "tool", source: { specNodeId: "b", specNodeKind: "tool", specPath: "graph.nodes[1]" }, action: { tool: "bash", args: ["npm test"] }, terminal: true },
        ],
        transitions: [
          { from: "a", to: "b", when: "success", source: { kind: "graph-edge", specPath: "graph.edges[0]" } },
        ],
      };

      const { passes } = optimizeCirWorkflow(workflow);

      expect(passes).toContain("adjacent-tool-node-fusion");
    });
  });
});
