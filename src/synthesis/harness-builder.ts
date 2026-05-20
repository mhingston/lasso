import type { HarnessSpec } from "../spec/types.js";
import type { TaskNode } from "../spec/types.js";
import { buildPatchValidationHarnessSpec } from "../reference/patch-validation.js";
import { buildPrReviewMergeHarnessSpec } from "../reference/pr-review-merge.js";
import type { LocalPatchValidationBundle, LocalPrBundle } from "../reference/types.js";
import type { TaskGraph, WorkflowStage } from "./graph-builder.js";
import type { RiskModel } from "./risk-analyzer.js";
import { synthesizePolicy } from "./policy-builder.js";

interface HarnessSynthesisResult {
  spec: HarnessSpec;
  rationale: string[];
  warnings: string[];
}

function stageTypeToNodeKind(stageType: WorkflowStage["type"]): TaskNode["kind"] {
  switch (stageType) {
    case "setup":
    case "reproduce":
    case "apply":
    case "verify":
    case "merge":
      return "tool";
    case "review":
      return "llm";
    case "approval":
      return "human";
    default:
      return "tool";
  }
}

function buildGenericHarnessSpec(graph: TaskGraph): HarnessSpec {
  const nodes: TaskNode[] = [];
  const edges: Array<{ from: string; to: string }> = [];

  if (graph.stages.length === 0) {
    // Empty graph — create a single no-op tool node
    const entryId = `${graph.family}-noop`;
    nodes.push({
      id: entryId,
      label: `Execute ${graph.family}`,
      kind: "tool",
      tool: "echo",
      args: [`Running ${graph.family} workflow`]
    });
    return {
      name: graph.family,
      graph: { entryNodeId: entryId, nodes, edges }
    };
  }

  // Build nodes from stages
  for (const stage of graph.stages) {
    const kind = stageTypeToNodeKind(stage.type);
    const node: TaskNode = kind === "tool"
      ? { id: stage.id, label: stage.description, kind: "tool", tool: "echo", args: [stage.description] }
      : kind === "llm"
        ? { id: stage.id, label: stage.description, kind: "llm", provider: "generic", model: "default", prompt: stage.description }
        : { id: stage.id, label: stage.description, kind: "human", prompt: stage.description, interactionType: "approval" };
    nodes.push(node);
  }

  // Build edges from dependencies
  for (const stage of graph.stages) {
    for (const dep of stage.dependencies) {
      edges.push({ from: dep, to: stage.id });
    }
  }

  // Entry node is the first stage with no dependencies
  const entryNode = graph.stages.find(s => s.dependencies.length === 0);
  const entryNodeId = entryNode ? entryNode.id : graph.stages[0].id;

  return {
    name: graph.family,
    graph: { entryNodeId, nodes, edges }
  };
}

function synthesizeHarnessResult(
  graph: TaskGraph,
  risks: RiskModel
): HarnessSynthesisResult {
  // Derive policy from graph and risks
  const policyResult = synthesizePolicy(graph, risks);
  
  if (!policyResult.success) {
    throw new Error(`Policy synthesis failed: ${policyResult.reasons.join(", ")}`);
  }
  
  const policy = policyResult.policy;
  let spec: HarnessSpec;
  
  if (policy.workflow === "patch-validation") {
    spec = buildPatchValidationHarnessSpec(policy.bundle as LocalPatchValidationBundle);
  } else if (policy.workflow === "pr-review-merge") {
    spec = buildPrReviewMergeHarnessSpec(policy.bundle as LocalPrBundle);
  } else {
    // Generic fallback for custom workflow families
    spec = buildGenericHarnessSpec(graph);
  }
  
  return {
    spec,
    rationale: policy.rationale,
    warnings: policy.warnings
  };
}

export function synthesizeHarness(graph: TaskGraph, risks: RiskModel): HarnessSpec {
  return synthesizeHarnessResult(graph, risks).spec;
}
