import { describe, expect, it } from "vitest";
import { chainHarnesses } from "../../src/composition/chain.js";
import type { HarnessStage } from "../../src/composition/types.js";
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

describe("chainHarnesses", () => {
  describe("basic chaining", () => {
    it("chains a single stage and returns its spec", () => {
      const stages: HarnessStage[] = [
        {
          name: "research",
          spec: makeSpec("research", [
            { id: "search", kind: "tool", tool: "grep", args: ["term"] },
          ]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      expect(result.stageCount).toBe(1);
      expect(result.totalNodes).toBe(1);
      expect(result.combinedSpec.name).toBe("research");
      expect(result.combinedSpec.graph.nodes.length).toBe(1);
    });

    it("chains two stages with edge connection", () => {
      const stages: HarnessStage[] = [
        {
          name: "research",
          spec: makeSpec("research", [
            { id: "search", kind: "tool", tool: "grep", args: ["term"] },
          ]),
          inputMapping: {},
        },
        {
          name: "plan",
          spec: makeSpec("plan", [
            { id: "write-plan", kind: "llm", provider: "openai", model: "gpt-4", prompt: "plan" },
          ]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      expect(result.stageCount).toBe(2);
      expect(result.totalNodes).toBe(2);
      expect(result.combinedSpec.graph.edges.length).toBeGreaterThanOrEqual(1);
    });

    it("chains three stages sequentially", () => {
      const stages: HarnessStage[] = [
        {
          name: "research",
          spec: makeSpec("research", [
            { id: "search", kind: "tool", tool: "grep", args: ["term"] },
          ]),
          inputMapping: {},
        },
        {
          name: "plan",
          spec: makeSpec("plan", [
            { id: "write-plan", kind: "llm", provider: "openai", model: "gpt-4", prompt: "plan" },
          ]),
          inputMapping: {},
        },
        {
          name: "execute",
          spec: makeSpec("execute", [
            { id: "run", kind: "tool", tool: "bash", args: ["make"] },
          ]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      expect(result.stageCount).toBe(3);
      expect(result.totalNodes).toBe(3);
      const entryNode = result.combinedSpec.graph.nodes.find(
        (n) => n.id === result.combinedSpec.graph.entryNodeId,
      );
      expect(entryNode).toBeDefined();
    });
  });

  describe("node ID collision avoidance", () => {
    it("prefixes node IDs with stage name to avoid collisions", () => {
      const stages: HarnessStage[] = [
        {
          name: "research",
          spec: makeSpec("research", [
            { id: "step-1", kind: "tool", tool: "grep", args: ["a"] },
          ]),
          inputMapping: {},
        },
        {
          name: "plan",
          spec: makeSpec("plan", [
            { id: "step-1", kind: "tool", tool: "echo", args: ["b"] },
          ]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      const nodeIds = result.combinedSpec.graph.nodes.map((n) => n.id);
      expect(nodeIds).toContain("research:step-1");
      expect(nodeIds).toContain("plan:step-1");
      expect(nodeIds.length).toBe(2);
    });

    it("produces unique node IDs across all stages", () => {
      const stages: HarnessStage[] = [
        {
          name: "alpha",
          spec: makeSpec("alpha", [
            { id: "node", kind: "tool", tool: "a", args: [] },
            { id: "shared", kind: "tool", tool: "b", args: [] },
          ], [{ from: "node", to: "shared" }]),
          inputMapping: {},
        },
        {
          name: "beta",
          spec: makeSpec("beta", [
            { id: "node", kind: "tool", tool: "c", args: [] },
            { id: "shared", kind: "tool", tool: "d", args: [] },
          ], [{ from: "node", to: "shared" }]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      const nodeIds = result.combinedSpec.graph.nodes.map((n) => n.id);
      const uniqueIds = new Set(nodeIds);
      expect(uniqueIds.size).toBe(nodeIds.length);
    });
  });

  describe("edge connections", () => {
    it("rewires internal edges with prefixed node IDs", () => {
      const stages: HarnessStage[] = [
        {
          name: "stage-a",
          spec: makeSpec("stage-a", [
            { id: "first", kind: "tool", tool: "a", args: [] },
            { id: "second", kind: "tool", tool: "b", args: [] },
          ], [{ from: "first", to: "second" }]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      const edge = result.combinedSpec.graph.edges[0];
      expect(edge.from).toBe("stage-a:first");
      expect(edge.to).toBe("stage-a:second");
    });

    it("connects last node of stage N to first node of stage N+1", () => {
      const stages: HarnessStage[] = [
        {
          name: "research",
          spec: makeSpec("research", [
            { id: "search", kind: "tool", tool: "grep", args: [] },
          ]),
          inputMapping: {},
        },
        {
          name: "plan",
          spec: makeSpec("plan", [
            { id: "write", kind: "llm", provider: "openai", model: "gpt-4", prompt: "p" },
          ]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      const interStageEdge = result.combinedSpec.graph.edges.find(
        (e) => e.from === "research:search" && e.to === "plan:write",
      );
      expect(interStageEdge).toBeDefined();
    });

    it("connects multi-node stages correctly", () => {
      const stages: HarnessStage[] = [
        {
          name: "research",
          spec: makeSpec("research", [
            { id: "search", kind: "tool", tool: "a", args: [] },
            { id: "analyze", kind: "llm", provider: "openai", model: "gpt-4", prompt: "p" },
          ], [{ from: "search", to: "analyze" }]),
          inputMapping: {},
        },
        {
          name: "plan",
          spec: makeSpec("plan", [
            { id: "draft", kind: "llm", provider: "openai", model: "gpt-4", prompt: "d" },
            { id: "review", kind: "tool", tool: "b", args: [] },
          ], [{ from: "draft", to: "review" }]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      const interStageEdge = result.combinedSpec.graph.edges.find(
        (e) => e.from === "research:analyze" && e.to === "plan:draft",
      );
      expect(interStageEdge).toBeDefined();
    });
  });

  describe("input mapping", () => {
    it("records input mapping in combined spec metadata", () => {
      const stages: HarnessStage[] = [
        {
          name: "research",
          spec: makeSpec("research", [
            { id: "search", kind: "tool", tool: "grep", args: [] },
          ]),
          inputMapping: {},
        },
        {
          name: "plan",
          spec: makeSpec("plan", [
            { id: "write", kind: "llm", provider: "openai", model: "gpt-4", prompt: "p" },
          ]),
          inputMapping: { "research:output": "plan:input" },
        },
      ];

      const result = chainHarnesses(stages);

      expect(result.stageCount).toBe(2);
    });
  });

  describe("condition stages", () => {
    it("includes condition field on stage", () => {
      const stages: HarnessStage[] = [
        {
          name: "research",
          spec: makeSpec("research", [
            { id: "search", kind: "tool", tool: "grep", args: [] },
          ]),
          inputMapping: {},
        },
        {
          name: "deep-research",
          spec: makeSpec("deep-research", [
            { id: "deep-search", kind: "tool", tool: "grep", args: ["--deep"] },
          ]),
          inputMapping: {},
          condition: "results.length > 10",
        },
      ];

      const result = chainHarnesses(stages);

      expect(result.stageCount).toBe(2);
      expect(result.combinedSpec.graph.nodes.length).toBe(2);
    });
  });

  describe("composition result", () => {
    it("calculates total nodes correctly", () => {
      const stages: HarnessStage[] = [
        {
          name: "a",
          spec: makeSpec("a", [
            { id: "a1", kind: "tool", tool: "a", args: [] },
            { id: "a2", kind: "tool", tool: "b", args: [] },
          ]),
          inputMapping: {},
        },
        {
          name: "b",
          spec: makeSpec("b", [
            { id: "b1", kind: "tool", tool: "c", args: [] },
          ]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      expect(result.totalNodes).toBe(3);
    });

    it("estimates duration based on node count", () => {
      const stages: HarnessStage[] = [
        {
          name: "a",
          spec: makeSpec("a", [
            { id: "a1", kind: "tool", tool: "a", args: [] },
          ]),
          inputMapping: {},
        },
      ];

      const result = chainHarnesses(stages);

      expect(result.estimatedDurationMs).toBeGreaterThan(0);
    });
  });

  describe("empty stages", () => {
    it("throws on empty stages array", () => {
      expect(() => chainHarnesses([])).toThrow();
    });
  });
});
