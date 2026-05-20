import type { ReferenceWorkflowRequest } from "../reference/catalog.js";
import { parsePromptOrSkill } from "../synthesis/skill-parser.js";
import { buildTaskGraph } from "../synthesis/graph-builder.js";
import { analyzeRisks } from "../synthesis/risk-analyzer.js";
import { synthesizePolicy } from "../synthesis/policy-builder.js";
import type { PlannerResult } from "./types.js";

export function planWorkflowRequest(brief: string): PlannerResult {
  // Reject empty briefs
  if (!brief || brief.trim().length === 0) {
    return {
      status: "needs_clarification",
      reasons: ["Brief is empty"],
      missingFields: ["brief"],
      guidance: [
        "Please provide a workflow description including repo path, workflow type (PR review/merge or patch validation), and required commands."
      ]
    };
  }
  
  // Parse the brief or skill markdown into IntentIR
  const parseResult = parsePromptOrSkill(brief);
  
  // Handle rejection
  if ("rejected" in parseResult) {
    // Populate missingFields when workflow type is ambiguous
    const missingFields = parseResult.reasons.some(r => r.includes("workflow type") || r.includes("workflow family")) 
      ? ["workflow type"] 
      : [];
    
    return {
      status: "needs_clarification",
      candidateWorkflow: parseResult.candidateFamily,
      reasons: parseResult.reasons,
      missingFields,
      guidance: parseResult.guidance
    };
  }
  
  const intent = parseResult.intent;
  
  // Build task graph from intent
  const graph = buildTaskGraph(intent);
  
  // Analyze risks
  const risks = analyzeRisks(graph);
  
  // Synthesize policy
  const policyResult = synthesizePolicy(graph, risks);
  
  // Handle policy synthesis failure
  if (!policyResult.success) {
    return {
      status: "needs_clarification",
      candidateWorkflow: intent.family,
      reasons: policyResult.reasons,
      missingFields: policyResult.missingFields,
      guidance: policyResult.guidance
    };
  }
  
  const policy = policyResult.policy;
  
  // Build the request
  const request: ReferenceWorkflowRequest = {
    workflow: policy.workflow,
    input: policy.bundle
  };
  
  return {
    status: "draft_request",
    workflow: policy.workflow,
    request,
    rationale: policy.rationale,
    warnings: policy.warnings
  };
}
