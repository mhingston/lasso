import type { CirMergeNode, CirNode, CirTransition, CirWorkflow } from "./types.js";

export type CirValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

const retryableKinds = new Set(["tool", "llm", "subworkflow"]);
const verifiableKinds = new Set(["tool", "llm", "human", "subworkflow"]);
const verifierKinds = new Set(["tool", "llm", "human", "subworkflow"]);

export function validateCirWorkflow(workflow: CirWorkflow): CirValidationResult {
  const errors: string[] = [];
  const nodeMap = new Map<string, CirNode>();
  const outgoingTransitions = new Map<string, CirTransition[]>();
  const incomingTransitions = new Map<string, CirTransition[]>();
  const transitionKeys = new Set<string>();

  for (const node of workflow.nodes) {
    if (nodeMap.has(node.id)) {
      errors.push(`Duplicate CIR node ID: ${node.id}`);
      continue;
    }

    nodeMap.set(node.id, node);

    if (!node.source.specNodeId || !node.source.specNodeKind || !node.source.specPath) {
      errors.push(`CIR node ${node.id} is missing source metadata`);
    }
  }

  if (!nodeMap.has(workflow.entryNodeId)) {
    errors.push(`CIR entry node not found: ${workflow.entryNodeId}`);
  }

  for (const transition of workflow.transitions) {
    if (!transition.source.kind || !transition.source.specPath) {
      errors.push(`Transition ${transition.from} -> ${transition.to} is missing source metadata`);
    }

    if (!nodeMap.has(transition.from)) {
      errors.push(`Transition references nonexistent source node: ${transition.from}`);
    }

    if (!nodeMap.has(transition.to)) {
      errors.push(`Transition references nonexistent target node: ${transition.to}`);
    }

    const transitionKey = `${transition.from}:${transition.when}:${transition.to}`;
    if (transitionKeys.has(transitionKey)) {
      errors.push(`Duplicate CIR transition: ${transition.from} -[${transition.when}]-> ${transition.to}`);
    } else {
      transitionKeys.add(transitionKey);
    }

    const outgoing = outgoingTransitions.get(transition.from) ?? [];
    outgoing.push(transition);
    outgoingTransitions.set(transition.from, outgoing);

    const incoming = incomingTransitions.get(transition.to) ?? [];
    incoming.push(transition);
    incomingTransitions.set(transition.to, incoming);
  }

  validateReachability(workflow, nodeMap, outgoingTransitions, errors);

  for (const node of workflow.nodes) {
    const outgoing = outgoingTransitions.get(node.id) ?? [];

    if (node.retry && !retryableKinds.has(node.kind)) {
      errors.push(`CIR node ${node.id} of kind "${node.kind}" cannot carry retry metadata`);
    }

    if (node.verification?.length && !verifiableKinds.has(node.kind)) {
      errors.push(`CIR node ${node.id} of kind "${node.kind}" cannot carry verification hooks`);
    }

    if (node.terminal && outgoing.length > 0) {
      errors.push(`Terminal CIR node ${node.id} cannot have outgoing transitions`);
    }

    validateVerificationHooks(node, nodeMap, errors);

    switch (node.kind) {
      case "condition": {
        const successTransitions = outgoing.filter(transition => transition.when === "success");
        const trueTransitions = outgoing.filter(transition => transition.when === "condition-true");
        const falseTransitions = outgoing.filter(transition => transition.when === "condition-false");

        if (node.terminal) {
          errors.push(`Condition node ${node.id} cannot be terminal`);
        }

        if (successTransitions.length > 0) {
          errors.push(`Condition node ${node.id} cannot have success transitions`);
        }

        if (trueTransitions.length !== 1) {
          errors.push(`Condition node ${node.id} must have exactly one condition-true transition`);
        }

        if (falseTransitions.length !== 1) {
          errors.push(`Condition node ${node.id} must have exactly one condition-false transition`);
        }

        if ([...trueTransitions, ...falseTransitions].some(transition => transition.to === node.id)) {
          errors.push(`Condition node ${node.id} cannot branch to itself`);
        }

        break;
      }
      case "merge":
        validateMergeNode(node, nodeMap, outgoing, incomingTransitions.get(node.id) ?? [], errors);
        break;
      default: {
        const branchTransitions = outgoing.filter(transition => transition.when !== "success");
        if (branchTransitions.length > 0) {
          errors.push(`CIR node ${node.id} of kind "${node.kind}" cannot have conditional transitions`);
        }

        if (!node.terminal && outgoing.length === 0) {
          errors.push(`Non-terminal CIR node ${node.id} has no outgoing transitions`);
        }

        break;
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

function validateReachability(
  workflow: CirWorkflow,
  nodeMap: Map<string, CirNode>,
  outgoingTransitions: Map<string, CirTransition[]>,
  errors: string[],
): void {
  if (!nodeMap.has(workflow.entryNodeId)) {
    return;
  }

  // Collect verification nodes
  const verificationNodes = new Set<string>();
  for (const node of nodeMap.values()) {
    if (node.verification) {
      for (const hook of node.verification) {
        verificationNodes.add(hook.checkNodeId);
        // If it's a condition node used as expression verifier, mark its branches too
        const verifierNode = nodeMap.get(hook.checkNodeId);
        if (verifierNode?.kind === "condition") {
          const condTransitions = outgoingTransitions.get(hook.checkNodeId) ?? [];
          for (const trans of condTransitions) {
            verificationNodes.add(trans.to);
          }
        }
      }
    }
  }

  const reachableNodeIds = new Set<string>([workflow.entryNodeId]);
  const queue = [workflow.entryNodeId];

  while (queue.length > 0) {
    const currentNodeId = queue.shift()!;
    for (const transition of outgoingTransitions.get(currentNodeId) ?? []) {
      if (!reachableNodeIds.has(transition.to)) {
        reachableNodeIds.add(transition.to);
        queue.push(transition.to);
      }
    }
  }

  for (const nodeId of nodeMap.keys()) {
    if (!reachableNodeIds.has(nodeId) && !verificationNodes.has(nodeId)) {
      errors.push(`Unreachable CIR node: ${nodeId}`);
    }
  }
}

function validateVerificationHooks(node: CirNode, nodeMap: Map<string, CirNode>, errors: string[]): void {
  if (!node.verification) {
    return;
  }

  for (const hook of node.verification) {
    const verifier = nodeMap.get(hook.checkNodeId);
    if (!verifier) {
      errors.push(`Verification hook on ${node.id} references missing node: ${hook.checkNodeId}`);
      continue;
    }

    if (hook.checkNodeId === node.id) {
      errors.push(`Verification hook on ${node.id} cannot reference itself`);
    }

    // Validate kind matching
    if (hook.kind === "tool" && verifier.kind !== "tool") {
      errors.push(
        `Verification hook on ${node.id} has kind "tool" but references node ${hook.checkNodeId} of kind "${verifier.kind}"`,
      );
    } else if (hook.kind === "llm" && verifier.kind !== "llm") {
      errors.push(
        `Verification hook on ${node.id} has kind "llm" but references node ${hook.checkNodeId} of kind "${verifier.kind}"`,
      );
    } else if (hook.kind === "expression" && verifier.kind !== "condition") {
      errors.push(
        `Verification hook on ${node.id} has kind "expression" but references node ${hook.checkNodeId} of kind "${verifier.kind}" (expected "condition")`,
      );
    }

    // Keep existing verifier kind check for backwards compatibility
    if (!verifierKinds.has(verifier.kind) && hook.kind !== "expression") {
      errors.push(
        `Verification hook on ${node.id} references node ${hook.checkNodeId} of kind "${verifier.kind}", which cannot act as a verifier`,
      );
    }
  }
}

function validateMergeNode(
  node: CirMergeNode,
  nodeMap: Map<string, CirNode>,
  outgoing: CirTransition[],
  incoming: CirTransition[],
  errors: string[],
): void {
  const waitFor = node.action.join.waitFor;
  const waitForSet = new Set(waitFor);
  const incomingSources = new Set(incoming.map(transition => transition.from));

  for (const transition of incoming) {
    if (transition.when !== "success") {
      errors.push(`Merge node ${node.id} can only receive success transitions (received ${transition.when} from ${transition.from})`);
    }
  }

  if (waitFor.length === 0) {
    errors.push(`Merge node ${node.id} must wait for at least one node`);
  }

  if (waitForSet.size !== waitFor.length) {
    errors.push(`Merge node ${node.id} has duplicate waitFor entries`);
  }

  for (const waitForNodeId of waitFor) {
    if (!nodeMap.has(waitForNodeId)) {
      errors.push(`Merge node ${node.id} references missing waitFor node: ${waitForNodeId}`);
      continue;
    }

    if (!incomingSources.has(waitForNodeId)) {
      errors.push(`Merge node ${node.id} waitFor node ${waitForNodeId} does not transition into the merge`);
    }
  }

  for (const incomingSource of incomingSources) {
    if (!waitForSet.has(incomingSource)) {
      errors.push(`Merge node ${node.id} has incoming transition from ${incomingSource} that is not declared in waitFor`);
    }
  }

  if (!node.terminal && outgoing.length === 0) {
    errors.push(`Non-terminal CIR node ${node.id} has no outgoing transitions`);
  }
}
