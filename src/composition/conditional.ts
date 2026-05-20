import type { HarnessSpec, TaskNode, TaskEdge, ConditionNode, MergeNode } from "../spec/types.js";
import { prefixSpec, findTerminalNodes } from "./types.js";
import type { CompositionResult } from "./types.js";

const NODE_DURATION_MS = 500;

export function conditionalHarness(
  condition: string,
  trueHarness: HarnessSpec,
  falseHarness?: HarnessSpec,
): CompositionResult {
  const conditionNodeId = "_conditional";

  const prefixedTrue = prefixSpec(trueHarness.name, trueHarness);
  const allNodes: TaskNode[] = [...prefixedTrue.graph.nodes];
  const allEdges: TaskEdge[] = [...prefixedTrue.graph.edges];

  let trueTerminals = findTerminalNodes(prefixedTrue);

  let stageCount = 1;
  let falseTerminals: string[] = [];
  let prefixedFalseEntryNodeId: string | undefined;

  if (falseHarness) {
    stageCount = 2;
    const prefixedFalse = prefixSpec(falseHarness.name, falseHarness);
    allNodes.push(...prefixedFalse.graph.nodes);
    allEdges.push(...prefixedFalse.graph.edges);
    falseTerminals = findTerminalNodes(prefixedFalse);
    prefixedFalseEntryNodeId = prefixedFalse.graph.entryNodeId;
  }

  const conditionNode: ConditionNode = {
    id: conditionNodeId,
    kind: "condition",
    condition,
    thenNodeId: prefixedTrue.graph.entryNodeId,
    elseNodeId: prefixedFalseEntryNodeId ?? prefixedTrue.graph.entryNodeId,
  };
  allNodes.unshift(conditionNode);

  let mergeNodeId: string | undefined;
  if (falseHarness && falseTerminals.length > 0) {
    mergeNodeId = "_conditional_merge";
    const mergeNode: MergeNode = {
      id: mergeNodeId,
      kind: "merge",
      waitFor: [...trueTerminals, ...falseTerminals],
      strategy: "any",
    };
    allNodes.push(mergeNode);

    for (const terminal of trueTerminals) {
      allEdges.push({ from: terminal, to: mergeNodeId });
    }
    for (const terminal of falseTerminals) {
      allEdges.push({ from: terminal, to: mergeNodeId });
    }
  }

  const combinedSpec: HarnessSpec = {
    name: `conditional(${condition})`,
    graph: {
      entryNodeId: conditionNodeId,
      nodes: allNodes,
      edges: allEdges,
    },
  };

  return {
    combinedSpec,
    stageCount,
    totalNodes: allNodes.length,
    estimatedDurationMs: allNodes.length * NODE_DURATION_MS,
  };
}
