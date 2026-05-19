import Ajv from "ajv";
import { harnessSpecSchema } from "./schema.js";
import type { HarnessSpec, TaskNode } from "./types.js";

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(harnessSpecSchema);

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

export function validateHarnessSpec(spec: HarnessSpec): ValidationResult {
  const errors: string[] = [];

  // Step 1: Validate against JSON schema
  const schemaValid = validateSchema(spec);
  if (!schemaValid && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      errors.push(`Schema error at ${err.instancePath || "root"}: ${err.message}`);
    }
  }

  // Step 2: Structural validation
  if (spec.graph) {
    const nodeIds = new Set<string>();
    const nodeKinds = new Map<string, string>();

    // Check for duplicate node IDs and collect node metadata
    for (const node of spec.graph.nodes) {
      if (node.id) {
        if (nodeIds.has(node.id)) {
          errors.push(`Duplicate node ID: ${node.id}`);
        }
        nodeIds.add(node.id);
        nodeKinds.set(node.id, node.kind);
      }
    }

    // Validate entry node exists
    if (spec.graph.entryNodeId && !nodeIds.has(spec.graph.entryNodeId)) {
      errors.push(`Entry node not found: ${spec.graph.entryNodeId}`);
    }

    // Validate edge targets exist
    for (const edge of spec.graph.edges) {
      if (edge.from && !nodeIds.has(edge.from)) {
        errors.push(`Edge references nonexistent source node: ${edge.from}`);
      }
      if (edge.to && !nodeIds.has(edge.to)) {
        errors.push(`Edge references nonexistent target node: ${edge.to}`);
      }
    }

    // Check for condition node references
    for (const node of spec.graph.nodes) {
      if (node.kind === "condition") {
        const condNode = node as any;
        if (condNode.thenNodeId) {
          if (!nodeIds.has(condNode.thenNodeId)) {
            errors.push(`Condition node ${node.id} references nonexistent thenNodeId: ${condNode.thenNodeId}`);
          }
        }
        if (condNode.elseNodeId) {
          if (!nodeIds.has(condNode.elseNodeId)) {
            errors.push(`Condition node ${node.id} references nonexistent elseNodeId: ${condNode.elseNodeId}`);
          }
        }
      }
    }

    // Check for merge node references
    for (const node of spec.graph.nodes) {
      if (node.kind === "merge") {
        const mergeNode = node as any;
        if (mergeNode.waitFor) {
          // Issue 3: Validate waitFor is not empty
          if (mergeNode.waitFor.length === 0) {
            errors.push(`Merge node ${node.id} has empty waitFor array`);
          }
          for (const waitNodeId of mergeNode.waitFor) {
            if (!nodeIds.has(waitNodeId)) {
              errors.push(`Merge node ${node.id} references nonexistent waitFor node: ${waitNodeId}`);
            }
          }
        }
      }
    }

    // Issue 2: Validate choice interactions have options
    for (const node of spec.graph.nodes) {
      if (node.kind === "human") {
        const humanNode = node as any;
        if (humanNode.interactionType === "choice" && (!humanNode.options || humanNode.options.length === 0)) {
          errors.push(`Human node ${node.id} has interactionType "choice" but missing or empty options`);
        }
      }
    }

    // Issue 1: Proper reachability validation using BFS from entryNodeId
    const reachableNodes = new Set<string>();
    if (spec.graph.entryNodeId) {
      const queue: string[] = [spec.graph.entryNodeId];
      reachableNodes.add(spec.graph.entryNodeId);

      // Build adjacency map for edges
      const edgeMap = new Map<string, string[]>();
      for (const edge of spec.graph.edges) {
        if (edge.from && edge.to) {
          if (!edgeMap.has(edge.from)) {
            edgeMap.set(edge.from, []);
          }
          edgeMap.get(edge.from)!.push(edge.to);
        }
      }

      // Build condition node map
      const conditionMap = new Map<string, { thenNodeId: string; elseNodeId: string }>();
      for (const node of spec.graph.nodes) {
        if (node.kind === "condition") {
          const condNode = node as any;
          conditionMap.set(node.id, {
            thenNodeId: condNode.thenNodeId,
            elseNodeId: condNode.elseNodeId
          });
        }
      }

      // BFS traversal
      while (queue.length > 0) {
        const current = queue.shift()!;

        // Follow regular edges
        const targets = edgeMap.get(current) || [];
        for (const target of targets) {
          if (!reachableNodes.has(target)) {
            reachableNodes.add(target);
            queue.push(target);
          }
        }

        // Follow condition branches
        const condBranches = conditionMap.get(current);
        if (condBranches) {
          if (condBranches.thenNodeId && !reachableNodes.has(condBranches.thenNodeId)) {
            reachableNodes.add(condBranches.thenNodeId);
            queue.push(condBranches.thenNodeId);
          }
          if (condBranches.elseNodeId && !reachableNodes.has(condBranches.elseNodeId)) {
            reachableNodes.add(condBranches.elseNodeId);
            queue.push(condBranches.elseNodeId);
          }
        }
      }

      // Check for unreachable nodes
      for (const nodeId of nodeIds) {
        if (!reachableNodes.has(nodeId)) {
          errors.push(`Unreachable node: ${nodeId}`);
        }
      }
    }

    // Validate retry policy is only on supported node kinds
    const retryableKinds = new Set(["tool", "llm", "subworkflow"]);
    for (const node of spec.graph.nodes) {
      const nodeAny = node as any;
      if (nodeAny.retryPolicy && !retryableKinds.has(node.kind)) {
        errors.push(`retry policy not supported on node kind "${node.kind}" (node: ${node.id})`);
      }
    }

    // Validate verification policy checkNodeId references
    for (const node of spec.graph.nodes) {
      const nodeAny = node as any;
      if (nodeAny.verificationPolicy?.rules) {
        for (const rule of nodeAny.verificationPolicy.rules) {
          if (rule.checkNodeId && !nodeIds.has(rule.checkNodeId)) {
            errors.push(`Verification rule in node ${node.id} references nonexistent checkNodeId: ${rule.checkNodeId}`);
          }
          // Check for self-reference
          if (rule.checkNodeId === node.id) {
            errors.push(`Verification rule in node ${node.id} cannot reference itself`);
          }
        }
      }
    }

    // Check for circular verification dependencies using DFS cycle detection
    const verificationGraph = new Map<string, Set<string>>();
    for (const node of spec.graph.nodes) {
      const nodeAny = node as any;
      if (nodeAny.verificationPolicy?.rules) {
        const deps = new Set<string>();
        for (const rule of nodeAny.verificationPolicy.rules) {
          if (rule.checkNodeId) {
            deps.add(rule.checkNodeId);
          }
        }
        verificationGraph.set(node.id, deps);
      }
    }

    // Detect cycles of any length using DFS
    const detectCycle = (start: string, visited: Set<string>, recStack: Set<string>, path: string[]): string[] | null => {
      visited.add(start);
      recStack.add(start);
      path.push(start);

      const deps = verificationGraph.get(start);
      if (deps) {
        for (const dep of deps) {
          if (!visited.has(dep)) {
            const cycle = detectCycle(dep, visited, recStack, [...path]);
            if (cycle) return cycle;
          } else if (recStack.has(dep)) {
            // Found a cycle
            const cycleStart = path.indexOf(dep);
            return [...path.slice(cycleStart), dep];
          }
        }
      }

      recStack.delete(start);
      return null;
    };

    const visited = new Set<string>();
    for (const nodeId of verificationGraph.keys()) {
      if (!visited.has(nodeId)) {
        const cycle = detectCycle(nodeId, visited, new Set(), []);
        if (cycle) {
          errors.push(`Circular verification dependency detected: ${cycle.join(" -> ")}`);
          break; // Report first cycle found
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
