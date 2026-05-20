import type { FailureRecord } from "./types.js";

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
