import type { IntentIR, IntentStep, SupportedWorkflowFamily } from "./intent-ir.js";
import type { CapabilityRegistry } from "../capabilities/types.js";
import { matchCapabilities } from "../capabilities/matcher.js";

export interface TaskGraph {
  family: SupportedWorkflowFamily;
  stages: WorkflowStage[];
  inputs: Record<string, unknown>;
  goal: string;
  capabilityMatch?: {
    matched: string[];
    missing: string[];
  };
}

export interface WorkflowStage {
  id: string;
  type: "setup" | "reproduce" | "apply" | "verify" | "review" | "merge" | "approval";
  dependencies: string[];
  description: string;
  requiredInputs: string[];
}

function stepKindToStageType(kind: IntentStep["kind"]): WorkflowStage["type"] {
  switch (kind) {
    case "tool":
      return "setup";
    case "llm":
      return "review";
    case "human":
      return "approval";
    case "condition":
      return "verify";
    default:
      return "setup";
  }
}

function buildCapabilityStages(intent: IntentIR, registry: CapabilityRegistry): { stages: WorkflowStage[]; matched: string[]; missing: string[] } {
  const stages: WorkflowStage[] = [];
  const requiredTools = intent.capabilities || intent.requiredTools;
  const { matched, missing } = matchCapabilities(requiredTools, registry);

  if (matched.length === 0) {
    return { stages: [], matched: [], missing };
  }

  const setupStageId = "capability-setup";
  stages.push({
    id: setupStageId,
    type: "setup",
    dependencies: [],
    description: `Verify required capabilities: ${matched.map(c => c.name).join(", ")}`,
    requiredInputs: []
  });

  let prevStageId = setupStageId;

  for (const cap of matched) {
    if (cap.verification.length > 0) {
      const verifyStageId = `capability-verify-${cap.id}`;
      stages.push({
        id: verifyStageId,
        type: "verify",
        dependencies: [prevStageId],
        description: `Verify ${cap.name}: ${cap.verification.join("; ")}`,
        requiredInputs: []
      });
      prevStageId = verifyStageId;
    }

    if (cap.risks.length > 0) {
      const riskStageId = `capability-risk-${cap.id}`;
      stages.push({
        id: riskStageId,
        type: "review",
        dependencies: [prevStageId],
        description: `Assess risks for ${cap.name}: ${cap.risks.join("; ")}`,
        requiredInputs: []
      });
      prevStageId = riskStageId;
    }

    if (cap.kind === "human") {
      stages.push({
        id: `capability-approval-${cap.id}`,
        type: "approval",
        dependencies: [prevStageId],
        description: `Human approval required: ${cap.name}`,
        requiredInputs: []
      });
    }
  }

  return { stages, matched: matched.map(c => c.id), missing };
}

export function buildTaskGraph(intent: IntentIR, registry?: CapabilityRegistry): TaskGraph {
  const stages: WorkflowStage[] = [];
  let capabilityMatch: { matched: string[]; missing: string[] } | undefined;

  const hasCapabilities = intent.capabilities && intent.capabilities.length > 0;
  const useCapabilityPath = hasCapabilities && registry;

  if (useCapabilityPath) {
    const result = buildCapabilityStages(intent, registry);
    stages.push(...result.stages);
    capabilityMatch = { matched: result.matched, missing: result.missing };
  }
  
  if (intent.family === "patch-validation" && !useCapabilityPath) {
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
      requiredInputs: ["candidateBranch", "patchFilePath"]  // One of these must be present
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
  } else if (intent.family === "pr-review-merge" && !useCapabilityPath) {
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
  
  if (intent.steps && intent.steps.length > 0) {
    for (let i = 0; i < intent.steps.length; i++) {
      const step = intent.steps[i];
      const prevStepId = i > 0 ? intent.steps[i - 1].id : undefined;

      stages.push({
        id: step.id,
        type: stepKindToStageType(step.kind),
        dependencies: prevStepId ? [prevStepId] : [],
        description: step.label,
        requiredInputs: []
      });
    }

    if (intent.verificationTargets.length > 0) {
      const lastStepId = intent.steps[intent.steps.length - 1].id;

      for (let i = 0; i < intent.verificationTargets.length; i++) {
        stages.push({
          id: `verify-target-${i}`,
          type: "verify",
          dependencies: [lastStepId],
          description: `Verify: ${intent.verificationTargets[i]}`,
          requiredInputs: []
        });
      }
    }
  }
  
  return {
    family: intent.family,
    stages,
    inputs: intent.inputs,
    goal: intent.goal,
    capabilityMatch
  };
}
