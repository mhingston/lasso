import type { HarnessSpec } from "../spec/types.js";
import type { SpecDiff } from "./types.js";

export function diffSpecs(before: HarnessSpec, after: HarnessSpec): SpecDiff {
  const beforeNodeIds = new Set(before.graph.nodes.map((n) => n.id));
  const afterNodeIds = new Set(after.graph.nodes.map((n) => n.id));

  const addedNodes: string[] = [];
  const removedNodes: string[] = [];
  const modifiedNodes: string[] = [];

  for (const id of afterNodeIds) {
    if (!beforeNodeIds.has(id)) {
      addedNodes.push(id);
    }
  }

  for (const id of beforeNodeIds) {
    if (!afterNodeIds.has(id)) {
      removedNodes.push(id);
    }
  }

  for (const afterNode of after.graph.nodes) {
    if (!beforeNodeIds.has(afterNode.id)) continue;
    const beforeNode = before.graph.nodes.find((n) => n.id === afterNode.id);
    if (beforeNode && JSON.stringify(beforeNode) !== JSON.stringify(afterNode)) {
      modifiedNodes.push(afterNode.id);
    }
  }

  const edgeKey = (e: { from: string; to: string }) => `${e.from}->${e.to}`;
  const beforeEdges = new Map(before.graph.edges.map((e) => [edgeKey(e), e]));
  const afterEdges = new Map(after.graph.edges.map((e) => [edgeKey(e), e]));

  const addedEdges: Array<{ from: string; to: string }> = [];
  const removedEdges: Array<{ from: string; to: string }> = [];

  for (const [key, edge] of afterEdges) {
    if (!beforeEdges.has(key)) {
      addedEdges.push(edge);
    }
  }

  for (const [key, edge] of beforeEdges) {
    if (!afterEdges.has(key)) {
      removedEdges.push(edge);
    }
  }

  return { addedNodes, removedNodes, modifiedNodes, addedEdges, removedEdges };
}
