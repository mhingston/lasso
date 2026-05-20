import type { FailureRecord } from "./types.js";
import {
  classifyAuthFailure,
  classifyToolFailure,
  classifyResourceFailure,
  classifySemanticFailure,
  classifyHumanFailure,
  classifyEnvironmentDriftFailure,
  classifyNetworkFailure,
} from "./classifiers.js";

export interface FailureClassification {
  category: "transient" | "permanent";
  retryable: boolean;
}

export function classifyFailureRecord(failure: FailureRecord): FailureClassification {
  switch (failure.rootCause) {
    case "tool_timeout":
    case "rate_limited":
    case "unknown":
      return { category: "transient", retryable: true };

    case "auth_required":
    case "invalid_output":
    case "dependency_failure":
    case "verification_failed":
    case "human_block":
      return { category: "permanent", retryable: false };

    default:
      return { category: "transient", retryable: true };
  }
}

export function isRetryableFailure(failure: FailureRecord): boolean {
  return classifyFailureRecord(failure).retryable;
}

export type FailureClass =
  | "auth"
  | "tool"
  | "resource"
  | "semantic"
  | "human"
  | "environment-drift"
  | "network"
  | "unknown";

export interface FailureContext {
  nodeId?: string;
  attemptNumber?: number;
  harnessName?: string;
}

export interface FailureSignature {
  class: FailureClass;
  confidence: number;
  evidence: string[];
  suggestedRecovery: string[];
  retryable: boolean;
  requiresHumanIntervention: boolean;
}

const CLASS_RECOVERY_MAP: Record<FailureClass, string[]> = {
  auth: [
    "Refresh or re-obtain authentication credentials",
    "Check token expiry and renew if necessary",
    "Verify API keys or secrets are correctly configured",
  ],
  tool: [
    "Verify tool is installed and available in PATH",
    "Check tool version compatibility",
    "Review tool exit code and stderr for details",
  ],
  resource: [
    "Check available disk space and clean up if necessary",
    "Review memory usage and increase limits if needed",
    "Implement rate limiting or backoff for API calls",
  ],
  semantic: [
    "Review output format and validate against expected schema",
    "Check input data for correctness",
    "Add validation step before processing",
  ],
  human: [
    "Escalate to human operator for review",
    "Reconsider the proposed changes",
    "Provide additional context for human decision",
  ],
  "environment-drift": [
    "Sync environment dependencies to expected versions",
    "Install missing dependencies",
    "Verify configuration matches expected state",
  ],
  network: [
    "Retry the operation with exponential backoff",
    "Check network connectivity and DNS resolution",
    "Verify target service is reachable",
  ],
  unknown: [
    "Collect additional diagnostic information",
    "Review logs for root cause analysis",
    "Escalate to human operator if unresolved",
  ],
};

const CLASS_RETRYABLE_MAP: Record<FailureClass, boolean> = {
  auth: false,
  tool: false,
  resource: true,
  semantic: false,
  human: false,
  "environment-drift": false,
  network: true,
  unknown: false,
};

const CLASS_REQUIRES_HUMAN_MAP: Record<FailureClass, boolean> = {
  auth: true,
  tool: false,
  resource: false,
  semantic: true,
  human: true,
  "environment-drift": true,
  network: false,
  unknown: true,
};

const CLASS_CONFIDENCE_BASE: Record<FailureClass, number> = {
  auth: 0.9,
  tool: 0.85,
  resource: 0.9,
  semantic: 0.85,
  human: 0.85,
  "environment-drift": 0.8,
  network: 0.9,
  unknown: 0.1,
};

export function classifyFailure(
  error: unknown,
  context?: FailureContext,
): FailureSignature {
  const authResult = classifyAuthFailure(error);
  if (authResult.matched) {
    return buildSignature("auth", authResult, context);
  }

  const toolResult = classifyToolFailure(error);
  if (toolResult.matched) {
    return buildSignature("tool", toolResult, context);
  }

  const resourceResult = classifyResourceFailure(error);
  if (resourceResult.matched) {
    return buildSignature("resource", resourceResult, context);
  }

  const semanticResult = classifySemanticFailure(error);
  if (semanticResult.matched) {
    return buildSignature("semantic", semanticResult, context);
  }

  const humanResult = classifyHumanFailure(error);
  if (humanResult.matched) {
    return buildSignature("human", humanResult, context);
  }

  const envDriftResult = classifyEnvironmentDriftFailure(error);
  if (envDriftResult.matched) {
    return buildSignature("environment-drift", envDriftResult, context);
  }

  const networkResult = classifyNetworkFailure(error);
  if (networkResult.matched) {
    return buildSignature("network", networkResult, context);
  }

  return buildSignature("unknown", { matched: false, evidence: [] }, context);
}

function buildSignature(
  cls: FailureClass,
  classifierResult: { matched: boolean; evidence: string[] },
  context?: FailureContext,
): FailureSignature {
  const evidence = [...classifierResult.evidence];

  if (context?.nodeId) {
    evidence.push(`node: ${context.nodeId}`);
  }

  if (context?.attemptNumber !== undefined) {
    evidence.push(`attempt: ${context.attemptNumber}`);
  }

  const confidence = classifierResult.matched
    ? CLASS_CONFIDENCE_BASE[cls]
    : CLASS_CONFIDENCE_BASE.unknown;

  return {
    class: cls,
    confidence,
    evidence,
    suggestedRecovery: CLASS_RECOVERY_MAP[cls],
    retryable: CLASS_RETRYABLE_MAP[cls],
    requiresHumanIntervention: CLASS_REQUIRES_HUMAN_MAP[cls],
  };
}
