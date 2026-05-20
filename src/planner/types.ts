import type { ReferenceWorkflowRequest } from "../reference/catalog.js";
import type { parsePromptOrSkill } from "../synthesis/skill-parser.js";
import type { buildTaskGraph } from "../synthesis/graph-builder.js";
import type { analyzeRisks } from "../synthesis/risk-analyzer.js";
import type { synthesizePolicy } from "../synthesis/policy-builder.js";

export type PlannerResult =
  | { 
      status: "draft_request"; 
      workflow: string;
      request: ReferenceWorkflowRequest;
      rationale: string[];
      warnings: string[];
    }
  | { 
      status: "needs_clarification"; 
      candidateWorkflow?: string;
      reasons: string[]; 
      missingFields: string[]; 
      guidance: string[];
    };

export type WorkflowTemplate = "patch-validation" | "pr-review-merge" | "custom" | "ambiguous";

export interface ExtractionResult {
  template: WorkflowTemplate;
  repoPath?: string;
  // pr-review-merge fields
  sourceBranch?: string;
  targetBranch?: string;
  // patch-validation fields
  baselineRef?: string;
  candidateBranch?: string;
  patchFilePath?: string;
  reproduceCommands?: string[];
  verificationCommands?: string[];
  reviewInstructions?: string;
  approvalRequired?: boolean;
}

// Re-export synthesis types that planner users may need
export type { parsePromptOrSkill, buildTaskGraph, analyzeRisks, synthesizePolicy };
