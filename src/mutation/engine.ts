import type { HarnessSpec, TaskNode, TaskEdge } from "../spec/types.js";
import { diffSpecs } from "./diff.js";
import type {
  HarnessMutation,
  MutationPolicy,
  MutationResult,
  AddNodeParams,
  RemoveNodeParams,
  ModifyNodeParams,
  AddEdgeParams,
  ToggleApprovalParams,
  AddVerificationParams,
} from "./types.js";

export function mutateHarness(
  spec: HarnessSpec,
  mutations: HarnessMutation[],
  policy?: MutationPolicy,
): MutationResult {
  if (policy) {
    enforcePolicy(mutations, policy);
  }

  let current: HarnessSpec = structuredClone(spec);
  const applied: HarnessMutation[] = [];

  for (const mutation of mutations) {
    switch (mutation.type) {
      case "add-node":
        current = applyAddNode(current, mutation.params as unknown as AddNodeParams);
        break;
      case "remove-node":
        current = applyRemoveNode(current, mutation.params as unknown as RemoveNodeParams);
        break;
      case "modify-node":
        current = applyModifyNode(current, mutation.params as unknown as ModifyNodeParams);
        break;
      case "add-edge":
        current = applyAddEdge(current, mutation.params as unknown as AddEdgeParams);
        break;
      case "toggle-approval":
        current = applyToggleApproval(current, mutation.params as unknown as ToggleApprovalParams);
        break;
      case "add-verification":
        current = applyAddVerification(current, mutation.params as unknown as AddVerificationParams);
        break;
    }
    applied.push(mutation);
  }

  return {
    spec: current,
    mutations: applied,
    diff: diffSpecs(spec, current),
  };
}

function enforcePolicy(mutations: HarnessMutation[], policy: MutationPolicy): void {
  const allowed = new Set(policy.allowedMutations);
  for (const mutation of mutations) {
    if (!allowed.has(mutation.type)) {
      throw new Error(`Mutation type "${mutation.type}" is not allowed by policy`);
    }
  }

  if (mutations.length > policy.maxMutations) {
    throw new Error(
      `Mutation count ${mutations.length} exceeds maximum allowed ${policy.maxMutations}`,
    );
  }
}

function applyAddNode(spec: HarnessSpec, params: AddNodeParams): HarnessSpec {
  const existing = spec.graph.nodes.find((n) => n.id === params.node.id);
  if (existing) {
    throw new Error(`Node "${params.node.id}" already exists`);
  }

  const nodes = [...spec.graph.nodes, params.node];
  const edges = params.edges
    ? [...spec.graph.edges, ...params.edges]
    : [...spec.graph.edges];

  return {
    ...spec,
    graph: { ...spec.graph, nodes, edges },
  };
}

function applyRemoveNode(spec: HarnessSpec, params: RemoveNodeParams): HarnessSpec {
  const node = spec.graph.nodes.find((n) => n.id === params.nodeId);
  if (!node) {
    throw new Error(`Node "${params.nodeId}" not found`);
  }

  const incoming = spec.graph.edges.filter((e) => e.to === params.nodeId);
  const outgoing = spec.graph.edges.filter((e) => e.from === params.nodeId);

  const remainingEdges = spec.graph.edges.filter(
    (e) => e.from !== params.nodeId && e.to !== params.nodeId,
  );

  const bridgingEdges: TaskEdge[] = [];
  for (const inEdge of incoming) {
    for (const outEdge of outgoing) {
      bridgingEdges.push({ from: inEdge.from, to: outEdge.to });
    }
  }

  const nodes = spec.graph.nodes.filter((n) => n.id !== params.nodeId);
  const edges = [...remainingEdges, ...bridgingEdges];

  let entryNodeId = spec.graph.entryNodeId;
  if (entryNodeId === params.nodeId && nodes.length > 0) {
    entryNodeId = nodes[0].id;
  }

  return {
    ...spec,
    graph: { ...spec.graph, nodes, edges, entryNodeId },
  };
}

function applyModifyNode(spec: HarnessSpec, params: ModifyNodeParams): HarnessSpec {
  const idx = spec.graph.nodes.findIndex((n) => n.id === params.nodeId);
  if (idx === -1) {
    throw new Error(`Node "${params.nodeId}" not found`);
  }

  const { id: _id, kind: _kind, ...safeChanges } = params.changes as Record<string, unknown>;

  const nodes = [...spec.graph.nodes];
  nodes[idx] = { ...nodes[idx], ...safeChanges } as TaskNode;

  return {
    ...spec,
    graph: { ...spec.graph, nodes },
  };
}

function applyAddEdge(spec: HarnessSpec, params: AddEdgeParams): HarnessSpec {
  const exists = spec.graph.edges.some(
    (e) => e.from === params.edge.from && e.to === params.edge.to,
  );
  if (exists) {
    throw new Error(
      `Edge "${params.edge.from}->${params.edge.to}" already exists`,
    );
  }

  const fromNode = spec.graph.nodes.find((n) => n.id === params.edge.from);
  if (!fromNode) {
    throw new Error(`Source node "${params.edge.from}" not found`);
  }

  const toNode = spec.graph.nodes.find((n) => n.id === params.edge.to);
  if (!toNode) {
    throw new Error(`Target node "${params.edge.to}" not found`);
  }

  return {
    ...spec,
    graph: { ...spec.graph, edges: [...spec.graph.edges, params.edge] },
  };
}

function applyToggleApproval(
  spec: HarnessSpec,
  params: ToggleApprovalParams,
): HarnessSpec {
  const currentPolicy = spec.humanPolicy ?? {};
  const currentApproval = (currentPolicy as Record<string, unknown>).approvalRequired as
    | boolean
    | undefined;

  const newApproval =
    params.approvalRequired !== undefined ? params.approvalRequired : !currentApproval;

  return {
    ...spec,
    humanPolicy: {
      ...currentPolicy,
      approvalRequired: newApproval,
    },
  };
}

function applyAddVerification(
  spec: HarnessSpec,
  params: AddVerificationParams,
): HarnessSpec {
  const idx = spec.graph.nodes.findIndex((n) => n.id === params.nodeId);
  if (idx === -1) {
    throw new Error(`Node "${params.nodeId}" not found`);
  }

  const nodes = [...spec.graph.nodes];
  nodes[idx] = {
    ...nodes[idx],
    verificationPolicy: params.verificationPolicy,
  } as TaskNode;

  return {
    ...spec,
    graph: { ...spec.graph, nodes },
  };
}
