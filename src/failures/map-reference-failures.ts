import type { FailureRecord } from "./types.js";

const WORKFLOW_FAILURE_MAPPING: Record<string, FailureRecord["rootCause"]> = {
  "apply-failed": "dependency_failure",
  "candidate-failed": "invalid_output",
  "reject-human": "human_block",
};

export function mapReferenceFailure(
  domainType: string,
  workflowFailureType: string,
  nodeId: string,
  message: string,
): FailureRecord {
  const rootCause = WORKFLOW_FAILURE_MAPPING[workflowFailureType] ?? "unknown";
  
  return {
    domainType,
    rootCause,
    nodeId,
    message,
  };
}
