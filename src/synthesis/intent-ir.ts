export type SupportedWorkflowFamily = "patch-validation" | "pr-review-merge";

export interface IntentIR {
  family: SupportedWorkflowFamily;
  goal: string;
  inputs: Record<string, unknown>;
  requiredTools: string[];
  humanCheckpoints: string[];
  verificationTargets: string[];
}

export interface UnsupportedIntentRejection {
  rejected: true;
  reasons: string[];
  candidateFamily?: string;
  guidance: string[];
}

export type IntentParseResult = 
  | { success: true; intent: IntentIR }
  | UnsupportedIntentRejection;

export function validateIntent(intent: IntentIR): UnsupportedIntentRejection | null {
  const supportedFamilies: SupportedWorkflowFamily[] = ["patch-validation", "pr-review-merge"];
  
  if (!supportedFamilies.includes(intent.family)) {
    return {
      rejected: true,
      reasons: [`Workflow family "${intent.family}" is not supported`],
      candidateFamily: intent.family,
      guidance: [
        "Supported workflow families:",
        "- patch-validation: Validate a fix against a baseline",
        "- pr-review-merge: Review and merge a pull request"
      ]
    };
  }
  
  return null;
}

export function rejectUnsupportedIntent(
  reasons: string[],
  candidateFamily?: string,
  guidance?: string[]
): UnsupportedIntentRejection {
  return {
    rejected: true,
    reasons,
    candidateFamily,
    guidance: guidance || [
      "Please specify a workflow that matches either:",
      "- patch-validation: Validate a fix against a baseline",
      "- pr-review-merge: Review and merge a pull request"
    ]
  };
}
