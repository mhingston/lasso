import type { HarnessSpec, TaskNode, TaskEdge } from "../spec/types.js";
import type { HarnessStage, CompositionResult } from "./types.js";
import { prefixSpec, findTerminalNodes } from "./types.js";

const NODE_DURATION_MS = 500;

export function chainHarnesses(stages: HarnessStage[]): CompositionResult {
  if (stages.length === 0) {
    throw new Error("Cannot chain empty stages array");
  }

  if (stages.length === 1) {
    const prefixed = prefixSpec(stages[0].name, stages[0].spec);
    return {
      combinedSpec: prefixed,
      stageCount: 1,
      totalNodes: prefixed.graph.nodes.length,
      estimatedDurationMs: prefixed.graph.nodes.length * NODE_DURATION_MS,
    };
  }

  const allNodes: TaskNode[] = [];
  const allEdges: TaskEdge[] = [];
  let prevPrefixed: HarnessSpec | undefined;

  for (let i = 0; i < stages.length; i++) {
    const prefixed = prefixSpec(stages[i].name, stages[i].spec);
    allNodes.push(...prefixed.graph.nodes);
    allEdges.push(...prefixed.graph.edges);

    if (i > 0 && prevPrefixed) {
      const prevTerminals = findTerminalNodes(prevPrefixed);
      const currentEntry = prefixed.graph.entryNodeId;

      for (const terminal of prevTerminals) {
        allEdges.push({ from: terminal, to: currentEntry });
      }
    }

    prevPrefixed = prefixed;
  }

  const combinedSpec: HarnessSpec = {
    name: stages.map((s) => s.name).join("->"),
    graph: {
      entryNodeId: prefixSpec(stages[0].name, stages[0].spec).graph.entryNodeId,
      nodes: allNodes,
      edges: allEdges,
    },
  };

  return {
    combinedSpec,
    stageCount: stages.length,
    totalNodes: allNodes.length,
    estimatedDurationMs: allNodes.length * NODE_DURATION_MS,
  };
}
