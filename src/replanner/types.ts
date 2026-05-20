import type { ReferenceWorkflowRequest } from "../reference/catalog.js";
import type { LocalPatchValidationBundle, LocalPrBundle } from "../reference/types.js";

export type ReplanWorkflow = "patch-validation" | "pr-review-merge";
export type ReplanTrigger = "risk-escalation" | "failure-recovery";
export type RiskLevel = "low" | "medium" | "high";
export type ReplanAbortReason = "setup-failure" | "retry-exhaustion" | "timeout" | "manual-stop" | "unknown";

export type PatchValidationTerminalNodeId =
  | "validated-fix"
  | "not-reproduced"
  | "apply-failed"
  | "candidate-failed"
  | "rejected";

export type PrReviewMergeTerminalNodeId =
  | "complete-success"
  | "reject-verification"
  | "reject-human"
  | "merge-conflict";

interface BaseObservedOutcome {
  aborted?: boolean;
  abortReason?: ReplanAbortReason;
  notes?: string[];
}

export interface PatchValidationObservedOutcome extends BaseObservedOutcome {
  terminalNodeId?: PatchValidationTerminalNodeId;
}

export interface PrReviewMergeObservedOutcome extends BaseObservedOutcome {
  terminalNodeId?: PrReviewMergeTerminalNodeId;
}

export type ReplanRequest =
  | {
      workflow: "patch-validation";
      originalRequest: { workflow: "patch-validation"; input: LocalPatchValidationBundle };
      observedOutcome: PatchValidationObservedOutcome;
    }
  | {
      workflow: "pr-review-merge";
      originalRequest: { workflow: "pr-review-merge"; input: LocalPrBundle };
      observedOutcome: PrReviewMergeObservedOutcome;
    };

export type ReplanResult =
  | {
      status: "draft_request";
      workflow: ReplanWorkflow;
      request: ReferenceWorkflowRequest;
      trigger: ReplanTrigger;
      riskLevel: RiskLevel;
      rationale: string[];
      warnings: string[];
      changes: string[];
    }
  | {
      status: "needs_operator_input";
      candidateWorkflow?: ReplanWorkflow;
      riskLevel: RiskLevel;
      reasons: string[];
      missingFields: string[];
      guidance: string[];
    }
  | {
      status: "stop";
      workflow: ReplanWorkflow;
      riskLevel: "medium" | "high";
      reasons: string[];
      guidance: string[];
    };
