import type { HarnessSpec, TaskNode, TaskEdge, MergeNode, ToolNode } from "../spec/types.js";
import { prefixSpec, findTerminalNodes } from "./types.js";
import type { CompositionResult } from "./types.js";

const NODE_DURATION_MS = 500;

export function parallelHarnesses(harnesses: HarnessSpec[]): CompositionResult {
  if (harnesses.length === 0) {
    throw new Error("Cannot parallel empty harnesses array");
  }

  if (harnesses.length === 1) {
    const prefixed = prefixSpec(harnesses[0].name, harnesses[0]);
    return {
      combinedSpec: prefixed,
      stageCount: 1,
      totalNodes: prefixed.graph.nodes.length,
      estimatedDurationMs: prefixed.graph.nodes.length * NODE_DURATION_MS,
    };
  }

  const entryNodeId = "_parallel_entry";
  const mergeNodeId = "_parallel_merge";

  const entryNode: ToolNode = {
    id: entryNodeId,
    kind: "tool",
    tool: "echo",
    args: ["_parallel_entry"],
  };

  const allNodes: TaskNode[] = [entryNode];
  const allEdges: TaskEdge[] = [];

  const branchTerminals: string[] = [];

  for (const harness of harnesses) {
    const prefixed = prefixSpec(harness.name, harness);
    allNodes.push(...prefixed.graph.nodes);
    allEdges.push(...prefixed.graph.edges);

    const terminals = findTerminalNodes(prefixed);
    branchTerminals.push(...terminals);

    allEdges.push({ from: entryNodeId, to: prefixed.graph.entryNodeId });
  }

  const mergeNode: MergeNode = {
    id: mergeNodeId,
    kind: "merge",
    waitFor: branchTerminals,
    strategy: "all",
  };
  allNodes.push(mergeNode);

  for (const terminal of branchTerminals) {
    allEdges.push({ from: terminal, to: mergeNodeId });
  }

  const combinedSpec: HarnessSpec = {
    name: harnesses.map((h) => h.name).join("||"),
    graph: {
      entryNodeId,
      nodes: allNodes,
      edges: allEdges,
    },
  };

  return {
    combinedSpec,
    stageCount: harnesses.length,
    totalNodes: allNodes.length,
    estimatedDurationMs: allNodes.length * NODE_DURATION_MS,
  };
}
