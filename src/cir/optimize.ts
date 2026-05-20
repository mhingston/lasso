import type { CirNode, CirTransition, CirWorkflow } from "./types.js";

export function optimizeCirWorkflow(cir: CirWorkflow): { optimized: CirWorkflow; passes: string[] } {
  const passes: string[] = [];

  let current = structuredClone(cir);

  const afterDeadNode = eliminateDeadNodes(current);
  if (afterDeadNode.changed) {
    passes.push("dead-node-elimination");
    current = afterDeadNode.workflow;
  }

  const afterMergeElision = elideSingleBranchMerges(current);
  if (afterMergeElision.changed) {
    passes.push("single-branch-merge-elision");
    current = afterMergeElision.workflow;
  }

  const afterFusion = fuseAdjacentToolNodes(current);
  if (afterFusion.changed) {
    passes.push("adjacent-tool-node-fusion");
    current = afterFusion.workflow;
  }

  return { optimized: current, passes };
}

function eliminateDeadNodes(cir: CirWorkflow): { workflow: CirWorkflow; changed: boolean } {
  const outgoingMap = new Map<string, CirTransition[]>();
  for (const t of cir.transitions) {
    const list = outgoingMap.get(t.from) ?? [];
    list.push(t);
    outgoingMap.set(t.from, list);
  }

  // Collect verification nodes (same logic as validate.ts)
  const verificationNodes = new Set<string>();
  for (const node of cir.nodes) {
    if (node.verification) {
      for (const hook of node.verification) {
        verificationNodes.add(hook.checkNodeId);
      }
    }
  }

  const reachable = new Set<string>([cir.entryNodeId]);
  const queue = [cir.entryNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of outgoingMap.get(current) ?? []) {
      if (!reachable.has(t.to)) {
        reachable.add(t.to);
        queue.push(t.to);
      }
    }
  }

  // Include verification hook targets and transitively reachable nodes
  for (const id of verificationNodes) {
    if (!reachable.has(id)) {
      reachable.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of outgoingMap.get(current) ?? []) {
      if (!reachable.has(t.to)) {
        reachable.add(t.to);
        queue.push(t.to);
      }
    }
  }

  const filteredNodes = cir.nodes.filter(n => reachable.has(n.id));
  const filteredTransitions = cir.transitions.filter(t => reachable.has(t.from) && reachable.has(t.to));

  const changed = filteredNodes.length !== cir.nodes.length || filteredTransitions.length !== cir.transitions.length;

  return {
    workflow: { ...cir, nodes: filteredNodes, transitions: filteredTransitions },
    changed,
  };
}

function elideSingleBranchMerges(cir: CirWorkflow): { workflow: CirWorkflow; changed: boolean } {
  const incomingMap = new Map<string, CirTransition[]>();
  for (const t of cir.transitions) {
    const list = incomingMap.get(t.to) ?? [];
    list.push(t);
    incomingMap.set(t.to, list);
  }

  const outgoingMap = new Map<string, CirTransition[]>();
  for (const t of cir.transitions) {
    const list = outgoingMap.get(t.from) ?? [];
    list.push(t);
    outgoingMap.set(t.from, list);
  }

  const mergesToElide = new Set<string>();

  for (const node of cir.nodes) {
    if (node.kind !== "merge") continue;
    if (node.action.join.waitFor.length !== 1) continue;

    const incoming = (incomingMap.get(node.id) ?? []).filter(t => t.when === "success");
    if (incoming.length !== 1) continue;
    if (incoming[0].from !== node.action.join.waitFor[0]) continue;

    mergesToElide.add(node.id);
  }

  if (mergesToElide.size === 0) {
    return { workflow: cir, changed: false };
  }

  const newNodes = cir.nodes.filter(n => !mergesToElide.has(n.id));
  const newTransitions: CirTransition[] = [];

  for (const t of cir.transitions) {
    if (mergesToElide.has(t.from)) {
      const mergeOutgoing = outgoingMap.get(t.from) ?? [];
      const mergeIncoming = (incomingMap.get(t.from) ?? []).filter(inc => inc.when === "success");
      for (const inc of mergeIncoming) {
        for (const out of mergeOutgoing) {
          newTransitions.push({
            from: inc.from,
            to: out.to,
            when: out.when,
            source: inc.source,
          });
        }
      }
      continue;
    }

    if (mergesToElide.has(t.to)) {
      continue;
    }

    newTransitions.push(t);
  }

  return { workflow: { ...cir, nodes: newNodes, transitions: newTransitions }, changed: true };
}

function fuseAdjacentToolNodes(cir: CirWorkflow): { workflow: CirWorkflow; changed: boolean } {
  const outgoingMap = new Map<string, CirTransition[]>();
  for (const t of cir.transitions) {
    const list = outgoingMap.get(t.from) ?? [];
    list.push(t);
    outgoingMap.set(t.from, list);
  }

  const incomingMap = new Map<string, CirTransition[]>();
  for (const t of cir.transitions) {
    const list = incomingMap.get(t.to) ?? [];
    list.push(t);
    incomingMap.set(t.to, list);
  }

  const nodeMap = new Map<string, CirNode>();
  for (const n of cir.nodes) {
    nodeMap.set(n.id, n);
  }

  const fusedAway = new Set<string>();
  const redirects = new Map<string, string>();
  let changed = false;

  for (const node of cir.nodes) {
    if (node.kind !== "tool") continue;
    if (fusedAway.has(node.id)) continue;

    const outgoing = (outgoingMap.get(node.id) ?? []).filter(t => t.when === "success");
    if (outgoing.length !== 1) continue;

    const nextNode = nodeMap.get(outgoing[0].to);
    if (!nextNode || nextNode.kind !== "tool") continue;
    if (fusedAway.has(nextNode.id)) continue;

    if (node.action.tool !== nextNode.action.tool) continue;
    if (node.action.tool !== "bash" && node.action.tool !== "sh") continue;
    if (node.action.env !== nextNode.action.env) continue;
    if (node.retry || nextNode.retry) continue;
    if (node.verification || nextNode.verification) continue;

    const mergedArgs = [node.action.args.join(" && ") + " && " + nextNode.action.args.join(" && ")];
    const mergedNode: CirNode = {
      ...node,
      action: {
        ...node.action,
        args: mergedArgs,
      },
      retry: nextNode.retry,
      verification: nextNode.verification,
      failureRouting: nextNode.failureRouting,
      terminal: nextNode.terminal,
    };

    nodeMap.set(node.id, mergedNode);
    fusedAway.add(nextNode.id);
    redirects.set(nextNode.id, node.id);
    changed = true;
  }

  if (!changed) {
    return { workflow: cir, changed: false };
  }

  const newNodes = cir.nodes
    .filter(n => !fusedAway.has(n.id))
    .map(n => {
      const updated = nodeMap.get(n.id) ?? n;
      if (updated.kind === "merge") {
        const newWaitFor = updated.action.join.waitFor.map(id => redirects.get(id) ?? id);
        if (newWaitFor.some((id, i) => id !== updated.action.join.waitFor[i])) {
          return {
            ...updated,
            action: {
              ...updated.action,
              join: { ...updated.action.join, waitFor: newWaitFor },
            },
          } as CirNode;
        }
      }
      return updated;
    });

  const newTransitions = cir.transitions
    .filter(t => !fusedAway.has(t.from) && !fusedAway.has(t.to))
    .map(t => ({
      ...t,
      from: redirects.get(t.from) ?? t.from,
      to: redirects.get(t.to) ?? t.to,
    }));

  const dedupedTransitions: CirTransition[] = [];
  const seenKeys = new Set<string>();
  for (const t of newTransitions) {
    const key = `${t.from}:${t.when}:${t.to}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      dedupedTransitions.push(t);
    }
  }

  return { workflow: { ...cir, nodes: newNodes, transitions: dedupedTransitions }, changed: true };
}
