export type SupportedWorkflowFamily = string;

export type IntentStepKind = "tool" | "llm" | "human" | "condition";

export interface IntentStep {
  id: string;
  label: string;
  kind: IntentStepKind;
  command?: string;
  prompt?: string;
  description?: string;
}

export interface IntentIR {
  family: SupportedWorkflowFamily;
  goal: string;
  inputs: Record<string, unknown>;
  requiredTools: string[];
  humanCheckpoints: string[];
  verificationTargets: string[];
  steps?: IntentStep[];
  capabilities?: string[];
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
  if (!intent.family || typeof intent.family !== "string" || intent.family.trim().length === 0) {
    return {
      rejected: true,
      reasons: ["Workflow family is missing or empty"],
      guidance: [
        "Please specify a workflow family (e.g., 'patch-validation', 'pr-review-merge', or any custom name)"
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
      "Please specify a workflow family with the required inputs for that workflow type"
    ]
  };
}
