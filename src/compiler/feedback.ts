import type { CompiledHarnessWorkflow } from "./compile.js";
import type { HarnessSpec, TaskNode, LlmNode, ToolNode, HumanNode, RetryPolicy, VerificationPolicy } from "../spec/types.js";

// ============================================================================
// Types
// ============================================================================

export interface CostEstimate {
  llmCallCount: number;
  toolCallCount: number;
  humanInteractionCount: number;
  estimatedDurationMs: number;
  estimatedCostUsd: number;
}

export interface RiskAssessment {
  costRisk: RiskFactor;
  failureRisk: RiskFactor;
  qualityRisk: RiskFactor;
  complexityRisk: RiskFactor;
  overallRisk: "low" | "medium" | "high";
}

export interface RiskFactor {
  level: "low" | "medium" | "high";
  factors: string[];
}

export interface CompilerSuggestion {
  type: "reduce-llm" | "add-retry" | "merge-nodes" | "simplify" | "add-verification";
  description: string;
  impact: "low" | "medium" | "high";
}

export interface CompilerAnalysis {
  cost: CostEstimate;
  risk: RiskAssessment;
  suggestions: CompilerSuggestion[];
}

// ============================================================================
// Pricing constants
// ============================================================================

const LLM_COST_PER_CALL_USD = 0.01;
const TOOL_DURATION_MS = 500;
const LLM_DURATION_MS = 2000;
const HUMAN_DURATION_MS = 300000; // 5 minutes average wait
const COMPLEXITY_NODE_THRESHOLD = 5;
const HIGH_LLM_THRESHOLD = 5;

// ============================================================================
// Main analysis function
// ============================================================================

export function analyzeCompiledWorkflow(
  compiled: CompiledHarnessWorkflow
): CompilerAnalysis {
  const nodes = compiled.spec.graph.nodes;
  const edges = compiled.spec.graph.edges;

  const cost = estimateCost(nodes);
  const risk = assessRisk(nodes, edges);
  const suggestions = generateSuggestions(nodes, edges);

  return { cost, risk, suggestions };
}

// ============================================================================
// Cost estimation
// ============================================================================

function estimateCost(nodes: TaskNode[]): CostEstimate {
  let llmCallCount = 0;
  let toolCallCount = 0;
  let humanInteractionCount = 0;

  for (const node of nodes) {
    switch (node.kind) {
      case "llm":
        llmCallCount++;
        break;
      case "tool":
        toolCallCount++;
        break;
      case "human":
        humanInteractionCount++;
        break;
    }
  }

  const estimatedDurationMs =
    llmCallCount * LLM_DURATION_MS +
    toolCallCount * TOOL_DURATION_MS +
    humanInteractionCount * HUMAN_DURATION_MS;

  const estimatedCostUsd = llmCallCount * LLM_COST_PER_CALL_USD;

  return {
    llmCallCount,
    toolCallCount,
    humanInteractionCount,
    estimatedDurationMs,
    estimatedCostUsd,
  };
}

// ============================================================================
// Risk assessment
// ============================================================================

function assessRisk(nodes: TaskNode[], edges: { from: string; to: string }[]): RiskAssessment {
  const costRisk = assessCostRisk(nodes);
  const failureRisk = assessFailureRisk(nodes);
  const qualityRisk = assessQualityRisk(nodes);
  const complexityRisk = assessComplexityRisk(nodes, edges);

  const riskLevels = [costRisk.level, failureRisk.level, qualityRisk.level, complexityRisk.level];
  const overallRisk = computeOverallRisk(riskLevels);

  return {
    costRisk,
    failureRisk,
    qualityRisk,
    complexityRisk,
    overallRisk,
  };
}

function assessCostRisk(nodes: TaskNode[]): RiskFactor {
  const llmCount = nodes.filter(n => n.kind === "llm").length;
  const factors: string[] = [];

  if (llmCount > HIGH_LLM_THRESHOLD) {
    return {
      level: "high",
      factors: [`High LLM call count (${llmCount} > ${HIGH_LLM_THRESHOLD}) increases cost risk`],
    };
  }

  if (llmCount > 2) {
    return {
      level: "medium",
      factors: [`Moderate LLM call count (${llmCount}) may increase costs`],
    };
  }

  return { level: "low", factors: [] };
}

function assessFailureRisk(nodes: TaskNode[]): RiskFactor {
  const hasRetry = nodes.some(n => n.retryPolicy && n.retryPolicy.maxAttempts > 0);
  const factors: string[] = [];

  if (!hasRetry) {
    return {
      level: "high",
      factors: ["No retry policies defined — transient failures will cause workflow termination"],
    };
  }

  return { level: "low", factors: [] };
}

function assessQualityRisk(nodes: TaskNode[]): RiskFactor {
  const hasVerification = nodes.some(n => n.verificationPolicy && n.verificationPolicy.rules.length > 0);
  const factors: string[] = [];

  if (!hasVerification) {
    return {
      level: "high",
      factors: ["No verification policies defined — output quality is not guaranteed"],
    };
  }

  return { level: "low", factors: [] };
}

function assessComplexityRisk(nodes: TaskNode[], edges: { from: string; to: string }[]): RiskFactor {
  const nodeCount = nodes.length;
  const edgeCount = edges.length;
  const factors: string[] = [];

  if (nodeCount > COMPLEXITY_NODE_THRESHOLD || edgeCount > COMPLEXITY_NODE_THRESHOLD * 2) {
    return {
      level: "high",
      factors: [`Complex graph with ${nodeCount} nodes and ${edgeCount} edges increases maintenance and debugging risk`],
    };
  }

  if (nodeCount > COMPLEXITY_NODE_THRESHOLD / 2) {
    return {
      level: "medium",
      factors: [`Moderate graph complexity with ${nodeCount} nodes`],
    };
  }

  return { level: "low", factors: [] };
}

function computeOverallRisk(levels: Array<"low" | "medium" | "high">): "low" | "medium" | "high" {
  if (levels.includes("high")) return "high";
  if (levels.includes("medium")) return "medium";
  return "low";
}

// ============================================================================
// Suggestion generation
// ============================================================================

function generateSuggestions(nodes: TaskNode[], edges: { from: string; to: string }[]): CompilerSuggestion[] {
  const suggestions: CompilerSuggestion[] = [];

  const llmCount = nodes.filter(n => n.kind === "llm").length;
  if (llmCount > HIGH_LLM_THRESHOLD) {
    suggestions.push({
      type: "reduce-llm",
      description: `Workflow has ${llmCount} LLM calls (threshold: ${HIGH_LLM_THRESHOLD}). Consider consolidating prompts or using cheaper models.`,
      impact: "high",
    });
  }

  const hasRetry = nodes.some(n => n.retryPolicy && n.retryPolicy.maxAttempts > 0);
  if (!hasRetry) {
    suggestions.push({
      type: "add-retry",
      description: "No retry policies found. Add retry policies to tool and LLM nodes to handle transient failures.",
      impact: "high",
    });
  }

  const adjacentSameTool = findAdjacentSameToolNodes(nodes, edges);
  if (adjacentSameTool.length > 0) {
    const pairs = adjacentSameTool.map(([a, b]) => `${a}->${b}`).join(", ");
    suggestions.push({
      type: "merge-nodes",
      description: `Adjacent same-tool nodes detected: ${pairs}. Consider merging into a single tool call with combined arguments.`,
      impact: "medium",
    });
  }

  const hasVerification = nodes.some(n => n.verificationPolicy && n.verificationPolicy.rules.length > 0);
  if (!hasVerification) {
    suggestions.push({
      type: "add-verification",
      description: "No verification policies found. Add verification to ensure output quality and correctness.",
      impact: "high",
    });
  }

  return suggestions;
}

function findAdjacentSameToolNodes(nodes: TaskNode[], edges: { from: string; to: string }[]): Array<[string, string]> {
  const nodeMap = new Map<string, TaskNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const pairs: Array<[string, string]> = [];

  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);

    if (
      fromNode &&
      toNode &&
      fromNode.kind === "tool" &&
      toNode.kind === "tool"
    ) {
      pairs.push([fromNode.id, toNode.id]);
    }
  }

  return pairs;
}

// ============================================================================
// Apply suggestions to spec
// ============================================================================

export function applyCompilerSuggestions(
  spec: HarnessSpec,
  suggestions: CompilerSuggestion[]
): HarnessSpec {
  const modifiedSpec = structuredClone(spec);

  for (const suggestion of suggestions) {
    switch (suggestion.type) {
      case "add-retry":
        applyAddRetry(modifiedSpec);
        break;
      case "add-verification":
        applyAddVerification(modifiedSpec);
        break;
      case "reduce-llm":
      case "merge-nodes":
      case "simplify":
        // These require manual intervention or more complex transformations
        // No automatic modification for now
        break;
    }
  }

  return modifiedSpec;
}

function applyAddRetry(spec: HarnessSpec): void {
  const defaultRetry: RetryPolicy = {
    maxAttempts: 3,
    backoff: "exponential",
    initialDelay: 1,
  };

  for (const node of spec.graph.nodes) {
    if (node.kind === "tool" || node.kind === "llm" || node.kind === "subworkflow") {
      if (!node.retryPolicy) {
        node.retryPolicy = defaultRetry;
      }
    }
  }
}

function applyAddVerification(spec: HarnessSpec): void {
  // Add a verification policy to nodes that don't have one and are executable
  // We create a placeholder verification that references a new verification node
  const nodesNeedingVerification = spec.graph.nodes.filter(
    n => (n.kind === "tool" || n.kind === "llm") && (!n.verificationPolicy || n.verificationPolicy.rules.length === 0)
  );

  if (nodesNeedingVerification.length === 0) return;

  // Create verification nodes
  const verificationNodes: TaskNode[] = [];
  const newEdges: typeof spec.graph.edges = [];

  for (const node of nodesNeedingVerification) {
    const verifierId = `verify-${node.id}`;
    const verifierNode: TaskNode = {
      id: verifierId,
      kind: "tool",
      tool: "echo",
      args: [`verify ${node.id}`],
      label: `Verify ${node.label || node.id}`,
    };
    verificationNodes.push(verifierNode);

    // Add verification policy to the original node
    const verificationPolicy: VerificationPolicy = {
      rules: [
        {
          kind: "tool",
          checkNodeId: verifierId,
          onFail: "block",
        },
      ],
    };

    if (node.kind === "tool" || node.kind === "llm") {
      node.verificationPolicy = verificationPolicy;
    }

    // Add edge from original node to verifier
    newEdges.push({ from: node.id, to: verifierId });
  }

  // Add verification nodes and edges to the spec
  spec.graph.nodes.push(...verificationNodes);
  spec.graph.edges.push(...newEdges);
}
