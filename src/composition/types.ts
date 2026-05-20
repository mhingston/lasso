import type { HarnessSpec, TaskNode, TaskEdge, ConditionNode, MergeNode } from "../spec/types.js";

export interface HarnessChain {
  name: string;
  stages: HarnessStage[];
}

export interface HarnessStage {
  name: string;
  spec: HarnessSpec;
  inputMapping: Record<string, string>;
  condition?: string;
}

export interface CompositionResult {
  combinedSpec: HarnessSpec;
  stageCount: number;
  totalNodes: number;
  estimatedDurationMs: number;
}

export interface HarnessComposer {
  chain(stages: HarnessStage[]): CompositionResult;
  parallel(harnesses: HarnessSpec[]): CompositionResult;
  conditional(condition: string, trueHarness: HarnessSpec, falseHarness?: HarnessSpec): CompositionResult;
}

export function prefixNodeId(stageName: string, nodeId: string): string {
  return `${stageName}:${nodeId}`;
}

export function prefixNode(stageName: string, node: TaskNode): TaskNode {
  const prefixed: TaskNode = {
    ...node,
    id: prefixNodeId(stageName, node.id),
  } as TaskNode;

  if (node.kind === "condition") {
    (prefixed as ConditionNode).thenNodeId = prefixNodeId(stageName, (node as ConditionNode).thenNodeId);
    (prefixed as ConditionNode).elseNodeId = prefixNodeId(stageName, (node as ConditionNode).elseNodeId);
  }

  if (node.kind === "merge") {
    (prefixed as MergeNode).waitFor = (node as MergeNode).waitFor.map((id: string) => prefixNodeId(stageName, id));
  }

  return prefixed;
}

export function prefixEdge(stageName: string, edge: TaskEdge): TaskEdge {
  return {
    from: prefixNodeId(stageName, edge.from),
    to: prefixNodeId(stageName, edge.to),
  };
}

export function prefixSpec(stageName: string, spec: HarnessSpec): HarnessSpec {
  return {
    name: spec.name,
    graph: {
      entryNodeId: prefixNodeId(stageName, spec.graph.entryNodeId),
      nodes: spec.graph.nodes.map((node) => prefixNode(stageName, node)),
      edges: spec.graph.edges.map((edge) => prefixEdge(stageName, edge)),
    },
    ...(spec.executionPolicy ? { executionPolicy: spec.executionPolicy } : {}),
    ...(spec.humanPolicy ? { humanPolicy: spec.humanPolicy } : {}),
    ...(spec.observabilityPolicy ? { observabilityPolicy: spec.observabilityPolicy } : {}),
  };
}

export function findTerminalNodes(spec: HarnessSpec): string[] {
  const nodeIds = new Set(spec.graph.nodes.map((n) => n.id));
  const hasIncoming = new Set(spec.graph.edges.map((e) => e.to));

  const terminals: string[] = [];
  for (const node of spec.graph.nodes) {
    if (node.kind === "condition") {
      continue;
    }
    if (!hasIncoming.has(node.id) && node.id !== spec.graph.entryNodeId) {
      continue;
    }
    const hasOutgoing = spec.graph.edges.some((e) => e.from === node.id);
    if (!hasOutgoing && node.kind !== "merge") {
      terminals.push(node.id);
    }
  }

  if (terminals.length === 0) {
    for (const node of spec.graph.nodes) {
      if (node.kind !== "condition" && node.kind !== "merge") {
        const hasOutgoing = spec.graph.edges.some((e) => e.from === node.id);
        if (!hasOutgoing) {
          terminals.push(node.id);
        }
      }
    }
  }

  if (terminals.length === 0 && spec.graph.nodes.length === 1) {
    return [spec.graph.entryNodeId];
  }

  return terminals;
}
