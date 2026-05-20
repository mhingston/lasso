import type { FailureSignature, FailureContext } from "./ontology.js";

export interface RecoveryStep {
  action: string;
  description: string;
  automated: boolean;
}

export interface RecoveryPlan {
  steps: RecoveryStep[];
  estimatedSuccessRate: number;
  requiresHumanApproval: boolean;
}

const AUTH_RECOVERY_STEPS: RecoveryStep[] = [
  {
    action: "Refresh authentication credentials",
    description: "Attempt to refresh or re-obtain the expired/invalid credentials",
    automated: false,
  },
  {
    action: "Verify API key configuration",
    description: "Check that API keys and secrets are correctly set in the environment",
    automated: true,
  },
  {
    action: "Check token expiry",
    description: "Inspect the current token's expiry time and renew if necessary",
    automated: true,
  },
];

const TOOL_RECOVERY_STEPS: RecoveryStep[] = [
  {
    action: "Check tool availability",
    description: "Verify the required tool is installed and accessible in PATH",
    automated: true,
  },
  {
    action: "Install missing tool",
    description: "Install the required tool if it is not present",
    automated: false,
  },
  {
    action: "Verify tool version",
    description: "Check that the tool version is compatible with expected version",
    automated: true,
  },
];

const RESOURCE_RECOVERY_STEPS: RecoveryStep[] = [
  {
    action: "Check disk space",
    description: "Verify available disk space and clean up temporary files if needed",
    automated: true,
  },
  {
    action: "Free up memory",
    description: "Release unused memory or increase memory limits",
    automated: false,
  },
  {
    action: "Apply rate limiting",
    description: "Implement backoff strategy to avoid hitting rate limits",
    automated: true,
  },
];

const SEMANTIC_RECOVERY_STEPS: RecoveryStep[] = [
  {
    action: "Validate output format",
    description: "Check the output against the expected schema or format",
    automated: true,
  },
  {
    action: "Review input data",
    description: "Verify input data is correct and complete",
    automated: true,
  },
  {
    action: "Add validation step",
    description: "Insert a validation node before processing to catch format errors early",
    automated: false,
  },
];

const HUMAN_RECOVERY_STEPS: RecoveryStep[] = [
  {
    action: "Escalate to human operator",
    description: "Notify a human operator to review and make a decision",
    automated: false,
  },
  {
    action: "Provide additional context",
    description: "Gather more information to help the human make an informed decision",
    automated: true,
  },
  {
    action: "Reconsider proposed changes",
    description: "Review and potentially modify the changes that were rejected",
    automated: false,
  },
];

const ENVIRONMENT_DRIFT_RECOVERY_STEPS: RecoveryStep[] = [
  {
    action: "Sync environment dependencies",
    description: "Install or update dependencies to match expected versions",
    automated: false,
  },
  {
    action: "Verify configuration",
    description: "Check that environment configuration matches expected state",
    automated: true,
  },
  {
    action: "Update version requirements",
    description: "Align version requirements with the actual environment",
    automated: false,
  },
];

const NETWORK_RECOVERY_STEPS: RecoveryStep[] = [
  {
    action: "Retry with exponential backoff",
    description: "Retry the failed operation with increasing delays between attempts",
    automated: true,
  },
  {
    action: "Check network connectivity",
    description: "Verify DNS resolution and network reachability to the target",
    automated: true,
  },
  {
    action: "Verify target service health",
    description: "Check if the target service is up and responding",
    automated: true,
  },
];

const UNKNOWN_RECOVERY_STEPS: RecoveryStep[] = [
  {
    action: "Collect diagnostic information",
    description: "Gather logs, metrics, and traces to understand the failure",
    automated: true,
  },
  {
    action: "Review error logs",
    description: "Examine detailed error logs for root cause clues",
    automated: true,
  },
  {
    action: "Escalate to human operator",
    description: "If automated diagnostics fail, escalate for human investigation",
    automated: false,
  },
];

const CLASS_RECOVERY_MAP: Record<FailureSignature["class"], RecoveryStep[]> = {
  auth: AUTH_RECOVERY_STEPS,
  tool: TOOL_RECOVERY_STEPS,
  resource: RESOURCE_RECOVERY_STEPS,
  semantic: SEMANTIC_RECOVERY_STEPS,
  human: HUMAN_RECOVERY_STEPS,
  "environment-drift": ENVIRONMENT_DRIFT_RECOVERY_STEPS,
  network: NETWORK_RECOVERY_STEPS,
  unknown: UNKNOWN_RECOVERY_STEPS,
};

const CLASS_BASE_SUCCESS_RATE: Record<FailureSignature["class"], number> = {
  auth: 0.3,
  tool: 0.5,
  resource: 0.4,
  semantic: 0.3,
  human: 0.2,
  "environment-drift": 0.4,
  network: 0.7,
  unknown: 0.1,
};

export function suggestRecovery(
  signature: FailureSignature,
  context?: FailureContext,
): RecoveryPlan {
  const baseSteps = CLASS_RECOVERY_MAP[signature.class];
  const steps = [...baseSteps];

  if (context?.attemptNumber !== undefined && context.attemptNumber > 3) {
    steps.push({
      action: "Escalate after repeated failures",
      description: `Failure has occurred ${context.attemptNumber} times, escalate to human`,
      automated: false,
    });
  }

  const baseRate = CLASS_BASE_SUCCESS_RATE[signature.class];
  const confidenceAdjustment = signature.confidence * 0.2;
  const retryableBonus = signature.retryable ? 0.15 : 0;
  const estimatedSuccessRate = Math.min(1, baseRate + confidenceAdjustment + retryableBonus);

  const requiresHumanApproval =
    signature.requiresHumanIntervention ||
    signature.class === "semantic" ||
    signature.class === "environment-drift" ||
    signature.class === "unknown" ||
    (signature.class === "resource" &&
      signature.evidence.some((e) => e.toLowerCase().includes("memory")));

  return {
    steps,
    estimatedSuccessRate: Math.round(estimatedSuccessRate * 100) / 100,
    requiresHumanApproval,
  };
}
