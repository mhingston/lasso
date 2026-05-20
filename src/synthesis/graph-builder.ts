import type { IntentIR, SupportedWorkflowFamily } from "./intent-ir.js";

export interface TaskGraph {
  family: SupportedWorkflowFamily;
  stages: WorkflowStage[];
  inputs: Record<string, unknown>;
  goal: string;
}

export interface WorkflowStage {
  id: string;
  type: "setup" | "reproduce" | "apply" | "verify" | "review" | "merge" | "approval";
  dependencies: string[];
  description: string;
  requiredInputs: string[];
}

export function buildTaskGraph(intent: IntentIR): TaskGraph {
  const stages: WorkflowStage[] = [];
  
  if (intent.family === "patch-validation") {
    stages.push({
      id: "setup-baseline",
      type: "setup",
      dependencies: [],
      description: "Check out baseline ref",
      requiredInputs: ["repoPath", "baselineRef"]
    });
    
    stages.push({
      id: "reproduce-bug",
      type: "reproduce",
      dependencies: ["setup-baseline"],
      description: "Reproduce the bug on baseline",
      requiredInputs: ["reproduceCommands"]
    });
    
    stages.push({
      id: "apply-candidate",
      type: "apply",
      dependencies: ["reproduce-bug"],
      description: "Apply candidate fix",
      requiredInputs: ["candidateBranch", "patchFilePath"]
    });
    
    stages.push({
      id: "verify-fix",
      type: "verify",
      dependencies: ["apply-candidate"],
      description: "Verify fix resolves issue and passes regression tests",
      requiredInputs: ["reproduceCommands", "verificationCommands"]
    });
    
    stages.push({
      id: "review-results",
      type: "review",
      dependencies: ["verify-fix"],
      description: "Review validation results",
      requiredInputs: ["reviewInstructions"]
    });
    
    if (intent.humanCheckpoints.includes("approval-gate")) {
      stages.push({
        id: "approval-gate",
        type: "approval",
        dependencies: ["review-results"],
        description: "Human approval required",
        requiredInputs: []
      });
    }
  } else if (intent.family === "pr-review-merge") {
    stages.push({
      id: "setup-pr",
      type: "setup",
      dependencies: [],
      description: "Fetch and checkout PR branches",
      requiredInputs: ["repoPath", "sourceBranch", "targetBranch"]
    });
    
    stages.push({
      id: "review-changes",
      type: "review",
      dependencies: ["setup-pr"],
      description: "Review PR changes",
      requiredInputs: ["reviewInstructions"]
    });
    
    stages.push({
      id: "verify-tests",
      type: "verify",
      dependencies: ["review-changes"],
      description: "Run verification tests",
      requiredInputs: ["verificationCommands"]
    });
    
    stages.push({
      id: "merge-pr",
      type: "merge",
      dependencies: ["verify-tests"],
      description: "Merge PR",
      requiredInputs: ["sourceBranch", "targetBranch"]
    });
  }
  
  return {
    family: intent.family,
    stages,
    inputs: intent.inputs,
    goal: intent.goal
  };
}
